'use strict';

const AppError = require('../utils/AppError');
const { Customer } = require('../models');
const { handlers, need, id, pick, bool, isOwner, audit } = require('../utils/controller');

module.exports = handlers({
  /** GET /customers  ?q &customer_type &only_owing=true &is_active &page &limit  (each row includes what they owe) */
  list: async (req, res) => {
    const q = req.query;
    res.json(await Customer.search({
      q: q.q, customerType: q.customer_type, onlyOwing: q.only_owing === 'true', isActive: bool(q.is_active), page: q.page, limit: q.limit,
    }));
  },

  /** GET /customers/:id/balance  - what they owe and their limit */
  balance: async (req, res) => {
    const row = await Customer.balanceOf(id(req.params.id));
    if (!row) throw new AppError('Customer not found', 404);
    res.json({ data: row });
  },

  /** GET /customers/:id  - purchase history and payments (managers see their own shop's sales only) */
  statement: async (req, res) => {
    need(req, 'owner', 'manager');
    const st = await Customer.statement(id(req.params.id));
    if (!st) throw new AppError('Customer not found', 404);
    if (!isOwner(req.user)) {
      st.sales = st.sales.filter((s) => s.branch_id === req.user.branch_id);
      const saleIds = new Set(st.sales.map((s) => s.id));
      st.payments = st.payments.filter((p) => p.sale_id === null || saleIds.has(p.sale_id));
    }
    res.json({ data: st });
  },

  /** POST /customers  - cashiers can add a regular, but cannot give credit (credit_limit is set by a manager or the owner) */
  create: async (req, res) => {
    const data = pick(req.body, Customer.fields);
    if (req.user.role === 'cashier') delete data.credit_limit;
    const customer = await Customer.create(data);
    await audit(req, 'customer.create', 'customer', customer.id, { name: customer.name });
    res.status(201).json({ data: customer });
  },

  /** PUT /customers/:id  - credit_limit: owner only */
  update: async (req, res) => {
    need(req, 'owner', 'manager');
    const data = pick(req.body, Customer.fields);
    if (data.credit_limit !== undefined && !isOwner(req.user)) throw new AppError('Only the owner can change a credit limit', 403, 'FORBIDDEN');
    const customer = await Customer.update(id(req.params.id), data);
    if (!customer) throw new AppError('Customer not found', 404);
    await audit(req, 'customer.update', 'customer', customer.id, { changed: Object.keys(data), credit_limit: data.credit_limit });
    res.json({ data: customer });
  },
});
