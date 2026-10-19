'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

const METHODS = ['cash', 'mpesa', 'bank_transfer', 'card'];

/** Money paid TO suppliers. The purchase's amount_paid and payment_status update themselves. */
class SupplierPayment {
  /** data = { supplier_id, purchase_id (optional), branch_id, amount, method, reference, paid_at, notes } */
  static async create(data, opts = {}) {
    const amount = db.round2(data.amount);
    if (!(amount > 0)) throw new AppError('The amount must be more than zero');
    if (!METHODS.includes(data.method || 'cash')) throw new AppError('Unknown payment method');

    return db.inTransaction(opts, async (client) => {
      if (data.purchase_id) {
        const { rows } = await client.query(
          'SELECT supplier_id, status, total, amount_paid FROM purchases WHERE id = $1 FOR UPDATE',
          [data.purchase_id]
        );
        const purchase = rows[0];
        if (!purchase) throw new AppError('Purchase not found', 404);
        if (purchase.supplier_id !== Number(data.supplier_id)) throw new AppError('That purchase belongs to a different supplier');
        if (purchase.status !== 'received') throw new AppError('Only a received purchase can be paid', 409);
        const due = db.round2(purchase.total - purchase.amount_paid);
        if (amount > due + 0.004) throw new AppError(`The balance on this purchase is only KES ${due}`, 409);
      }
      const result = await client.query(
        `INSERT INTO supplier_payments (supplier_id, purchase_id, branch_id, amount, method, reference, paid_at, notes, created_by)
         VALUES ($1, $2, $3, $4, $5::payment_method, $6, COALESCE($7::timestamptz, now()), $8, $9)
         RETURNING *`,
        [
          data.supplier_id, data.purchase_id || null, data.branch_id || null, amount, data.method || 'cash',
          data.reference || null, data.paid_at || null, data.notes || null, opts.userId || null,
        ]
      );
      return result.rows[0];
    });
  }

  /** A payment made by mistake is voided (kept for the record), never deleted. */
  static async void(id, opts = {}) {
    const { rows } = await db.query(
      'UPDATE supplier_payments SET voided_at = now() WHERE id = $1 AND voided_at IS NULL RETURNING *',
      [id],
      opts
    );
    if (!rows[0]) throw new AppError('Payment not found or already voided', 404);
    return rows[0];
  }

  static async listBySupplier(supplierId, opts = {}) {
    const { rows } = await db.query(
      'SELECT * FROM supplier_payments WHERE supplier_id = $1 ORDER BY paid_at DESC, id DESC LIMIT 200',
      [supplierId],
      opts
    );
    return rows;
  }
}

module.exports = SupplierPayment;
