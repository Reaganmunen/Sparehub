'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

function checkItems(items) {
  if (!Array.isArray(items) || !items.length) throw new AppError('Add at least one product to the purchase');
  const seen = new Set();
  for (const it of items) {
    if (!(Number(it.quantity) > 0)) throw new AppError('Every quantity must be more than zero');
    if (!(Number(it.unit_cost) >= 0)) throw new AppError('Every buying price must be zero or more');
    if (seen.has(Number(it.product_id))) throw new AppError('The same product appears twice. Combine the quantities into one line.');
    seen.add(Number(it.product_id));
  }
}

async function insertItems(client, purchaseId, items) {
  for (const it of items) {
    await client.query(
      'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)',
      [purchaseId, it.product_id, it.quantity, it.unit_cost]
    );
  }
}

/** Stock bought from suppliers. A purchase is a draft until it is received; receiving adds the stock. */
class Purchase {
  /**
   * data = { branch_id, supplier_id, supplier_invoice_no, purchase_date, transport_cost, other_costs,
   *          due_date, notes, items: [{ product_id, quantity, unit_cost }], receive: true|false }
   * receive: true books the goods into stock straight away. opts.userId is who receives them.
   * Transport and other costs are shared across the items to give each product its true landed cost.
   */
  static async create(data, opts = {}) {
    checkItems(data.items);
    return db.inTransaction(opts, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO purchases (branch_id, supplier_id, supplier_invoice_no, purchase_date, transport_cost,
                                other_costs, due_date, notes, created_by)
         VALUES ($1, $2, $3, COALESCE($4::date, ${db.TODAY}), COALESCE($5::numeric, 0), COALESCE($6::numeric, 0),
                 COALESCE($7::date, COALESCE($4::date, ${db.TODAY})
                                    + COALESCE((SELECT payment_terms_days FROM suppliers WHERE id = $2), 0)),
                 $8, $9)
         RETURNING id`,
        [
          data.branch_id, data.supplier_id, data.supplier_invoice_no || null, data.purchase_date || null,
          data.transport_cost ?? null, data.other_costs ?? null, data.due_date || null, data.notes || null,
          opts.userId || null,
        ]
      );
      const id = rows[0].id;
      await insertItems(client, id, data.items);
      if (data.receive) {
        await client.query("UPDATE purchases SET status = 'received', received_by = $2 WHERE id = $1", [id, opts.userId || null]);
      }
      return Purchase.findById(id, { client });
    });
  }

  /** Edit a draft purchase. If data.items is given it replaces the whole item list. */
  static async updateDraft(id, data, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      const cur = await client.query('SELECT status FROM purchases WHERE id = $1 FOR UPDATE', [id]);
      if (!cur.rows[0]) throw new AppError('Purchase not found', 404);
      if (cur.rows[0].status !== 'draft') throw new AppError('Only a draft purchase can be edited', 409);

      const allowed = ['supplier_id', 'supplier_invoice_no', 'purchase_date', 'transport_cost', 'other_costs', 'due_date', 'notes'];
      if (allowed.some((k) => data[k] !== undefined)) {
        const up = db.buildUpdate(data, allowed, 2);
        await client.query(`UPDATE purchases SET ${up.sets} WHERE id = $1`, [id, ...up.values]);
      }
      if (data.items !== undefined) {
        checkItems(data.items);
        await client.query('DELETE FROM purchase_items WHERE purchase_id = $1', [id]);
        await insertItems(client, id, data.items);
      }
      return Purchase.findById(id, { client });
    });
  }

  /** Books the goods into stock, updates the buying prices and average cost. opts.userId = who received them. */
  static async receive(id, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE purchases SET status = 'received', received_by = $2 WHERE id = $1 AND status = 'draft'",
        [id, opts.userId || null]
      );
      if (!rowCount) throw new AppError('Only a draft purchase can be received', 409);
      return Purchase.findById(id, { client });
    });
  }

  static async cancel(id, opts = {}) {
    const { rowCount } = await db.query("UPDATE purchases SET status = 'cancelled' WHERE id = $1 AND status = 'draft'", [id], opts);
    if (!rowCount) throw new AppError('Only a draft purchase can be cancelled', 409);
    return Purchase.findById(id, opts);
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT p.*, s.name AS supplier_name, b.name AS branch_name, (p.total - p.amount_paid) AS balance_due
         FROM purchases p
         JOIN suppliers s ON s.id = p.supplier_id
         JOIN branches b  ON b.id = p.branch_id
        WHERE p.id = $1`,
      [id],
      opts
    );
    const purchase = rows[0];
    if (!purchase) return null;
    purchase.items = (await db.query(
      `SELECT i.id, i.product_id, pr.sku, pr.name AS product_name, i.quantity, i.unit_cost, i.line_total, i.landed_unit_cost
         FROM purchase_items i JOIN products pr ON pr.id = i.product_id
        WHERE i.purchase_id = $1 ORDER BY i.id`,
      [id],
      opts
    )).rows;
    purchase.payments = (await db.query(
      `SELECT id, amount, method, reference, paid_at, voided_at FROM supplier_payments
        WHERE purchase_id = $1 ORDER BY paid_at, id`,
      [id],
      opts
    )).rows;
    return purchase;
  }

  /** f = { branchId, supplierId, status, paymentStatus, from, to, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('p.branch_id = ?', f.branchId);
    if (f.supplierId) w.add('p.supplier_id = ?', f.supplierId);
    if (f.status) w.add('p.status = ?::purchase_status', f.status);
    if (f.paymentStatus) w.add('p.payment_status = ?::payment_status', f.paymentStatus);
    if (f.from) w.add('p.purchase_date >= ?::date', f.from);
    if (f.to) w.add('p.purchase_date <= ?::date', f.to);
    if (f.q) w.search(['p.purchase_no', 'p.supplier_invoice_no', 's.name'], f.q);
    const pg = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT p.id, p.purchase_no, p.branch_id, p.supplier_id, s.name AS supplier_name, p.supplier_invoice_no,
              p.purchase_date, p.status, p.total, p.amount_paid, (p.total - p.amount_paid) AS balance_due,
              p.payment_status, p.due_date, COUNT(*) OVER() AS total_count
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
         ${w.sql()}
        ORDER BY p.purchase_date DESC, p.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, pg.limit, pg.offset],
      opts
    );
    return db.toPage(rows, pg);
  }
}

module.exports = Purchase;
