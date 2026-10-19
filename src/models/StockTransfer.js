'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * Moving stock between the two shops:  requested -> dispatched (leaves shop A) -> received (arrives at shop B).
 * A transfer can be cancelled before it is received; stock already sent goes back to the sending shop.
 */
class StockTransfer {
  /** data = { from_branch_id, to_branch_id, notes, items: [{ product_id, quantity }] }. opts.userId = who requests it. */
  static async create(data, opts = {}) {
    if (!opts.userId) throw new AppError('userId is required');
    if (Number(data.from_branch_id) === Number(data.to_branch_id)) throw new AppError('Choose two different shops');
    if (!Array.isArray(data.items) || !data.items.length) throw new AppError('Add at least one product to move');

    // the same product listed twice is combined into one line
    const merged = new Map();
    for (const it of data.items) {
      if (!(Number(it.quantity) > 0)) throw new AppError('Every quantity must be more than zero');
      merged.set(Number(it.product_id), (merged.get(Number(it.product_id)) || 0) + Number(it.quantity));
    }

    return db.inTransaction(opts, async (client) => {
      const { rows } = await client.query(
        'INSERT INTO stock_transfers (from_branch_id, to_branch_id, requested_by, notes) VALUES ($1, $2, $3, $4) RETURNING id',
        [data.from_branch_id, data.to_branch_id, opts.userId, data.notes || null]
      );
      const id = rows[0].id;
      for (const [productId, qty] of merged) {
        await client.query(
          'INSERT INTO stock_transfer_items (transfer_id, product_id, quantity_requested) VALUES ($1, $2, $3)',
          [id, productId, qty]
        );
      }
      return StockTransfer.findById(id, { client });
    });
  }

  /**
   * The sending shop sends the goods; their stock goes down now.
   * `items` (optional) = [{ product_id, quantity_sent }] when less than requested is sent.
   * opts.userId = who sends it.
   */
  static async dispatch(id, { items } = {}, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      await StockTransfer.#lock(client, id, 'requested', 'Only a requested transfer can be dispatched');
      for (const it of items || []) {
        await client.query(
          'UPDATE stock_transfer_items SET quantity_sent = $3 WHERE transfer_id = $1 AND product_id = $2',
          [id, it.product_id, it.quantity_sent]
        );
      }
      await client.query(
        "UPDATE stock_transfers SET status = 'dispatched', dispatched_by = $2, dispatched_at = now() WHERE id = $1",
        [id, opts.userId || null]
      );
      return StockTransfer.findById(id, { client });
    });
  }

  /**
   * The receiving shop confirms what arrived; their stock goes up now.
   * `items` (optional) = [{ product_id, quantity_received }] when the count differs from what was sent.
   * opts.userId = who receives it.
   */
  static async receive(id, { items } = {}, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      await StockTransfer.#lock(client, id, 'dispatched', 'Only a dispatched transfer can be received');
      for (const it of items || []) {
        await client.query(
          'UPDATE stock_transfer_items SET quantity_received = $3 WHERE transfer_id = $1 AND product_id = $2',
          [id, it.product_id, it.quantity_received]
        );
      }
      await client.query(
        "UPDATE stock_transfers SET status = 'received', received_by = $2, received_at = now() WHERE id = $1",
        [id, opts.userId || null]
      );
      return StockTransfer.findById(id, { client });
    });
  }

  /** Cancels a requested or dispatched transfer. Goods already sent return to the sending shop. */
  static async cancel(id, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      const { rows } = await client.query('SELECT status FROM stock_transfers WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new AppError('Transfer not found', 404);
      if (!['requested', 'dispatched'].includes(rows[0].status)) throw new AppError('This transfer can no longer be cancelled', 409);
      await client.query(
        "UPDATE stock_transfers SET status = 'cancelled', dispatched_by = COALESCE(dispatched_by, $2) WHERE id = $1",
        [id, opts.userId || null]
      );
      return StockTransfer.findById(id, { client });
    });
  }

  static async #lock(client, id, expectedStatus, message) {
    const { rows } = await client.query('SELECT status FROM stock_transfers WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new AppError('Transfer not found', 404);
    if (rows[0].status !== expectedStatus) throw new AppError(message, 409);
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT t.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
              ru.full_name AS requested_by_name, du.full_name AS dispatched_by_name, cu.full_name AS received_by_name
         FROM stock_transfers t
         JOIN branches fb       ON fb.id = t.from_branch_id
         JOIN branches tb       ON tb.id = t.to_branch_id
         JOIN users ru          ON ru.id = t.requested_by
         LEFT JOIN users du     ON du.id = t.dispatched_by
         LEFT JOIN users cu     ON cu.id = t.received_by
        WHERE t.id = $1`,
      [id],
      opts
    );
    const transfer = rows[0];
    if (!transfer) return null;
    transfer.items = (await db.query(
      `SELECT i.id, i.product_id, p.sku, p.name AS product_name, i.quantity_requested, i.quantity_sent, i.quantity_received
         FROM stock_transfer_items i JOIN products p ON p.id = i.product_id
        WHERE i.transfer_id = $1 ORDER BY i.id`,
      [id],
      opts
    )).rows;
    return transfer;
  }

  /** Transfers into or out of a shop. f = { branchId, status, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('(t.from_branch_id = ? OR t.to_branch_id = ?)', f.branchId);
    if (f.status) w.add('t.status = ?::transfer_status', f.status);
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT t.id, t.transfer_no, t.status, t.from_branch_id, fb.name AS from_branch_name,
              t.to_branch_id, tb.name AS to_branch_name, t.requested_at, t.dispatched_at, t.received_at,
              (SELECT COUNT(*) FROM stock_transfer_items x WHERE x.transfer_id = t.id) AS item_count,
              COUNT(*) OVER() AS total_count
         FROM stock_transfers t
         JOIN branches fb ON fb.id = t.from_branch_id
         JOIN branches tb ON tb.id = t.to_branch_id
         ${w.sql()}
        ORDER BY t.requested_at DESC, t.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }
}

module.exports = StockTransfer;
