'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

const METHODS = ['cash', 'mpesa', 'bank_transfer', 'card'];

/**
 * Money received from customers ('in') or paid back to them ('out').
 * Payments are never deleted: a wrong one is voided with a reason.
 * The sale's amount_paid and payment_status update themselves.
 */
class Payment {
  /**
   * data = { branch_id, sale_id, customer_id, return_id, mpesa_transaction_id, shift_id, direction ('in'|'out'),
   *          method, amount, reference, received_by, paid_at, notes }
   * - M-Pesa payments need the transaction code in `reference` (it can only be used once, ever).
   * - Cash is added to the cashier's open shift automatically.
   * - A payment on a sale can not be more than what is still owing (and a refund not more than what was paid).
   */
  static async record(data, opts = {}) {
    const direction = data.direction || 'in';
    const method = data.method;
    const amount = db.round2(data.amount);
    if (!METHODS.includes(method)) throw new AppError('Choose a payment method: cash, M-Pesa, bank transfer or card');
    if (!['in', 'out'].includes(direction)) throw new AppError('Unknown payment direction');
    if (!(amount > 0)) throw new AppError('The amount must be more than zero');
    const reference = data.reference ? String(data.reference).trim().toUpperCase() : null;
    if (method === 'mpesa' && !reference) throw new AppError('Enter the M-Pesa transaction code');
    if (!data.received_by) throw new AppError('received_by (the logged-in user) is required');

    return db.inTransaction(opts, async (client) => {
      let customerId = data.customer_id || null;
      let branchId = data.branch_id;

      if (data.sale_id) {
        const { rows } = await client.query(
          'SELECT status, branch_id, customer_id, total, returned_total, amount_paid FROM sales WHERE id = $1 FOR UPDATE',
          [data.sale_id]
        );
        const sale = rows[0];
        if (!sale) throw new AppError('Sale not found', 404);
        if (sale.status === 'voided') throw new AppError('This sale has been voided', 409);
        const due = db.round2(sale.total - sale.returned_total - sale.amount_paid);
        if (direction === 'in' && amount > due + 0.004) {
          throw new AppError(`The payment of KES ${amount} is more than the balance of KES ${due}`, 409, 'OVERPAYMENT');
        }
        if (direction === 'out' && amount > Number(sale.amount_paid) + 0.004) {
          throw new AppError(`You cannot refund more than was paid (KES ${sale.amount_paid})`, 409);
        }
        customerId = customerId || sale.customer_id;
        branchId = branchId || sale.branch_id;
      }
      if (!branchId) throw new AppError('branch_id is required');

      const { rows } = await client.query(
        `INSERT INTO payments (branch_id, sale_id, customer_id, return_id, mpesa_transaction_id, shift_id,
                               direction, method, amount, reference, received_by, paid_at, notes)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE($6::int, (SELECT id FROM shifts WHERE cashier_id = $11 AND branch_id = $1 AND status = 'open')),
                 $7::payment_direction, $8::payment_method, $9, $10, $11, COALESCE($12::timestamptz, now()), $13)
         RETURNING *`,
        [
          branchId, data.sale_id || null, customerId, data.return_id || null, data.mpesa_transaction_id || null,
          data.shift_id || null, direction, method, amount, reference, data.received_by, data.paid_at || null,
          data.notes || null,
        ]
      );
      return rows[0];
    });
  }

  /**
   * A customer pays off what they owe (not tied to one receipt). The amount is spread over their oldest
   * unpaid sales first. Any leftover is kept as an on-account credit.
   * For M-Pesa, a payment split over several sales gets the code with /2, /3 added (the code itself can
   * only be used once).
   * data = { customer_id, branch_id, amount, method, reference, received_by, notes }
   */
  static async settleCustomerDebt(data, opts = {}) {
    const amount = db.round2(data.amount);
    if (!(amount > 0)) throw new AppError('The amount must be more than zero');

    return db.inTransaction(opts, async (client) => {
      const { rows: sales } = await client.query(
        `SELECT id, (total - returned_total - amount_paid) AS due
           FROM sales
          WHERE customer_id = $1 AND status = 'completed' AND total - returned_total - amount_paid > 0
          ORDER BY sold_at, id
            FOR UPDATE`,
        [data.customer_id]
      );

      let left = amount;
      let part = 0;
      const applied = [];
      const refFor = () => (part <= 1 || !data.reference ? data.reference : `${data.reference}/${part}`);

      for (const s of sales) {
        if (left <= 0.004) break;
        const pay = Math.min(left, db.round2(s.due));
        part++;
        const payment = await Payment.record({ ...data, sale_id: s.id, amount: pay, reference: refFor() }, { client });
        applied.push({ sale_id: s.id, payment_id: payment.id, amount: pay });
        left = db.round2(left - pay);
      }

      let onAccount = null;
      if (left > 0.004) {
        part++;
        onAccount = await Payment.record({ ...data, sale_id: null, amount: left, reference: refFor() }, { client });
      }
      return { applied, on_account: onAccount };
    });
  }

  /** opts.userId = who is voiding it. */
  static async void(id, reason, opts = {}) {
    if (!String(reason || '').trim()) throw new AppError('Please give a reason for voiding this payment');
    const { rows } = await db.query(
      `UPDATE payments SET voided_at = now(), voided_by = $2, void_reason = $3
        WHERE id = $1 AND voided_at IS NULL RETURNING *`,
      [id, opts.userId || null, reason],
      opts
    );
    if (!rows[0]) throw new AppError('Payment not found or already voided', 404);
    return rows[0];
  }

  static async listBySale(saleId, opts = {}) {
    const { rows } = await db.query(
      `SELECT p.*, u.full_name AS received_by_name FROM payments p JOIN users u ON u.id = p.received_by
        WHERE p.sale_id = $1 ORDER BY p.paid_at, p.id`,
      [saleId],
      opts
    );
    return rows;
  }

  /** f = { branchId, method, direction, customerId, from, to, includeVoided, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('p.branch_id = ?', f.branchId);
    if (f.method) w.add('p.method = ?::payment_method', f.method);
    if (f.direction) w.add('p.direction = ?::payment_direction', f.direction);
    if (f.customerId) w.add('p.customer_id = ?', f.customerId);
    if (f.from) w.add(`${db.dayOf('p.paid_at')} >= ?::date`, f.from);
    if (f.to) w.add(`${db.dayOf('p.paid_at')} <= ?::date`, f.to);
    if (!f.includeVoided) w.add('p.voided_at IS NULL');
    if (f.q) w.search(['p.reference', 's.receipt_no'], f.q);
    const pg = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT p.*, s.receipt_no, c.name AS customer_name, u.full_name AS received_by_name, COUNT(*) OVER() AS total_count
         FROM payments p
         LEFT JOIN sales s     ON s.id = p.sale_id
         LEFT JOIN customers c ON c.id = p.customer_id
         JOIN users u          ON u.id = p.received_by
         ${w.sql()}
        ORDER BY p.paid_at DESC, p.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, pg.limit, pg.offset],
      opts
    );
    return db.toPage(rows, pg);
  }
}

module.exports = Payment;
