'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');
const { Sale, Payment, Customer } = require('../models');
const {
  handlers, id, pick, canSeeCosts, scopeBranch, branchRequired, assertBranch, ctx, audit,
  verifyApprover, approvedBy, requireOpenShift,
} = require('../utils/controller');

const round2 = db.round2;
const dueOf = (s) => round2(Number(s.total) - Number(s.returned_total) - Number(s.amount_paid));

async function load(req, saleId) {
  const sale = await Sale.findById(saleId, { includeCost: canSeeCosts(req.user) });
  if (!sale) throw new AppError('Sale not found', 404);
  assertBranch(req, sale.branch_id);
  return sale;
}

/** A cashier may only look at sales they made themselves (managers and the owner see the whole shop). */
function ownSaleOnly(req, sale) {
  if (req.user.role === 'cashier' && sale.cashier_id !== req.user.id) throw new AppError('That sale was made by another cashier', 403, 'NOT_YOUR_SALE');
}

/** A cashier can only work on carts they started themselves. */
function ownsCart(req, sale) {
  if (sale.status === 'held' && req.user.role === 'cashier' && sale.cashier_id !== req.user.id) {
    throw new AppError('This sale was started by another cashier', 403, 'NOT_YOUR_SALE');
  }
}

/**
 * Checks every line against the rules BEFORE it reaches the database:
 *  - prices come from the server; a cashier may only go lower than the list price within their discount limit
 *  - below the minimum price needs someone with "can override min price" (the cashier, or a manager approving)
 * The database still enforces the minimum price as a last line of defence.
 */
async function prepareItems(req, branchId, saleType, items, approver) {
  if (!Array.isArray(items) || !items.length) throw new AppError('Add at least one item to the sale');
  const ids = [...new Set(items.map((i) => id(i.product_id, 'product_id')))];
  const { rows } = await db.query(
    `SELECT product_id, product_name, selling_price, wholesale_price, min_selling_price
       FROM v_pos_products WHERE branch_id = $1 AND product_id = ANY($2::int[])`,
    [branchId, ids]
  );
  const byId = new Map(rows.map((r) => [r.product_id, r]));

  const actor = approver || req.user;
  const canOverride = actor.role === 'owner' || Boolean(actor.can_override_min_price);
  const maxPct = Number(actor.max_discount_percent || 0);

  return items.map((it) => {
    const p = byId.get(Number(it.product_id));
    if (!p) throw new AppError(`Product ${it.product_id} is not available in this shop`, 404);
    const qty = Number(it.quantity);
    if (!(qty > 0)) throw new AppError(`The quantity for "${p.product_name}" must be more than zero`);

    const list = saleType === 'wholesale' && p.wholesale_price != null ? Number(p.wholesale_price) : Number(p.selling_price);
    const hasPrice = it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '';
    const unit = hasPrice ? Number(it.unit_price) : list;
    const discount = Number(it.discount_amount) || 0;
    if (!(unit >= 0) || discount < 0) throw new AppError(`Check the price or discount for "${p.product_name}"`);

    // how far below the list price is this line? (price cut + discount)
    const cut = Math.max(0, list - unit) * qty + discount;
    const pct = list > 0 ? (cut / (list * qty)) * 100 : 0;
    if (!canOverride && pct > maxPct + 0.001) {
      throw new AppError(`A ${pct.toFixed(1)}% reduction on "${p.product_name}" is more than your limit of ${maxPct}%. A manager must approve it.`, 403, 'DISCOUNT_LIMIT');
    }

    let override = null;
    if (unit - discount / qty < Number(p.min_selling_price) - 0.004) {
      if (!canOverride) throw new AppError(`"${p.product_name}" is below the minimum price. A manager must approve this price.`, 403, 'BELOW_MIN_PRICE');
      override = actor.id;
    }
    return { product_id: p.product_id, quantity: qty, unit_price: hasPrice ? unit : undefined, discount_amount: discount, price_override_by: override };
  });
}

/** Turns the till's request into what Sale.create() wants. */
async function buildSale(req, body) {
  const branchId = branchRequired(req, body.branch_id);
  const saleType = body.sale_type === 'wholesale' ? 'wholesale' : 'retail';
  const approver = body.approval ? await verifyApprover(body.approval, branchId) : null;
  const items = await prepareItems(req, branchId, saleType, body.items, approver);
  return {
    approver,
    data: {
      branch_id: branchId,
      cashier_id: req.user.id,
      customer_id: body.customer_id ? id(body.customer_id, 'customer_id') : null,
      sale_type: saleType,
      due_date: body.due_date || null,
      notes: body.notes || null,
      items,
    },
  };
}

module.exports = handlers({
  /**
   * POST /sales/checkout   the normal "Pay" button
   * { branch_id?, customer_id?, sale_type, due_date?, notes?, approval?: {username,password},
   *   items:[{product_id, quantity, unit_price?, discount_amount?}],
   *   payments:[{method:'cash'|'mpesa'|..., amount, reference}] }
   * Anything not paid becomes credit (needs a customer inside their credit limit).
   * For an M-Pesa prompt use /sales/hold, then /mpesa/stk-push.
   */
  checkout: async (req, res) => {
    const { data, approver } = await buildSale(req, req.body);
    await requireOpenShift(req, data.branch_id);
    const payments = (Array.isArray(req.body.payments) ? req.body.payments : []).map((p) => pick(p, ['method', 'amount', 'reference']));
    const sale = await Sale.checkout({ ...data, payments }, ctx(req));
    await audit(req, 'sale.create', 'sale', sale.id, { receipt_no: sale.receipt_no, total: sale.total, paid: sale.amount_paid, approved_by: approver ? approver.id : null }, sale.branch_id);
    res.status(201).json({ data: sale });
  },

  /** POST /sales/hold  - parks a cart (also the first step before an M-Pesa prompt). Same body as checkout without payments. */
  hold: async (req, res) => {
    const { data, approver } = await buildSale(req, req.body);
    const sale = await Sale.create(data, ctx(req));
    if (approver) await audit(req, 'sale.price_approval', 'sale', sale.id, { approved_by: approver.id }, sale.branch_id);
    res.status(201).json({ data: sale });
  },

  /** GET /sales/held  - my parked carts (a manager sees the whole shop's) */
  listHeld: async (req, res) => {
    const branchId = branchRequired(req, req.query.branch_id);
    const cashierId = req.user.role === 'cashier' ? req.user.id : req.query.cashier_id || null;
    res.json({ data: await Sale.listHeld(branchId, cashierId) });
  },

  /** PUT /sales/:id  (held carts only)  { customer_id, sale_type, due_date, notes, items } - items replaces all lines */
  updateHeld: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    ownsCart(req, sale);
    const b = req.body || {};
    const data = pick(b, ['customer_id', 'sale_type', 'due_date', 'notes']);
    if (data.sale_type && !['retail', 'wholesale'].includes(data.sale_type)) throw new AppError('sale_type must be retail or wholesale');
    if (b.items !== undefined) {
      const approver = b.approval ? await verifyApprover(b.approval, sale.branch_id) : null;
      data.items = await prepareItems(req, sale.branch_id, data.sale_type || sale.sale_type, b.items, approver);
    }
    res.json({ data: await Sale.updateHeld(sale.id, data, ctx(req)) });
  },

  /** DELETE /sales/:id  (held carts only) */
  discardHeld: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    ownsCart(req, sale);
    await Sale.discardHeld(sale.id, ctx(req));
    res.json({ data: { discarded: true } });
  },

  /**
   * POST /sales/:id/complete - finishes a held cart. Anything still unpaid goes on credit (customer + limit are checked).
   */
  complete: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    ownsCart(req, sale);
    if (!sale.items.length) throw new AppError('This sale has no items');
    await requireOpenShift(req, sale.branch_id);

    const due = dueOf(sale);
    const done = await db.withTransaction(req.user.id, async (client) => {
      if (due > 0.004) {
        if (!sale.customer_id) throw new AppError('Choose a customer to put the balance on credit, or take the full payment');
        await Customer.assertCreditAllowed(sale.customer_id, due, { client });
        await client.query(`UPDATE sales SET due_date = COALESCE(due_date, ${db.TODAY} + 7) WHERE id = $1`, [sale.id]);
      }
      return Sale.complete(sale.id, { client });
    });
    await audit(req, 'sale.complete', 'sale', sale.id, { receipt_no: done.receipt_no, total: done.total, on_credit: due > 0.004 ? due : 0 }, sale.branch_id);
    res.json({ data: done });
  },

  /**
   * POST /sales/:id/payments  { method, amount, reference, notes }
   * Adds money to a sale: the cash half of a split payment, a manual M-Pesa code (fallback when the prompt fails
   * or the customer paid straight to the Till), or a credit customer paying later. A held sale that becomes fully paid is completed.
   */
  addPayment: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    ownsCart(req, sale);
    await requireOpenShift(req, sale.branch_id);
    const p = pick(req.body, ['method', 'amount', 'reference', 'notes']);

    const out = await db.withTransaction(req.user.id, async (client) => {
      const payment = await Payment.record({ ...p, branch_id: sale.branch_id, sale_id: sale.id, received_by: req.user.id }, { client });
      let current = await Sale.findById(sale.id, { client });
      if (current.status === 'held' && current.items.length && dueOf(current) <= 0.004) {
        current = await Sale.complete(sale.id, { client });
      }
      return { payment, sale: current };
    });
    await audit(req, 'payment.create', 'sale', sale.id, { payment_id: out.payment.id, method: p.method, amount: out.payment.amount, reference: out.payment.reference }, sale.branch_id);
    res.status(201).json({ data: out });
  },

  /**
   * POST /sales/:id/void  { reason, refund_method?, refund_reference?, approval? }
   * Managers and the owner can void; a cashier needs a manager's username and password (approval).
   */
  void: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    const actor = await approvedBy(req, sale.branch_id);
    const b = req.body || {};
    const voided = await Sale.void(sale.id, { reason: b.reason, refundMethod: b.refund_method, refundReference: b.refund_reference }, { userId: actor.id });
    await audit(req, 'sale.void', 'sale', sale.id, { receipt_no: sale.receipt_no, total: sale.total, reason: b.reason, requested_by: req.user.id, approved_by: actor.id }, sale.branch_id);
    res.json({ data: voided });
  },

  get: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    ownSaleOnly(req, sale);
    res.json({ data: sale });
  },

  /** GET /sales  ?branch_id &status (default completed; 'all' for everything) &payment_status &customer_id &cashier_id &mine=true &q &from &to &page &limit */
  list: async (req, res) => {
    const q = req.query;
    res.json(await Sale.list({
      branchId: scopeBranch(req, q.branch_id),
      cashierId: req.user.role === 'cashier' || q.mine === 'true' ? req.user.id : q.cashier_id, // cashiers: always their own
      customerId: q.customer_id,
      status: q.status === 'all' ? undefined : q.status || 'completed',
      paymentStatus: q.payment_status, q: q.q, from: q.from, to: q.to, page: q.page, limit: q.limit,
    }));
  },

  /** GET /sales/:id/receipt  ?phone=  -> receipt data for printing + plain text + a WhatsApp share link */
  receipt: async (req, res) => {
    const sale = await load(req, id(req.params.id));
    ownSaleOnly(req, sale);
    if (sale.status === 'held') throw new AppError('This sale is not finished yet', 409);
    const receipt = await Sale.receipt(sale.id);
    res.json({ data: { receipt, text: Sale.receiptText(receipt), whatsapp_link: Sale.whatsappLink(receipt, req.query.phone) } });
  },
});