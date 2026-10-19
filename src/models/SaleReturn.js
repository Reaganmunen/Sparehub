'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');
const Payment = require('./Payment');

/** A customer brings goods back from a completed sale. */
class SaleReturn {
  /**
   * data = {
   *   sale_id, reason, notes,
   *   settlement: 'refund' | 'credit_note' | 'exchange'   (refund = money back; credit_note / exchange = no money moves)
   *   restock: true | false                                (false for faulty goods that must not go back on the shelf)
   *   approved_by: user id of the manager who approved it
   *   refund_method: 'cash' | 'mpesa' | ... , refund_reference: M-Pesa code when the refund is sent by M-Pesa
   *   items: [{ sale_item_id, quantity }]
   * }
   * opts.userId = the person processing the return.
   *
   * The goods go back into stock at the cost they left it. For a refund, the money to give back is worked
   * out for you: only what the customer has actually PAID beyond what they still owe (a credit customer who
   * has not paid yet simply owes less).
   */
  static async create(data, opts = {}) {
    if (!opts.userId) throw new AppError('Who is processing this return? userId is required');
    if (!String(data.reason || '').trim()) throw new AppError('Please give a reason for the return');
    if (!Array.isArray(data.items) || !data.items.length) throw new AppError('Choose the items being returned');
    const settlement = data.settlement || 'refund';

    return db.inTransaction(opts, async (client) => {
      const sale = (await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [data.sale_id])).rows[0];
      if (!sale) throw new AppError('Sale not found', 404);
      if (sale.status !== 'completed') throw new AppError('Only a completed sale can have a return', 409);

      const created = await client.query(
        `INSERT INTO sale_returns (sale_id, branch_id, processed_by, approved_by, reason, settlement, restock, notes)
         VALUES ($1, $2, $3, $4, $5, $6::return_settlement, $7, $8) RETURNING id`,
        [sale.id, sale.branch_id, opts.userId, data.approved_by || null, data.reason, settlement, data.restock !== false, data.notes || null]
      );
      const returnId = created.rows[0].id;

      for (const it of data.items) {
        const { rows } = await client.query('SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2', [it.sale_item_id, sale.id]);
        const item = rows[0];
        if (!item) throw new AppError(`Item ${it.sale_item_id} is not part of this sale`, 404);

        // the customer gets back what they paid per unit (after any discount)
        const paidPerUnit = db.round2(item.line_total / item.quantity);
        const unitPrice = it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '' ? Number(it.unit_price) : paidPerUnit;
        if (unitPrice > paidPerUnit + 0.004) throw new AppError(`You cannot give back more than was paid (KES ${paidPerUnit} each)`);

        await client.query(
          'INSERT INTO sale_return_items (return_id, sale_item_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
          [returnId, item.id, it.quantity, unitPrice]
        );
      }

      // money back: what has been paid, beyond what is still owed after the return
      if (settlement === 'refund') {
        const after = (await client.query('SELECT total, returned_total, amount_paid FROM sales WHERE id = $1', [sale.id])).rows[0];
        const refundable = db.round2(Math.max(0, after.amount_paid - (after.total - after.returned_total)));
        if (refundable > 0.004) {
          await Payment.record(
            {
              branch_id: sale.branch_id, sale_id: sale.id, customer_id: sale.customer_id, return_id: returnId,
              direction: 'out', method: data.refund_method || 'cash', amount: refundable,
              reference: data.refund_reference, received_by: opts.userId, notes: 'Refund for returned goods',
            },
            { client }
          );
        }
      }
      return SaleReturn.findById(returnId, { client });
    });
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT r.*, s.receipt_no, u.full_name AS processed_by_name, a.full_name AS approved_by_name
         FROM sale_returns r
         JOIN sales s       ON s.id = r.sale_id
         JOIN users u       ON u.id = r.processed_by
         LEFT JOIN users a  ON a.id = r.approved_by
        WHERE r.id = $1`,
      [id],
      opts
    );
    const ret = rows[0];
    if (!ret) return null;
    ret.items = (await db.query(
      `SELECT ri.id, ri.sale_item_id, si.description, ri.quantity, ri.unit_price, ri.line_total
         FROM sale_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id
        WHERE ri.return_id = $1 ORDER BY ri.id`,
      [id],
      opts
    )).rows;
    ret.payments = (await db.query(
      'SELECT id, method, amount, reference, paid_at FROM payments WHERE return_id = $1 AND voided_at IS NULL',
      [id],
      opts
    )).rows;
    return ret;
  }

  /** f = { branchId, saleId, from, to, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('r.branch_id = ?', f.branchId);
    if (f.saleId) w.add('r.sale_id = ?', f.saleId);
    if (f.from) w.add(`${db.dayOf('r.returned_at')} >= ?::date`, f.from);
    if (f.to) w.add(`${db.dayOf('r.returned_at')} <= ?::date`, f.to);
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT r.id, r.return_no, r.sale_id, s.receipt_no, r.branch_id, r.return_total, r.settlement, r.reason,
              r.returned_at, u.full_name AS processed_by_name, COUNT(*) OVER() AS total_count
         FROM sale_returns r
         JOIN sales s ON s.id = r.sale_id
         JOIN users u ON u.id = r.processed_by
         ${w.sql()}
        ORDER BY r.returned_at DESC, r.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }
}

module.exports = SaleReturn;
