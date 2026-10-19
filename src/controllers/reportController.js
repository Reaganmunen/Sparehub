'use strict';

const AppError = require('../utils/AppError');
const { Report, Expense, Branch } = require('../models');
const { toXlsx, toPdf } = require('../services/files');
const { handlers, need, isOwner, canSeeCosts, scopeBranch, dateOrUndefined, ctx } = require('../utils/controller');

/**
 * Every report is one entry: who may see it, and how to fetch it.
 * a = { branchId, from, to, limit, orderBy, days, onlyOverdue }.  Result: an array of rows (or one object).
 */
const REPORTS = {
  'daily-sales':         { title: 'Daily sales',            run: (a, o) => Report.dailySales(a, o) },
  'sales-summary':       { title: 'Sales summary',          run: (a, o) => Report.salesSummary(a, o) },
  'top-products':        { title: 'Best-selling products',  run: (a, o) => Report.topProducts(a, o) },
  'slow-movers':         { title: 'Slow-moving stock',      run: (a, o) => Report.slowMovers(a, o) },
  'low-stock':           { title: 'Low stock',              run: (a, o) => Report.lowStock(a.branchId, o) },
  'stock-value':         { title: 'Stock value',            run: (a, o) => Report.stockValue(a.branchId, o) },
  'debtors':             { title: 'Customers who owe us',   run: (a, o) => Report.debtors(a, o) },
  'overdue-sales':       { title: 'Overdue credit sales',   run: (a, o) => Report.overdueSales(a.branchId, o) },
  'creditors':           { title: 'What we owe suppliers',  run: (a, o) => Report.creditors(o), ownerOnly: true },
  'payments-by-method':  { title: 'Payments by method',     run: (a, o) => Report.paymentsByMethod(a, o) },
  'monthly-profit':      { title: 'Monthly profit and loss', run: (a, o) => Report.monthlyProfit(a, o), costs: true },
  'cashier-performance': { title: 'Cashier performance',    run: (a, o) => Report.cashierPerformance(a, o) },
  'expenses':            { title: 'Expenses by category',   run: (a) => Expense.totalsByCategory(a) },
};

function args(req) {
  const q = req.query;
  return {
    branchId: scopeBranch(req, q.branch_id),
    from: dateOrUndefined(q.from, 'from'),
    to: dateOrUndefined(q.to, 'to'),
    limit: q.limit,
    orderBy: q.order_by,
    days: q.days,
    onlyOverdue: q.only_overdue === 'true',
  };
}

function reportFor(req) {
  need(req, 'owner', 'manager');
  const report = REPORTS[req.params.name];
  if (!report) throw new AppError('Unknown report', 404);
  if (report.ownerOnly && !isOwner(req.user)) throw new AppError('Only the owner can see this report', 403, 'FORBIDDEN');
  if (report.costs && !canSeeCosts(req.user)) throw new AppError('You are not allowed to see profit figures', 403, 'FORBIDDEN');
  return report;
}

module.exports = handlers({
  /** GET /reports/dashboard  ?branch_id  - today's numbers per shop and combined (the owner's phone screen) */
  dashboard: async (req, res) => {
    need(req, 'owner', 'manager');
    res.json({ data: await Report.dashboard(scopeBranch(req, req.query.branch_id), ctx(req)) });
  },

  /**
   * GET /reports/:name  ?branch_id &from &to (YYYY-MM-DD) &limit &order_by=quantity|revenue &days &only_overdue
   * names: daily-sales, sales-summary, top-products, slow-movers, low-stock, stock-value, debtors, overdue-sales,
   *        creditors, payments-by-method, monthly-profit, cashier-performance, expenses
   * Profit and cost columns only appear for people allowed to see costs.
   */
  run: async (req, res) => {
    const report = reportFor(req);
    res.json({ data: await report.run(args(req), ctx(req)) });
  },

  /** GET /reports/:name/export  ?format=xlsx|pdf  (+ the same filters) - download */
  export: async (req, res) => {
    const report = reportFor(req);
    const a = args(req);
    let rows = await report.run(a, ctx(req));
    rows = Array.isArray(rows) ? rows : [rows];
    if (!rows.length || !rows[0]) throw new AppError('There is nothing to export for this period', 404);

    const format = req.query.format === 'pdf' ? 'pdf' : 'xlsx';
    const shop = a.branchId ? (await Branch.findById(a.branchId)).name : 'Both shops';
    const period = a.from || a.to ? `${a.from || '...'} to ${a.to || 'today'}` : 'Default period';
    const filename = `${req.params.name}${a.from ? `-${a.from}` : ''}${a.to ? `-${a.to}` : ''}.${format}`;

    if (format === 'pdf') {
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` });
      return toPdf(res, { title: report.title, subtitle: `${shop} | ${period}`, rows });
    }
    const buffer = await toXlsx(report.title, rows);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(Buffer.from(buffer));
  },
});
