'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * A physical count of one shop's stock.
 *   start()      copies every stocked product and its system quantity into the count sheet
 *   setCounts()  records what was actually counted on the shelf
 *   complete()   posts the differences as stock adjustments (only for products that were counted)
 * Tip: count while the shop is quiet. Sales made after an item is counted are still deducted normally.
 */
class Stocktake {
  /** opts.userId = who starts the count. Only one count per shop can be open at a time. */
  static async start(branchId, opts = {}) {
    if (!opts.userId) throw new AppError('userId is required');
    try {
      const { rows } = await db.query('SELECT start_stocktake($1, $2) AS id', [branchId, opts.userId], opts);
      return Stocktake.findById(rows[0].id, opts);
    } catch (err) {
      if (err.code === '23505') throw new AppError('A stocktake is already in progress for this shop', 409);
      throw err;
    }
  }

  /** counts = [{ product_id, counted_quantity, reason }] */
  static async setCounts(id, counts, opts = {}) {
    if (!Array.isArray(counts) || !counts.length) throw new AppError('No counts supplied');
    return db.inTransaction(opts, async (client) => {
      const st = await client.query('SELECT status FROM stocktakes WHERE id = $1 FOR UPDATE', [id]);
      if (!st.rows[0]) throw new AppError('Stocktake not found', 404);
      if (st.rows[0].status !== 'in_progress') throw new AppError('This stocktake is already closed', 409);

      for (const c of counts) {
        const qty = Number(c.counted_quantity);
        if (c.counted_quantity === '' || c.counted_quantity === null || Number.isNaN(qty) || qty < 0) {
          throw new AppError('Every counted quantity must be zero or more');
        }
        const { rowCount } = await client.query(
          `UPDATE stocktake_items SET counted_quantity = $3, reason = COALESCE($4, reason)
            WHERE stocktake_id = $1 AND product_id = $2`,
          [id, c.product_id, qty, c.reason || null]
        );
        if (!rowCount) throw new AppError(`Product ${c.product_id} is not on this count sheet`, 404);
      }
      return Stocktake.findById(id, { client });
    });
  }

  /** Posts the differences and closes the count. opts.userId = who completes it. */
  static async complete(id, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE stocktakes SET status = 'completed', completed_by = $2, completed_at = now() WHERE id = $1 AND status = 'in_progress'",
        [id, opts.userId || null]
      );
      if (!rowCount) throw new AppError('Only a stocktake in progress can be completed', 409);
      return Stocktake.findById(id, { client });
    });
  }

  static async cancel(id, opts = {}) {
    const { rowCount } = await db.query(
      "UPDATE stocktakes SET status = 'cancelled' WHERE id = $1 AND status = 'in_progress'",
      [id],
      opts
    );
    if (!rowCount) throw new AppError('Only a stocktake in progress can be cancelled', 409);
    return Stocktake.findById(id, opts);
  }

  /** The count sheet with a summary: how many counted, how many differ. */
  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT s.*, b.name AS branch_name, u.full_name AS started_by_name, c.full_name AS completed_by_name
         FROM stocktakes s
         JOIN branches b      ON b.id = s.branch_id
         JOIN users u         ON u.id = s.started_by
         LEFT JOIN users c    ON c.id = s.completed_by
        WHERE s.id = $1`,
      [id],
      opts
    );
    const st = rows[0];
    if (!st) return null;
    st.items = (await db.query(
      `SELECT i.id, i.product_id, p.sku, p.barcode, p.name AS product_name, i.system_quantity, i.counted_quantity,
              i.difference, i.reason
         FROM stocktake_items i JOIN products p ON p.id = i.product_id
        WHERE i.stocktake_id = $1 ORDER BY p.name`,
      [id],
      opts
    )).rows;
    st.summary = {
      total_items: st.items.length,
      counted: st.items.filter((x) => x.counted_quantity !== null).length,
      not_counted: st.items.filter((x) => x.counted_quantity === null).length,
      with_differences: st.items.filter((x) => x.difference !== null && x.difference !== 0).length,
    };
    return st;
  }

  /** f = { branchId, status } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('s.branch_id = ?', f.branchId);
    if (f.status) w.add('s.status = ?::stocktake_status', f.status);
    const { rows } = await db.query(
      `SELECT s.id, s.branch_id, b.name AS branch_name, s.status, s.started_at, s.completed_at,
              u.full_name AS started_by_name
         FROM stocktakes s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.started_by
         ${w.sql()}
        ORDER BY s.started_at DESC LIMIT 100`,
      w.values,
      opts
    );
    return rows;
  }
}

module.exports = Stocktake;
