'use strict';

const AppError = require('../utils/AppError');
const { Expense } = require('../models');
const { handlers, need, id, pick, scopeBranch, branchRequired, assertBranch, ctx, audit, approvedBy, requireOpenShift } = require('../utils/controller');

module.exports = handlers({
  /**
   * POST /expenses  { branch_id?, category_id, amount, description, expense_date?, method, reference, paid_to, approval? }
   * A cashier paying from the till needs a manager's approval; a cash expense is taken out of the open shift.
   */
  create: async (req, res) => {
    const b = req.body || {};
    const branchId = branchRequired(req, b.branch_id);
    const approver = await approvedBy(req, branchId);
    if ((b.method || 'cash') === 'cash') await requireOpenShift(req, branchId);

    const expense = await Expense.create(
      { ...pick(b, ['category_id', 'amount', 'description', 'expense_date', 'method', 'reference', 'paid_to']), branch_id: branchId, approved_by: approver.id },
      ctx(req)
    );
    await audit(req, 'expense.create', 'expense', expense.id, { amount: expense.amount, description: expense.description, approved_by: approver.id }, branchId);
    res.status(201).json({ data: expense });
  },

  get: async (req, res) => {
    need(req, 'owner', 'manager');
    const expense = await Expense.findById(id(req.params.id));
    if (!expense) throw new AppError('Expense not found', 404);
    assertBranch(req, expense.branch_id);
    res.json({ data: expense });
  },

  /** GET /expenses  ?branch_id &category_id &from &to &q &page &limit */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await Expense.list({ branchId: scopeBranch(req, q.branch_id), categoryId: q.category_id, from: q.from, to: q.to, q: q.q, page: q.page, limit: q.limit }));
  },

  /** GET /expenses/totals  ?branch_id &from &to  - per category, for charts */
  totals: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json({ data: await Expense.totalsByCategory({ branchId: scopeBranch(req, q.branch_id), from: q.from, to: q.to }) });
  },
});
