'use strict';

const AppError = require('../utils/AppError');
const { Shift } = require('../models');
const { handlers, id, isManager, scopeBranch, branchRequired, assertBranch, audit } = require('../utils/controller');

/** Loads a shift's summary and checks the user may look at it: its cashier, or a manager of that shop, or the owner. */
async function loadShift(req) {
  const shift = await Shift.summary(id(req.params.id));
  if (!shift) throw new AppError('Shift not found', 404);
  assertBranch(req, shift.branch_id);
  if (!isManager(req.user) && shift.cashier_id !== req.user.id) throw new AppError('That is another cashier\'s shift', 403);
  return shift;
}

module.exports = handlers({
  /** POST /shifts/open  { opening_float, branch_id? } */
  open: async (req, res) => {
    const branchId = branchRequired(req, (req.body || {}).branch_id);
    const shift = await Shift.open({ branch_id: branchId, cashier_id: req.user.id, opening_float: Number((req.body || {}).opening_float) || 0 });
    await audit(req, 'shift.open', 'shift', shift.id, { opening_float: shift.opening_float }, branchId);
    res.status(201).json({ data: shift });
  },

  /** GET /shifts/current  - my open shift with live totals, or null */
  current: async (req, res) => {
    const open = await Shift.findOpenForCashier(req.user.id);
    res.json({ data: open ? await Shift.summary(open.id) : null });
  },

  /** POST /shifts/:id/close  { counted_cash, notes } -> the summary with expected cash and the difference */
  close: async (req, res) => {
    const shift = await loadShift(req);
    const summary = await Shift.close(shift.shift_id, { counted_cash: (req.body || {}).counted_cash, notes: (req.body || {}).notes });
    await audit(req, 'shift.close', 'shift', shift.shift_id, { counted_cash: req.body.counted_cash, summary }, shift.branch_id);
    res.json({ data: summary });
  },

  get: async (req, res) => {
    res.json({ data: await loadShift(req) });
  },

  /** GET /shifts  ?branch_id &cashier_id &status &from &to &page &limit  (cashiers only ever see their own) */
  list: async (req, res) => {
    const q = req.query;
    res.json(await Shift.list({
      branchId: scopeBranch(req, q.branch_id),
      cashierId: isManager(req.user) ? q.cashier_id : req.user.id,
      status: q.status, from: q.from, to: q.to, page: q.page, limit: q.limit,
    }));
  },
});
