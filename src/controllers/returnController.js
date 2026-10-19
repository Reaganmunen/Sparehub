'use strict';

const AppError = require('../utils/AppError');
const { Sale, SaleReturn } = require('../models');
const { handlers, need, id, pick, isManager, scopeBranch, assertBranch, ctx, audit, approvedBy, requireOpenShift } = require('../utils/controller');

module.exports = handlers({
  /**
   * POST /returns
   * { sale_id, reason, notes, settlement:'refund'|'credit_note'|'exchange', restock:true|false,
   *   refund_method:'cash'|'mpesa'..., refund_reference (M-Pesa code), items:[{sale_item_id, quantity}], approval? }
   * A cashier needs a manager's approval (their username and password); managers and the owner approve themselves.
   */
  create: async (req, res) => {
    const b = req.body || {};
    const sale = await Sale.findById(id(b.sale_id, 'sale_id'));
    if (!sale) throw new AppError('Sale not found', 404);
    assertBranch(req, sale.branch_id);

    const approver = await approvedBy(req, sale.branch_id);
    if ((b.settlement || 'refund') === 'refund') await requireOpenShift(req, sale.branch_id);

    // only a manager may give back less than the customer paid (unit_price)
    const items = (Array.isArray(b.items) ? b.items : []).map((i) => (isManager(req.user) ? pick(i, ['sale_item_id', 'quantity', 'unit_price']) : pick(i, ['sale_item_id', 'quantity'])));
    const ret = await SaleReturn.create(
      { ...pick(b, ['reason', 'notes', 'settlement', 'restock', 'refund_method', 'refund_reference']), sale_id: sale.id, approved_by: approver.id, items },
      ctx(req)
    );
    await audit(req, 'sale.return', 'sale_return', ret.id, {
      return_no: ret.return_no, receipt_no: sale.receipt_no, total: ret.return_total, settlement: ret.settlement, restock: ret.restock, reason: b.reason, approved_by: approver.id,
    }, sale.branch_id);
    res.status(201).json({ data: ret });
  },

  get: async (req, res) => {
    const ret = await SaleReturn.findById(id(req.params.id));
    if (!ret) throw new AppError('Return not found', 404);
    assertBranch(req, ret.branch_id);
    res.json({ data: ret });
  },

  /** GET /returns  ?branch_id &sale_id &from &to &page &limit */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await SaleReturn.list({ branchId: scopeBranch(req, q.branch_id), saleId: q.sale_id, from: q.from, to: q.to, page: q.page, limit: q.limit }));
  },
});
