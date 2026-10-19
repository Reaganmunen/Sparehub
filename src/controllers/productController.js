'use strict';

const AppError = require('../utils/AppError');
const { Product } = require('../models');
const { readRows } = require('../services/files');
const { handlers, need, id, pick, bool, isOwner, canSeeCosts, scopeBranch, branchRequired, ctx, audit } = require('../utils/controller');

const FIELDS = [
  'sku', 'barcode', 'part_number', 'name', 'description', 'category_id', 'brand_id', 'unit_id',
  'buying_price', 'selling_price', 'min_selling_price', 'wholesale_price', 'tax_rate',
  'default_reorder_level', 'track_stock', 'image_url', 'is_active',
];
const EXTRAS = ['fitments', 'branch_ids', 'opening_stock'];

module.exports = handlers({
  // ------------------------- the cashier's screen -------------------------
  /** GET /products/pos  ?q &category_id &brand_id &vehicle_model_id &in_stock=true &limit   (never shows buying price) */
  posSearch: async (req, res) => {
    const q = req.query;
    const rows = await Product.searchForPos(
      {
        branchId: branchRequired(req, q.branch_id), q: q.q, categoryId: q.category_id, brandId: q.brand_id,
        vehicleModelId: q.vehicle_model_id, inStockOnly: q.in_stock === 'true', limit: q.limit,
      },
      ctx(req)
    );
    res.json({ data: rows });
  },

  /** GET /products/pos/scan/:code  (barcode scanner or exact SKU) */
  scan: async (req, res) => {
    const row = await Product.findForPosByCode(branchRequired(req, req.query.branch_id), req.params.code);
    if (!row) throw new AppError('No product with that barcode or SKU in this shop', 404);
    res.json({ data: row });
  },

  // ------------------------- the catalogue (admin screens) -------------------------
  /** GET /products  ?q &category_id &brand_id &vehicle_model_id &is_active &page &limit */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await Product.list(
      { q: q.q, categoryId: q.category_id, brandId: q.brand_id, vehicleModelId: q.vehicle_model_id, isActive: bool(q.is_active), page: q.page, limit: q.limit },
      ctx(req)
    ));
  },

  get: async (req, res) => {
    need(req, 'owner', 'manager');
    const product = await Product.findById(id(req.params.id), ctx(req));
    if (!product) throw new AppError('Product not found', 404);
    if (!isOwner(req.user)) product.stock = product.stock.filter((s) => s.branch_id === req.user.branch_id);
    res.json({ data: product });
  },

  /** POST /products (owner)  product fields + fitments:[vehicle_model_id] + branch_ids:[1,2] + opening_stock:[{branch_id,quantity,unit_cost}] */
  create: async (req, res) => {
    need(req, 'owner');
    const product = await Product.create(pick(req.body, [...FIELDS, ...EXTRAS]), ctx(req));
    await audit(req, 'product.create', 'product', product.id, { sku: product.sku, name: product.name, selling_price: product.selling_price });
    res.status(201).json({ data: product });
  },

  /** PUT /products/:id (owner). Price changes are also logged by the database with who made them. */
  update: async (req, res) => {
    need(req, 'owner');
    const data = pick(req.body, [...FIELDS, 'fitments']);
    const product = await Product.update(id(req.params.id), data, ctx(req));
    await audit(req, 'product.update', 'product', product.id, { changed: Object.keys(data) });
    res.json({ data: product });
  },

  /** POST /products/:id/active  { is_active } - products are switched off, never deleted */
  setActive: async (req, res) => {
    need(req, 'owner');
    const product = await Product.setActive(id(req.params.id), bool((req.body || {}).is_active), ctx(req));
    await audit(req, 'product.set_active', 'product', product.id, { is_active: product.is_active });
    res.json({ data: product });
  },

  /** GET /products/:id/price-history */
  priceHistory: async (req, res) => {
    if (!canSeeCosts(req.user)) throw new AppError('You are not allowed to see price history', 403);
    res.json({ data: await Product.priceHistory(id(req.params.id)) });
  },

  // ------------------------- Excel / CSV import -------------------------
  /** POST /products/import  multipart file field "file" (.xlsx or .csv), optional body branch_id for the opening stock */
  importFile: async (req, res) => {
    need(req, 'owner');
    const rows = await readRows(req.file);
    const result = await Product.importMany(rows, { userId: req.user.id, branchId: req.body.branch_id ? id(req.body.branch_id, 'branch_id') : undefined });
    await audit(req, 'product.import', 'product', null, { rows: rows.length, created: result.created, updated: result.updated, failed: result.failed.length });
    res.json({ data: result });
  },

  /** GET /products/import/template */
  importTemplate: async (req, res) => {
    need(req, 'owner');
    const header = 'sku,name,part_number,barcode,category,brand,unit,buying_price,selling_price,min_selling_price,wholesale_price,reorder_level,branch_id,quantity';
    const example = 'BB-0001,Brake pad front,BP-123,,Brakes,Bajaj,pc,350,550,500,480,5,1,20';
    res.type('text/csv').attachment('product-import-template.csv').send(`${header}\n${example}\n`);
  },
});
