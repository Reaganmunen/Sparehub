'use strict';

const AppError = require('../utils/AppError');
const { Payment, Sale, Customer } = require('../models');
const { handlers, need, id, pick, bool, scopeBranch, branchRequired, assertBranch, ctx, audit, requireOpenShift } = require('../utils/controller');

module.exports = handlers({
  /** GET /payments  ?branch_id &method &direction &customer_id &from &to &q &include_voided &page &limit */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await Payment.list({
      branchId: scopeBranch(req, q.branch_id), method: q.method, direction: q.direction, customerId: q.customer_id,
      from: q.from, to: q.to, q: q.q, includeVoided: bool(q.include_voided), page: q.page, limit: q.limit,
    }));
  },

  /** GET /sales/:saleId/payments */
  listBySale: async (req, res) => {
    const sale = await Sale.findById(id(req.params.saleId, 'saleId'));
    if (!sale) throw new AppError('Sale not found', 404);
    assertBranch(req, sale.branch_id);
    res.json({ data: await Payment.listBySale(sale.id) });
  },

  /**
   * POST /payments/settle-debt  { customer_id, amount, method, reference, notes }
   * A credit customer pays off what they owe. It is spread over their oldest unpaid sales first.
   */
  settleDebt: async (req, res) => {
    const b = req.body || {};
    const customerId = id(b.customer_id, 'customer_id');
    if (!(await Customer.findById(customerId))) throw new AppError('Customer not found', 404);
    const branchId = branchRequired(req, b.branch_id);
    await requireOpenShift(req, branchId);

    const result = await Payment.settleCustomerDebt(
      { ...pick(b, ['amount', 'method', 'reference', 'notes']), customer_id: customerId, branch_id: branchId, received_by: req.user.id },
      ctx(req)
    );
    await audit(req, 'payment.debt_settlement', 'customer', customerId, { amount: b.amount, method: b.method, reference: b.reference, sales_paid: result.applied.length }, branchId);
    res.status(201).json({ data: { ...result, balance: await Customer.balanceOf(customerId) } });
  },

  /** POST /payments/:id/void  { reason }  (manager / owner) - the payment stays on record, marked as voided */
  void: async (req, res) => {
    need(req, 'owner', 'manager');
    const payment = await Payment.void(id(req.params.id), (req.body || {}).reason, ctx(req));
    assertBranch(req, payment.branch_id);
    await audit(req, 'payment.void', 'payment', payment.id, { amount: payment.amount, method: payment.method, reference: payment.reference, reason: req.body.reason }, payment.branch_id);
    res.json({ data: payment });
  },
});
