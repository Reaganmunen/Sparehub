'use strict';

const AppError = require('../utils/AppError');
const { Purchase } = require('../models');
const { handlers, need, id, pick, scopeBranch, branchRequired, assertBranch, ctx, audit } = require('../utils/controller');

const FIELDS = ['supplier_id', 'supplier_invoice_no', 'purchase_date', 'transport_cost', 'other_costs', 'due_date', 'notes'];

async function load(req) {
  const purchase = await Purchase.findById(id(req.params.id));
  if (!purchase) throw new AppError('Purchase not found', 404);
  assertBranch(req, purchase.branch_id);
  return purchase;
}

module.exports = handlers({
  /** GET /purchases  ?branch_id &supplier_id &status &payment_status &from &to &q &page &limit */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await Purchase.list(
      { branchId: scopeBranch(req, q.branch_id), supplierId: q.supplier_id, status: q.status, paymentStatus: q.payment_status, from: q.from, to: q.to, q: q.q, page: q.page, limit: q.limit },
      ctx(req)
    ));
  },

  get: async (req, res) => {
    need(req, 'owner', 'manager');
    res.json({ data: await load(req) });
  },

  /**
   * POST /purchases  { branch_id?, supplier_id, supplier_invoice_no, purchase_date, transport_cost, other_costs, due_date, notes,
   *                    items:[{product_id, quantity, unit_cost}], receive: true|false }
   * receive:true books the goods into stock immediately.
   */
  create: async (req, res) => {
    need(req, 'owner', 'manager');
    const b = req.body || {};
    const branchId = branchRequired(req, b.branch_id);
    const purchase = await Purchase.create({ ...pick(b, FIELDS), branch_id: branchId, items: b.items, receive: b.receive === true }, ctx(req));
    await audit(req, b.receive === true ? 'purchase.receive' : 'purchase.create', 'purchase', purchase.id, { purchase_no: purchase.purchase_no, total: purchase.total, supplier_id: purchase.supplier_id }, branchId);
    res.status(201).json({ data: purchase });
  },

  /** PUT /purchases/:id  (drafts only; items replaces the whole list) */
  updateDraft: async (req, res) => {
    need(req, 'owner', 'manager');
    const purchase = await load(req);
    const b = req.body || {};
    const data = pick(b, FIELDS);
    if (b.items !== undefined) data.items = b.items;
    const updated = await Purchase.updateDraft(purchase.id, data, ctx(req));
    await audit(req, 'purchase.update', 'purchase', purchase.id, { changed: Object.keys(data) }, purchase.branch_id);
    res.json({ data: updated });
  },

  /** POST /purchases/:id/receive - the delivery arrived: stock goes up, buying prices and average cost update */
  receive: async (req, res) => {
    need(req, 'owner', 'manager');
    const purchase = await load(req);
    const updated = await Purchase.receive(purchase.id, ctx(req));
    await audit(req, 'purchase.receive', 'purchase', purchase.id, { purchase_no: purchase.purchase_no, total: updated.total }, purchase.branch_id);
    res.json({ data: updated });
  },

  cancel: async (req, res) => {
    need(req, 'owner', 'manager');
    const purchase = await load(req);
    const updated = await Purchase.cancel(purchase.id, ctx(req));
    await audit(req, 'purchase.cancel', 'purchase', purchase.id, { purchase_no: purchase.purchase_no }, purchase.branch_id);
    res.json({ data: updated });
  },
});
