'use strict';

const AppError = require('../utils/AppError');
const { Supplier, SupplierPayment, Purchase } = require('../models');
const { handlers, need, id, pick, bool, isOwner, scopeBranch, assertBranch, ctx, audit } = require('../utils/controller');

module.exports = handlers({
  /** GET /suppliers  ?q &only_owed=true  (with what we owe each one) */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    res.json({ data: await Supplier.listWithBalances({ q: req.query.q, onlyOwed: req.query.only_owed === 'true' }) });
  },

  /** GET /suppliers/:id  - balance, purchases and payments */
  statement: async (req, res) => {
    need(req, 'owner', 'manager');
    const st = await Supplier.statement(id(req.params.id));
    if (!st) throw new AppError('Supplier not found', 404);
    if (!isOwner(req.user)) st.purchases = st.purchases.filter((p) => p.branch_id === req.user.branch_id);
    res.json({ data: st });
  },

  create: async (req, res) => {
    need(req, 'owner', 'manager');
    const supplier = await Supplier.create(pick(req.body, Supplier.fields));
    await audit(req, 'supplier.create', 'supplier', supplier.id, { name: supplier.name });
    res.status(201).json({ data: supplier });
  },

  update: async (req, res) => {
    need(req, 'owner', 'manager');
    const data = pick(req.body, Supplier.fields);
    const supplier = await Supplier.update(id(req.params.id), data);
    if (!supplier) throw new AppError('Supplier not found', 404);
    await audit(req, 'supplier.update', 'supplier', supplier.id, { changed: Object.keys(data) });
    res.json({ data: supplier });
  },

  // ------------------------- paying suppliers -------------------------
  /**
   * POST /suppliers/:id/payments  { purchase_id?, amount, method, reference, paid_at, notes, branch_id? }
   * Without purchase_id it is a general payment on account.
   */
  pay: async (req, res) => {
    need(req, 'owner', 'manager');
    const b = req.body || {};
    const supplierId = id(req.params.id);
    if (b.purchase_id) {
      const purchase = await Purchase.findById(id(b.purchase_id, 'purchase_id'));
      if (!purchase) throw new AppError('Purchase not found', 404);
      assertBranch(req, purchase.branch_id);
    }
    const payment = await SupplierPayment.create(
      { ...pick(b, ['purchase_id', 'amount', 'method', 'reference', 'paid_at', 'notes']), supplier_id: supplierId, branch_id: scopeBranch(req, b.branch_id) },
      ctx(req)
    );
    await audit(req, 'supplier.payment', 'supplier', supplierId, { payment_id: payment.id, amount: payment.amount, method: payment.method, purchase_id: payment.purchase_id });
    res.status(201).json({ data: payment });
  },

  /** GET /suppliers/:id/payments */
  payments: async (req, res) => {
    need(req, 'owner', 'manager');
    res.json({ data: await SupplierPayment.listBySupplier(id(req.params.id)) });
  },

  /** POST /supplier-payments/:id/void  (owner only) { reason } */
  voidPayment: async (req, res) => {
    need(req, 'owner');
    const payment = await SupplierPayment.void(id(req.params.id), ctx(req));
    await audit(req, 'supplier.payment_void', 'supplier_payment', payment.id, { amount: payment.amount, reason: (req.body || {}).reason || null });
    res.json({ data: payment });
  },
});
