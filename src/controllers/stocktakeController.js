'use strict';

const AppError = require('../utils/AppError');
const { Stocktake } = require('../models');
const { handlers, need, id, scopeBranch, branchRequired, assertBranch, ctx, audit } = require('../utils/controller');

async function load(req) {
  const st = await Stocktake.findById(id(req.params.id));
  if (!st) throw new AppError('Stocktake not found', 404);
  assertBranch(req, st.branch_id);
  return st;
}

module.exports = handlers({
  /** POST /stocktakes  { branch_id? }  - copies every product and its system quantity onto a count sheet */
  start: async (req, res) => {
    need(req, 'owner', 'manager');
    const branchId = branchRequired(req, (req.body || {}).branch_id);
    const st = await Stocktake.start(branchId, ctx(req));
    await audit(req, 'stocktake.start', 'stocktake', st.id, { items: st.summary.total_items }, branchId);
    res.status(201).json({ data: st });
  },

  /** PUT /stocktakes/:id/counts  { counts:[{product_id, counted_quantity, reason?}] }  - can be sent in several batches */
  setCounts: async (req, res) => {
    need(req, 'owner', 'manager');
    const st = await load(req);
    res.json({ data: await Stocktake.setCounts(st.id, (req.body || {}).counts, ctx(req)) });
  },

  /** POST /stocktakes/:id/complete - posts the differences as stock adjustments and closes the count */
  complete: async (req, res) => {
    need(req, 'owner', 'manager');
    const st = await load(req);
    const done = await Stocktake.complete(st.id, ctx(req));
    await audit(req, 'stocktake.complete', 'stocktake', st.id, done.summary, st.branch_id);
    res.json({ data: done });
  },

  cancel: async (req, res) => {
    need(req, 'owner', 'manager');
    const st = await load(req);
    const out = await Stocktake.cancel(st.id, ctx(req));
    await audit(req, 'stocktake.cancel', 'stocktake', st.id, null, st.branch_id);
    res.json({ data: out });
  },

  get: async (req, res) => {
    need(req, 'owner', 'manager');
    res.json({ data: await load(req) });
  },

  list: async (req, res) => {
    need(req, 'owner', 'manager');
    res.json({ data: await Stocktake.list({ branchId: scopeBranch(req, req.query.branch_id), status: req.query.status }) });
  },
});
