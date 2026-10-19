'use strict';

const AppError = require('../utils/AppError');
const { StockTransfer } = require('../models');
const { handlers, need, id, pick, isOwner, scopeBranch, ctx, audit } = require('../utils/controller');

const touches = (user, t) => isOwner(user) || [t.from_branch_id, t.to_branch_id].includes(user.branch_id);

async function load(req) {
  const t = await StockTransfer.findById(id(req.params.id));
  if (!t) throw new AppError('Transfer not found', 404);
  if (!touches(req.user, t)) throw new AppError('That transfer does not involve your shop', 403);
  return t;
}

module.exports = handlers({
  /** POST /transfers  { from_branch_id, to_branch_id, notes, items:[{product_id, quantity}] }  - either shop can ask for stock */
  create: async (req, res) => {
    need(req, 'owner', 'manager');
    const b = req.body || {};
    const from = id(b.from_branch_id, 'from_branch_id');
    const to = id(b.to_branch_id, 'to_branch_id');
    if (!isOwner(req.user) && ![from, to].includes(req.user.branch_id)) throw new AppError('A transfer must involve your own shop', 403);
    const t = await StockTransfer.create({ ...pick(b, ['notes', 'items']), from_branch_id: from, to_branch_id: to }, ctx(req));
    await audit(req, 'transfer.create', 'stock_transfer', t.id, { transfer_no: t.transfer_no, from, to, lines: t.items.length });
    res.status(201).json({ data: t });
  },

  /** POST /transfers/:id/dispatch  { items?:[{product_id, quantity_sent}] }  - only the SENDING shop. Their stock goes down now. */
  dispatch: async (req, res) => {
    need(req, 'owner', 'manager');
    const t = await load(req);
    if (!isOwner(req.user) && req.user.branch_id !== t.from_branch_id) throw new AppError('Only the sending shop can dispatch', 403);
    const out = await StockTransfer.dispatch(t.id, { items: (req.body || {}).items }, ctx(req));
    await audit(req, 'transfer.dispatch', 'stock_transfer', t.id, { transfer_no: t.transfer_no, items: out.items.map((i) => ({ product_id: i.product_id, sent: i.quantity_sent })) }, t.from_branch_id);
    res.json({ data: out });
  },

  /** POST /transfers/:id/receive  { items?:[{product_id, quantity_received}] }  - only the RECEIVING shop. Their stock goes up now. */
  receive: async (req, res) => {
    need(req, 'owner', 'manager');
    const t = await load(req);
    if (!isOwner(req.user) && req.user.branch_id !== t.to_branch_id) throw new AppError('Only the receiving shop can confirm arrival', 403);
    const out = await StockTransfer.receive(t.id, { items: (req.body || {}).items }, ctx(req));
    const short = out.items.filter((i) => i.quantity_received !== null && i.quantity_sent !== null && Number(i.quantity_received) !== Number(i.quantity_sent));
    await audit(req, 'transfer.receive', 'stock_transfer', t.id, { transfer_no: t.transfer_no, differences: short.map((i) => ({ product_id: i.product_id, sent: i.quantity_sent, received: i.quantity_received })) }, t.to_branch_id);
    res.json({ data: out });
  },

  cancel: async (req, res) => {
    need(req, 'owner', 'manager');
    const t = await load(req);
    const out = await StockTransfer.cancel(t.id, ctx(req));
    await audit(req, 'transfer.cancel', 'stock_transfer', t.id, { transfer_no: t.transfer_no, was: t.status });
    res.json({ data: out });
  },

  get: async (req, res) => {
    res.json({ data: await load(req) });
  },

  /** GET /transfers  ?branch_id &status &page &limit  (transfers into or out of a shop) */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await StockTransfer.list({ branchId: scopeBranch(req, q.branch_id), status: q.status, page: q.page, limit: q.limit }));
  },
});
