'use strict';

const crypto = require('crypto');
const AppError = require('../utils/AppError');
const db = require('../config/db');
const { Sale, Branch, MpesaTransaction, AuditLog } = require('../models');
const daraja = require('../services/daraja');
const {
  handlers, need, id, scopeBranch, assertBranch, ctx, audit, requireOpenShift,
} = require('../utils/controller');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const dueOf = (s) => db.round2(Number(s.total) - Number(s.returned_total) - Number(s.amount_paid));

module.exports = {
  ...handlers({
    /**
     * POST /mpesa/stk-push  { sale_id, phone?, amount? }
     * The sale must already exist (POST /sales/hold). phone defaults to the customer's number; amount defaults to
     * the whole balance - give a smaller amount for a split payment (take the cash part with /sales/:id/payments).
     * The customer gets the PIN prompt. The till then polls GET /mpesa/sales/:saleId until it shows success.
     */
    stkPush: async (req, res) => {
      const b = req.body || {};
      const sale = await Sale.findById(id(b.sale_id, 'sale_id'));
      if (!sale) throw new AppError('Sale not found', 404);
      assertBranch(req, sale.branch_id);
      if (sale.status === 'voided') throw new AppError('This sale has been voided', 409);
      if (sale.status === 'held' && req.user.role === 'cashier' && sale.cashier_id !== req.user.id) {
        throw new AppError('This sale was started by another cashier', 403);
      }
      await requireOpenShift(req, sale.branch_id);

      const due = dueOf(sale);
      if (due <= 0.004) throw new AppError('There is nothing left to pay on this sale', 409);
      const amount = b.amount === undefined || b.amount === '' ? due : Number(b.amount);
      if (!(amount > 0) || amount > due + 0.004) throw new AppError(`The amount must be between 1 and the balance of KES ${due}`);
      const phone = b.phone || sale.customer_phone;
      if (!phone) throw new AppError("Enter the customer's M-Pesa phone number");

      const branch = await Branch.findById(sale.branch_id);
      const reference = sale.receipt_no || `SALE${sale.id}`;

      // 1. save the attempt (this also blocks a second prompt within 90 seconds)
      const tx = await MpesaTransaction.create(
        { branch_id: sale.branch_id, sale_id: sale.id, customer_id: sale.customer_id, phone, amount, account_reference: reference, description: 'Payment' },
        ctx(req)
      );

      // 2. ask Safaricom to send the prompt
      let response;
      try {
        response = await daraja.stkPush({ branch, phone: tx.phone_number, amount: tx.amount, accountReference: reference, description: 'Payment' });
      } catch (err) {
        await MpesaTransaction.markFailed(tx.id, err.message);
        throw err;
      }
      const pending = await MpesaTransaction.attachResponse(tx.id, {
        merchantRequestId: response.MerchantRequestID,
        checkoutRequestId: response.CheckoutRequestID,
        resultDesc: response.CustomerMessage || response.ResponseDescription,
      });
      await audit(req, 'mpesa.stk_push', 'sale', sale.id, { transaction_id: tx.id, amount: tx.amount, phone: tx.phone_number }, sale.branch_id);
      res.status(202).json({ data: pending });
    },

    /**
     * GET /mpesa/sales/:saleId  - the till polls this every 2-3 seconds after sending a prompt.
     * Done when a transaction has status 'success' (or the sale is completed / fully paid).
     */
    status: async (req, res) => {
      const sale = await Sale.findById(id(req.params.saleId, 'saleId'));
      if (!sale) throw new AppError('Sale not found', 404);
      assertBranch(req, sale.branch_id);
      res.json({
        data: {
          transactions: await MpesaTransaction.listForSale(sale.id),
          sale: { id: sale.id, status: sale.status, total: sale.total, amount_paid: sale.amount_paid, balance_due: dueOf(sale), payment_status: sale.payment_status },
        },
      });
    },

    /** GET /mpesa/review  - money Safaricom confirmed that the system could not apply to a sale. Needs a person. */
    needingReview: async (req, res) => {
      need(req, 'owner', 'manager');
      res.json({ data: await MpesaTransaction.needingReview(scopeBranch(req, req.query.branch_id)) });
    },
  }),

  /**
   * POST /mpesa/callback/:secret   (PUBLIC - Safaricom calls this, there is no logged-in user)
   * Always answers Safaricom with ResultCode 0. If something goes wrong on our side the full body is printed to the
   * console so the payment can be recovered by hand (the M-Pesa receipt number is inside it).
   */
  callback: async (req, res) => {
    const expected = process.env.MPESA_CALLBACK_SECRET;
    if (!expected || !safeEqual(req.params.secret || '', expected)) {
      return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
    }
    try {
      const result = await MpesaTransaction.applyCallback(req.body);
      if (result.warning) console.error('[mpesa] NEEDS REVIEW:', result.warning);
      if (result.paymentApplied) {
        const tx = result.transaction;
        await AuditLog.log({
          branch_id: tx.branch_id, action: 'mpesa.payment_received', entity_type: 'sale', entity_id: tx.sale_id,
          details: { mpesa_receipt: tx.mpesa_receipt_number, amount: tx.amount, sale_completed: result.saleCompleted },
        });
      }
    } catch (err) {
      console.error('[mpesa] callback failed:', err.message, JSON.stringify(req.body));
    }
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  },

  /** Call once from server.js: prompts nobody answered are marked as timed out every minute. */
  startExpiryJob(minutes = 3) {
    const timer = setInterval(() => {
      MpesaTransaction.expireStale(minutes).catch((err) => console.error('[mpesa] expire job failed:', err.message));
    }, 60 * 1000);
    timer.unref();
    return timer;
  },
};
