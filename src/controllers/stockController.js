'use strict';

const AppError = require('../utils/AppError');
const { Stock } = require('../models');
const { handlers, need, id, pick, isOwner, scopeBranch, branchRequired, assertBranch, ctx, audit } = require('../utils/controller');

const PRICE_KEYS = ['selling_price', 'min_selling_price', 'wholesale_price'];

module.exports = handlers({
  /** GET /stock  ?branch_id &q &category_id &low_only=true &page &limit */
  levels: async (req, res) => {
    const q = req.query;
    res.json(await Stock.levels(
      { branchId: scopeBranch(req, q.branch_id), q: q.q, categoryId: q.category_id, lowOnly: q.low_only === 'true', page: q.page, limit: q.limit },
      ctx(req)
    ));
  },

  /** GET /stock/low  (reorder alerts) */
  lowStock: async (req, res) => {
    res.json({ data: await Stock.lowStock(scopeBranch(req, req.query.branch_id), ctx(req)) });
  },

  /** GET /stock/:branchId/:productId */
  one: async (req, res) => {
    const branchId = id(req.params.branchId, 'branchId');
    assertBranch(req, branchId);
    const row = await Stock.findOne(branchId, id(req.params.productId, 'productId'), ctx(req));
    if (!row) throw new AppError('This product is not listed in that shop', 404);
    res.json({ data: row });
  },

  /** POST /stock/:branchId/products/:productId  - sell this product in that shop (owner) */
  listProduct: async (req, res) => {
    need(req, 'owner');
    const row = await Stock.listProductInBranch(id(req.params.branchId, 'branchId'), id(req.params.productId, 'productId'), ctx(req));
    res.status(201).json({ data: row });
  },

  /**
   * PUT /stock/:branchId/:productId   { reorder_level, shelf_location, selling_price, min_selling_price, wholesale_price }
   * Managers may change the reorder level and shelf; prices for one shop are the owner's decision.
   */
  updateSettings: async (req, res) => {
    need(req, 'owner', 'manager');
    const branchId = id(req.params.branchId, 'branchId');
    assertBranch(req, branchId);
    const data = pick(req.body, ['reorder_level', 'shelf_location', ...PRICE_KEYS]);
    if (!isOwner(req.user) && PRICE_KEYS.some((k) => data[k] !== undefined)) throw new AppError('Only the owner can change prices', 403, 'FORBIDDEN');
    const productId = id(req.params.productId, 'productId');
    const row = await Stock.updateSettings(branchId, productId, data, ctx(req));
    await audit(req, 'stock.settings', 'product', productId, { branch_id: branchId, changes: data }, branchId);
    res.json({ data: row });
  },

  /**
   * POST /stock/adjust  { branch_id?, product_id, type, quantity, unit_cost?, reason }
   * type: opening_stock (owner) | adjustment_in | adjustment_out | damage | supplier_return
   */
  adjust: async (req, res) => {
    need(req, 'owner', 'manager');
    const b = req.body || {};
    if (b.type === 'opening_stock') need(req, 'owner');
    const branchId = branchRequired(req, b.branch_id);
    const productId = id(b.product_id, 'product_id');
    const row = await Stock.adjust(
      { branchId, productId, type: b.type, quantity: b.quantity, unitCost: b.unit_cost, reason: b.reason },
      ctx(req)
    );
    await audit(req, 'stock.adjust', 'product', productId, { branch_id: branchId, type: b.type, quantity: b.quantity, reason: b.reason, quantity_now: row && row.quantity }, branchId);
    res.status(201).json({ data: row });
  },

  /** GET /stock/movements  ?branch_id &product_id &type &from &to &page &limit  (the ledger: every sale, delivery, transfer, adjustment) */
  movements: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await Stock.movements(
      { branchId: scopeBranch(req, q.branch_id), productId: q.product_id, type: q.type, from: q.from, to: q.to, page: q.page, limit: q.limit },
      ctx(req)
    ));
  },
});
