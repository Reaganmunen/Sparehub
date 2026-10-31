'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');
const Setting = require('./Setting');
const Payment = require('./Payment');
const Customer = require('./Customer');
const { normalizePhone } = require('../utils/phone');

/**
 * Turns what the till sends ({ product_id, quantity, optional unit_price / discount_amount / price_override_by })
 * into complete sale lines. Prices, descriptions and tax come from the SERVER, never from the browser.
 */
async function resolveItems(client, branchId, saleType, items, { forceAllowNegative = false } = {}) {
  if (!Array.isArray(items) || !items.length) throw new AppError('Add at least one item to the sale');

  const ids = [...new Set(items.map((i) => Number(i.product_id)))];
  const { rows } = await client.query(
    'SELECT * FROM v_pos_products WHERE branch_id = $1 AND product_id = ANY($2::int[])',
    [branchId, ids]
  );
  const byId = new Map(rows.map((p) => [p.product_id, p]));
  const vatOn = await Setting.getBool('vat_enabled', false, { client });
  // forceAllowNegative: a sale that already happened offline must be recorded even if the stock count has since moved
  const allowNegative = forceAllowNegative || (await Setting.getBool('allow_negative_stock', false, { client }));

  const wanted = new Map();
  const lines = items.map((it) => {
    const p = byId.get(Number(it.product_id));
    if (!p) throw new AppError(`Product ${it.product_id} is not available in this shop`, 404);
    const qty = Number(it.quantity);
    if (!(qty > 0)) throw new AppError(`The quantity for "${p.product_name}" must be more than zero`);
    wanted.set(p.product_id, (wanted.get(p.product_id) || 0) + qty);

    const listPrice = saleType === 'wholesale' && p.wholesale_price != null ? p.wholesale_price : p.selling_price;
    const hasPrice = it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '';
    return {
      product_id: p.product_id,
      description: p.part_number ? `${p.product_name} (${p.part_number})` : p.product_name,
      quantity: qty,
      unit_price: hasPrice ? Number(it.unit_price) : listPrice,
      min_price: p.min_selling_price,
      discount_amount: Number(it.discount_amount) || 0,
      tax_rate: vatOn ? p.tax_rate : 0,
      price_override_by: it.price_override_by || null,
    };
  });

  if (!allowNegative) {
    for (const [productId, qty] of wanted) {
      const p = byId.get(productId);
      if (p.track_stock && qty > p.quantity) {
        throw new AppError(`Only ${p.quantity} of "${p.product_name}" in stock (you asked for ${qty})`, 409, 'INSUFFICIENT_STOCK');
      }
    }
  }
  return lines;
}

async function insertItems(client, saleId, lines) {
  for (const l of lines) {
    try {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, min_price, discount_amount, tax_rate, price_override_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [saleId, l.product_id, l.description, l.quantity, l.unit_price, l.min_price, l.discount_amount, l.tax_rate, l.price_override_by]
      );
    } catch (err) {
      if (err.constraint === 'chk_min_price_rule') {
        throw new AppError(`"${l.description}" is below the minimum price. A manager must approve this price.`, 403, 'BELOW_MIN_PRICE');
      }
      if (err.code === '42501') throw new AppError(err.message, 403, 'NOT_ALLOWED');
      throw err;
    }
  }
}

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A sale's life:  held (cart)  ->  completed (stock is deducted)  ->  voided (stock comes back).
 * Totals, amount paid and payment status are kept up to date by the database.
 */
class Sale {
  /**
   * Creates a HELD sale (a cart). data = { branch_id, cashier_id, customer_id, sale_type ('retail'|'wholesale'),
   * due_date, notes, items: [{ product_id, quantity, unit_price?, discount_amount?, price_override_by? }] }
   * The cashier's open shift is attached automatically.
   */
  static async create(data, opts = {}) {
    if (!data.branch_id || !data.cashier_id) throw new AppError('branch_id and cashier_id are required');
    const saleType = data.sale_type || 'retail';
    return db.inTransaction(opts, async (client) => {
      const lines = await resolveItems(client, data.branch_id, saleType, data.items, { forceAllowNegative: Boolean(data.force_allow_negative) });
      const { rows } = await client.query(
        `INSERT INTO sales (branch_id, customer_id, cashier_id, shift_id, sale_type, due_date, notes)
         VALUES ($1, $2, $3,
                 COALESCE($4::int, (SELECT id FROM shifts WHERE cashier_id = $3 AND branch_id = $1 AND status = 'open')),
                 $5::price_level, $6::date, $7)
         RETURNING id`,
        [data.branch_id, data.customer_id || null, data.cashier_id, data.shift_id || null, saleType, data.due_date || null, data.notes || null]
      );
      const id = rows[0].id;
      await insertItems(client, id, lines);
      return Sale.findById(id, { client });
    });
  }

  /** Changes a held cart. If data.items is given it replaces all the lines. */
  static async updateHeld(id, data, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      const cur = (await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw new AppError('Sale not found', 404);
      if (cur.status !== 'held') throw new AppError('Only a held sale can be changed. Use a return or void for a completed sale.', 409);

      const allowed = ['customer_id', 'sale_type', 'due_date', 'notes'];
      if (allowed.some((k) => data[k] !== undefined)) {
        const up = db.buildUpdate(data, allowed, 2);
        await client.query(`UPDATE sales SET ${up.sets} WHERE id = $1`, [id, ...up.values]);
      }
      if (data.items !== undefined) {
        const saleType = data.sale_type || cur.sale_type;
        const lines = await resolveItems(client, cur.branch_id, saleType, data.items);
        await client.query('DELETE FROM sale_items WHERE sale_id = $1', [id]);
        await insertItems(client, id, lines);
      }
      return Sale.findById(id, { client });
    });
  }

  /** Throws a held cart away (a completed sale is voided instead). */
  static async discardHeld(id, opts = {}) {
    const { rowCount } = await db.query("DELETE FROM sales WHERE id = $1 AND status = 'held'", [id], opts);
    if (!rowCount) throw new AppError('Only a held sale can be discarded', 409);
    return true;
  }

  /** held -> completed. Deducts the stock and fixes the cost of each item. opts.soldAt (offline sales) = when it really happened. */
  static async complete(id, opts = {}) {
    return db.inTransaction(opts, async (client) => {
      const { rowCount } = await client.query(
        "UPDATE sales SET status = 'completed', sold_at = COALESCE($2::timestamptz, now()) WHERE id = $1 AND status = 'held'",
        [id, opts.soldAt || null]
      );
      if (!rowCount) throw new AppError('Only a held sale can be completed (it may already be completed or voided)', 409);
      return Sale.findById(id, { client });
    });
  }

  /**
   * The normal "Pay" button at the till, all in one go: create the sale, complete it, record the payments.
   * data = everything create() takes, plus payments: [{ method, amount, reference }]
   * Whatever is not paid becomes CREDIT: it needs a customer, and must fit the customer's credit limit.
   * (For M-Pesa STK push use create(), then MpesaTransaction; the callback completes the sale.)
   */
  static async checkout(data, opts = {}) {
    const payments = Array.isArray(data.payments) ? data.payments : [];
    return db.inTransaction(opts, async (client) => {
      const sale = await Sale.create(data, { client });

      const paid = db.round2(payments.reduce((sum, p) => sum + Number(p.amount || 0), 0));
      if (paid > sale.total + 0.004) throw new AppError('The payments are more than the sale total');
      const credit = db.round2(sale.total - paid);

      if (credit > 0.004) {
        if (!data.customer_id) throw new AppError('Choose a customer to put the balance on credit, or take the full payment');
        await Customer.assertCreditAllowed(data.customer_id, credit, { client });
        // credit sales get a due date: the one given, otherwise 7 days from today
        await client.query(`UPDATE sales SET due_date = COALESCE(due_date, ${db.TODAY} + 7) WHERE id = $1`, [sale.id]);
      }

      await Sale.complete(sale.id, { client, soldAt: data.sold_at });
      for (const p of payments) {
        await Payment.record(
          {
            branch_id: sale.branch_id,
            sale_id: sale.id,
            customer_id: sale.customer_id,
            method: p.method,
            amount: p.amount,
            reference: p.reference,
            received_by: data.cashier_id,
            shift_id: data.shift_id || sale.shift_id || null,
            paid_at: p.paid_at || data.sold_at || null,
          },
          { client }
        );
      }
      return Sale.findById(sale.id, { client });
    });
  }

  /**
   * Cancels a completed sale and puts the stock back. opts.userId = who voids it.
   * If money was paid it must be refunded: give refundMethod (and refundReference for M-Pesa).
   */
  static async void(id, { reason, refundMethod, refundReference } = {}, opts = {}) {
    if (!String(reason || '').trim()) throw new AppError('Please give a reason for voiding this sale');
    if (!opts.userId) throw new AppError('Who is voiding this sale? userId is required');

    return db.inTransaction(opts, async (client) => {
      const sale = (await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!sale) throw new AppError('Sale not found', 404);
      if (sale.status !== 'completed') throw new AppError('Only a completed sale can be voided (discard a held cart instead)', 409);

      const net = db.round2(
        (await client.query(
          `SELECT COALESCE(SUM(CASE direction WHEN 'in' THEN amount ELSE -amount END), 0) AS net
             FROM payments WHERE sale_id = $1 AND voided_at IS NULL`,
          [id]
        )).rows[0].net
      );
      if (net > 0.004) {
        if (!refundMethod) throw new AppError(`KES ${net} was paid on this sale. Choose how it is refunded (cash, M-Pesa...).`, 409, 'REFUND_REQUIRED');
        await Payment.record(
          {
            branch_id: sale.branch_id, sale_id: id, customer_id: sale.customer_id, direction: 'out',
            method: refundMethod, amount: net, reference: refundReference, received_by: opts.userId,
            notes: 'Refund for voided sale',
          },
          { client }
        );
      }
      await client.query(
        "UPDATE sales SET status = 'voided', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1",
        [id, opts.userId, reason]
      );
      return Sale.findById(id, { client });
    });
  }

  /**
   * One sale with its lines and payments. Cost prices and floor prices are only included with opts.includeCost.
   */
  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT s.*, (s.total - s.returned_total - s.amount_paid) AS balance_due,
              b.name AS branch_name, b.code AS branch_code,
              c.name AS customer_name, c.phone AS customer_phone, u.full_name AS cashier_name
         FROM sales s
         JOIN branches b       ON b.id = s.branch_id
         LEFT JOIN customers c ON c.id = s.customer_id
         JOIN users u          ON u.id = s.cashier_id
        WHERE s.id = $1`,
      [id],
      opts
    );
    const sale = rows[0];
    if (!sale) return null;

    const itemColumns = `id, product_id, description, quantity, unit_price, discount_amount, tax_rate, returned_quantity,
                         line_total, tax_amount, price_override_by` + (opts.includeCost ? ', min_price, unit_cost' : '');
    sale.items = (await db.query(`SELECT ${itemColumns} FROM sale_items WHERE sale_id = $1 ORDER BY id`, [id], opts)).rows;
    sale.payments = (await db.query(
      `SELECT id, direction, method, amount, reference, paid_at, voided_at FROM payments WHERE sale_id = $1 ORDER BY paid_at, id`,
      [id],
      opts
    )).rows;
    return sale;
  }

  /** f = { branchId, cashierId, customerId, status, paymentStatus, q (receipt no / customer), from, to, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('s.branch_id = ?', f.branchId);
    if (f.cashierId) w.add('s.cashier_id = ?', f.cashierId);
    if (f.customerId) w.add('s.customer_id = ?', f.customerId);
    if (f.status) w.add('s.status = ?::sale_status', f.status);
    if (f.paymentStatus) w.add('s.payment_status = ?::payment_status', f.paymentStatus);
    if (f.from) w.add(`${db.dayOf('s.sold_at')} >= ?::date`, f.from);
    if (f.to) w.add(`${db.dayOf('s.sold_at')} <= ?::date`, f.to);
    if (f.q) w.search(['s.receipt_no', 'c.name', 'c.phone'], f.q);
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT s.id, s.receipt_no, s.branch_id, b.name AS branch_name, s.sold_at, s.status, s.sale_type,
              s.total, s.returned_total, s.amount_paid, (s.total - s.returned_total - s.amount_paid) AS balance_due,
              s.payment_status, s.due_date, s.customer_id, c.name AS customer_name,
              s.cashier_id, u.full_name AS cashier_name, COUNT(*) OVER() AS total_count
         FROM sales s
         JOIN branches b       ON b.id = s.branch_id
         LEFT JOIN customers c ON c.id = s.customer_id
         JOIN users u          ON u.id = s.cashier_id
         ${w.sql()}
        ORDER BY s.sold_at DESC, s.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }

  /** The cashier's own held carts, so a parked sale can be resumed. */
  static async listHeld(branchId, cashierId, opts = {}) {
    const { rows } = await db.query(
      `SELECT s.id, s.receipt_no, s.total, s.created_at, c.name AS customer_name
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.status = 'held' AND s.branch_id = $1 AND ($2::int IS NULL OR s.cashier_id = $2)
        ORDER BY s.created_at DESC`,
      [branchId, cashierId || null],
      opts
    );
    return rows;
  }

  // ----------------------------------------------------------------------------------
  // Receipts
  // ----------------------------------------------------------------------------------

  /** Everything a printed or WhatsApp receipt needs. */
  static async receipt(id, opts = {}) {
    const sale = await Sale.findById(id, { ...opts, includeCost: false });
    if (!sale) return null;
    const { rows } = await db.query(
      `SELECT name, address, town, phone, kra_pin, mpesa_till_number, receipt_header, receipt_footer
         FROM branches WHERE id = $1`,
      [sale.branch_id],
      opts
    );
    const businessName = await Setting.get('business_name', null, opts);
    return { ...sale, branch: rows[0], business_name: businessName };
  }

  /** The receipt as plain text, ready for WhatsApp (bold with *stars*). */
  static receiptText(r) {
    const when = new Date(r.sold_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
    const lines = [];
    lines.push(`*${r.business_name || r.branch.name}*`);
    lines.push(`${r.branch.name}${r.branch.town ? `, ${r.branch.town}` : ''}`);
    if (r.branch.phone) lines.push(`Tel: ${r.branch.phone}`);
    if (r.branch.receipt_header) lines.push(r.branch.receipt_header);
    lines.push('', `Receipt: ${r.receipt_no}`, `Date: ${when}`, `Served by: ${r.cashier_name}`);
    if (r.customer_name) lines.push(`Customer: ${r.customer_name}`);
    lines.push('--------------------------');
    for (const it of r.items) {
      lines.push(`${it.quantity} x ${it.description}`);
      lines.push(`   @ ${money(it.unit_price)} = ${money(it.line_total)}`);
      if (it.discount_amount > 0) lines.push(`   (discount ${money(it.discount_amount)})`);
    }
    lines.push('--------------------------');
    if (r.discount_total > 0) lines.push(`Discount: ${money(r.discount_total)}`);
    if (r.returned_total > 0) lines.push(`Returned: ${money(r.returned_total)}`);
    lines.push(`*TOTAL: ${money(r.total - r.returned_total)}*`);
    for (const p of r.payments.filter((x) => !x.voided_at)) {
      const label = p.method === 'mpesa' ? 'M-Pesa' : p.method === 'bank_transfer' ? 'Bank' : p.method === 'card' ? 'Card' : 'Cash';
      lines.push(`${p.direction === 'out' ? 'Refunded' : 'Paid'} (${label}): ${money(p.amount)}${p.reference ? ` [${p.reference}]` : ''}`);
    }
    if (r.balance_due > 0.004) lines.push(`*Balance due: ${money(r.balance_due)}*${r.due_date ? ` by ${r.due_date}` : ''}`);
    if (r.branch.receipt_footer) lines.push('', r.branch.receipt_footer);
    return lines.join('\n');
  }

  /** A wa.me link that opens WhatsApp with the receipt ready to send. Pass a phone, or it uses the customer's. */
  static whatsappLink(r, phone) {
    const number = normalizePhone(phone || r.customer_phone);
    const text = encodeURIComponent(Sale.receiptText(r));
    return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
  }
}

module.exports = Sale;
