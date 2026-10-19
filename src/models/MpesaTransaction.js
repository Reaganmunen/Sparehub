'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');
const Payment = require('./Payment');
const Sale = require('./Sale');
const { normalizePhone } = require('../utils/phone');

// Daraja sends 20261019094500 (Nairobi time)
function parseDarajaDate(value) {
  const s = String(value || '');
  if (!/^\d{14}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+03:00`;
}

/**
 * Every M-Pesa STK push (Daraja) we start, and what happened to it.
 *
 * The flow, in the controller:
 *   1. Sale.create()                       -> a held cart with its total
 *   2. MpesaTransaction.create()           -> saves the attempt (status 'initiated')
 *   3. call Daraja's STK push API          -> then attachResponse() (status 'pending'), or markFailed()
 *   4. Safaricom calls your callback URL   -> applyCallback(req.body)
 *      On success this records the payment and, when the held sale is now fully paid, completes it.
 */
class MpesaTransaction {
  /** data = { branch_id, sale_id, customer_id, phone, amount, account_reference, description, request_payload } */
  static async create(data, opts = {}) {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new AppError('Enter a valid Safaricom number, e.g. 0712345678');
    const amount = Number(data.amount);
    if (!(amount > 0)) throw new AppError('The amount must be more than zero');
    if (!Number.isInteger(amount)) throw new AppError('M-Pesa amounts must be whole shillings. Adjust the discount so the total has no cents.');

    return db.inTransaction(opts, async (client) => {
      if (data.sale_id) {
        // stop a double prompt: one just went to the customer's phone
        const recent = await client.query(
          `SELECT id FROM mpesa_transactions
            WHERE sale_id = $1 AND status IN ('initiated', 'pending') AND created_at > now() - interval '90 seconds'`,
          [data.sale_id]
        );
        if (recent.rows.length) {
          throw new AppError('A payment request was just sent to the customer. Wait for them to respond.', 409, 'STK_PENDING');
        }
      }
      const { rows } = await client.query(
        `INSERT INTO mpesa_transactions (branch_id, sale_id, customer_id, initiated_by, phone_number, amount,
                                         till_number, account_reference, description, request_payload)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT mpesa_till_number FROM branches WHERE id = $1), $7, $8, $9::jsonb)
         RETURNING *`,
        [
          data.branch_id, data.sale_id || null, data.customer_id || null, opts.userId || null, phone, amount,
          data.account_reference || null, data.description || null,
          data.request_payload ? JSON.stringify(data.request_payload) : null,
        ]
      );
      return rows[0];
    });
  }

  /** Daraja accepted the request: the customer's phone is now showing the PIN prompt. */
  static async attachResponse(id, { merchantRequestId, checkoutRequestId, resultDesc }, opts = {}) {
    const { rows } = await db.query(
      `UPDATE mpesa_transactions
          SET merchant_request_id = $2, checkout_request_id = $3, result_desc = $4, status = 'pending'
        WHERE id = $1 RETURNING *`,
      [id, merchantRequestId || null, checkoutRequestId || null, resultDesc || null],
      opts
    );
    return rows[0] || null;
  }

  /** Daraja refused the request, or we could not reach it. */
  static async markFailed(id, description, opts = {}) {
    const { rows } = await db.query(
      "UPDATE mpesa_transactions SET status = 'failed', result_desc = $2 WHERE id = $1 AND status IN ('initiated', 'pending') RETURNING *",
      [id, description || 'Request failed'],
      opts
    );
    return rows[0] || null;
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query('SELECT * FROM mpesa_transactions WHERE id = $1', [id], opts);
    return rows[0] || null;
  }

  static async findByCheckoutRequestId(checkoutRequestId, opts = {}) {
    const { rows } = await db.query('SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1', [checkoutRequestId], opts);
    return rows[0] || null;
  }

  /** The attempts for a sale (the till polls this to see when the customer has paid). */
  static async listForSale(saleId, opts = {}) {
    const { rows } = await db.query(
      `SELECT id, phone_number, amount, status, result_desc, mpesa_receipt_number, created_at
         FROM mpesa_transactions WHERE sale_id = $1 ORDER BY id DESC`,
      [saleId],
      opts
    );
    return rows;
  }

  /**
   * Handles Safaricom's callback. Pass req.body as it arrives. Safe to call twice with the same body.
   * Never throws for a business problem, so you can always answer Safaricom with
   *   { ResultCode: 0, ResultDesc: 'Accepted' }
   * Returns { transaction, paymentApplied, saleCompleted, warning } or { ignored: true } / { duplicate: true }.
   */
  static async applyCallback(body, opts = {}) {
    const cb = body && body.Body && body.Body.stkCallback;
    if (!cb || !cb.CheckoutRequestID) return { ignored: true, reason: 'Not an STK callback' };

    const meta = {};
    const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
    for (const it of items) meta[it.Name] = it.Value;

    const code = Number(cb.ResultCode);
    const status = code === 0 ? 'success' : code === 1032 ? 'cancelled' : code === 1037 ? 'timeout' : 'failed';

    return db.inTransaction(opts, async (client) => {
      const found = await client.query('SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1 FOR UPDATE', [cb.CheckoutRequestID]);
      const tx = found.rows[0];
      if (!tx) return { ignored: true, reason: 'Unknown CheckoutRequestID' };
      if (tx.status === 'success') return { duplicate: true, transaction: tx };

      const updated = (await client.query(
        `UPDATE mpesa_transactions
            SET status = $2::mpesa_status, result_code = $3, result_desc = $4, mpesa_receipt_number = $5,
                transaction_date = $6::timestamptz, callback_payload = $7::jsonb
          WHERE id = $1 RETURNING *`,
        [
          tx.id, status, Number.isNaN(code) ? null : code, cb.ResultDesc || null,
          meta.MpesaReceiptNumber || null, parseDarajaDate(meta.TransactionDate), JSON.stringify(body),
        ]
      )).rows[0];

      const result = { transaction: updated, paymentApplied: false, saleCompleted: false, warning: null };
      if (status !== 'success' || !tx.sale_id) return result;

      // 1. record the money (its own savepoint: if this fails nothing half-happens)
      await client.query('SAVEPOINT apply_payment');
      try {
        const sale = (await client.query('SELECT cashier_id FROM sales WHERE id = $1', [tx.sale_id])).rows[0];
        await Payment.record(
          {
            branch_id: tx.branch_id,
            sale_id: tx.sale_id,
            customer_id: tx.customer_id,
            mpesa_transaction_id: tx.id,
            method: 'mpesa',
            amount: Number(meta.Amount ?? tx.amount),
            reference: meta.MpesaReceiptNumber,
            received_by: tx.initiated_by || sale.cashier_id,
          },
          { client }
        );
        await client.query('RELEASE SAVEPOINT apply_payment');
        result.paymentApplied = true;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT apply_payment');
        result.warning = `Payment ${meta.MpesaReceiptNumber || ''} was received but not applied: ${err.message}`;
      }

      // 2. if the held sale is now fully paid, complete it (separate savepoint: the payment stays even if this fails)
      if (result.paymentApplied) {
        await client.query('SAVEPOINT complete_sale');
        try {
          const sale = (await client.query('SELECT status, total, returned_total, amount_paid FROM sales WHERE id = $1', [tx.sale_id])).rows[0];
          if (sale.status === 'held' && db.round2(sale.total - sale.returned_total - sale.amount_paid) <= 0.004) {
            await Sale.complete(tx.sale_id, { client });
            result.saleCompleted = true;
          }
          await client.query('RELEASE SAVEPOINT complete_sale');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT complete_sale');
          result.warning = `Payment applied, but the sale could not be completed: ${err.message}`;
        }
      }

      if (result.warning) {
        await client.query(
          "UPDATE mpesa_transactions SET result_desc = COALESCE(result_desc, '') || $2 WHERE id = $1",
          [tx.id, ` | NEEDS REVIEW: ${result.warning}`]
        );
      }
      return result;
    });
  }

  /** Marks prompts that never got an answer as timed out (run it every few minutes from a timer). */
  static async expireStale(minutes = 3, opts = {}) {
    const { rowCount } = await db.query(
      `UPDATE mpesa_transactions SET status = 'timeout', result_desc = COALESCE(result_desc, 'No response from customer')
        WHERE status IN ('initiated', 'pending') AND created_at < now() - make_interval(mins => $1::int)`,
      [minutes],
      opts
    );
    return rowCount;
  }

  /** M-Pesa takings that need a person's attention (money received but not applied). */
  static async needingReview(branchId, opts = {}) {
    const { rows } = await db.query(
      `SELECT id, branch_id, sale_id, phone_number, amount, mpesa_receipt_number, result_desc, created_at
         FROM mpesa_transactions
        WHERE result_desc LIKE '%NEEDS REVIEW%' AND ($1::int IS NULL OR branch_id = $1)
        ORDER BY created_at DESC`,
      [branchId || null],
      opts
    );
    return rows;
  }
}

module.exports = MpesaTransaction;
