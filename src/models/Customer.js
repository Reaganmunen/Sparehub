'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');
const BaseModel = require('./BaseModel');
const { normalizePhone } = require('../utils/phone');

function withCleanPhone(data) {
  const d = { ...data };
  if (d.phone === '') d.phone = null;
  if (d.phone) {
    const phone = normalizePhone(d.phone);
    if (!phone) throw new AppError('Enter a valid Kenyan phone number, e.g. 0712345678');
    d.phone = phone;
  }
  return d;
}

/** Walk-in customers need no record (leave customer_id empty on the sale). Regulars, mechanics and credit buyers do. */
class Customer extends BaseModel {
  static table = 'customers';
  static orderBy = 'name';
  static fields = ['name', 'phone', 'email', 'customer_type', 'address', 'kra_pin', 'credit_limit', 'notes', 'is_active'];

  static async create(data, opts = {}) {
    return super.create(withCleanPhone(data), opts);
  }

  static async update(id, data, opts = {}) {
    return super.update(id, withCleanPhone(data), opts);
  }

  /** Search box: by name or phone. Includes what each customer currently owes. f = { q, customerType, onlyOwing, page, limit } */
  static async search(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.q) w.search(['c.name', 'c.phone'], f.q);
    if (f.customerType) w.add('c.customer_type = ?::customer_type', f.customerType);
    if (f.isActive !== undefined && f.isActive !== '') w.add('c.is_active = ?', f.isActive);
    if (f.onlyOwing) w.add('b.balance_due > 0');
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.phone, c.email, c.customer_type, c.credit_limit, c.is_active,
              b.balance_due, b.oldest_due_date, b.open_sales, COUNT(*) OVER() AS total_count
         FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id
         ${w.sql()}
        ORDER BY c.name
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }

  static async findByPhone(phone, opts = {}) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const { rows } = await db.query('SELECT * FROM customers WHERE phone = $1', [normalized], opts);
    return rows[0] || null;
  }

  static async balanceOf(id, opts = {}) {
    const { rows } = await db.query('SELECT * FROM v_customer_balances WHERE customer_id = $1', [id], opts);
    return rows[0] || null;
  }

  /** Throws if putting `amount` more on credit would break the customer's credit limit. */
  static async assertCreditAllowed(customerId, amount, opts = {}) {
    const row = await Customer.balanceOf(customerId, opts);
    if (!row) throw new AppError('Customer not found', 404);
    const limit = Number(row.credit_limit);
    if (limit <= 0) throw new AppError(`${row.name} is not allowed to buy on credit`, 403, 'NO_CREDIT');
    const after = db.round2(Number(row.balance_due) + Number(amount));
    if (after > limit) {
      throw new AppError(
        `Credit limit exceeded: ${row.name} already owes KES ${row.balance_due} and the limit is KES ${limit}`,
        403,
        'CREDIT_LIMIT'
      );
    }
    return true;
  }

  /** Purchase history and payments for one customer. */
  static async statement(id, opts = {}) {
    const customer = await Customer.findById(id, opts);
    if (!customer) return null;
    const balance = await Customer.balanceOf(id, opts);
    const sales = await db.query(
      `SELECT id, receipt_no, branch_id, sold_at, total, returned_total, amount_paid,
              (total - returned_total - amount_paid) AS balance, due_date, payment_status
         FROM sales WHERE customer_id = $1 AND status = 'completed' ORDER BY sold_at DESC LIMIT 200`,
      [id],
      opts
    );
    const payments = await db.query(
      `SELECT id, sale_id, direction, method, amount, reference, paid_at
         FROM payments WHERE customer_id = $1 AND voided_at IS NULL ORDER BY paid_at DESC LIMIT 200`,
      [id],
      opts
    );
    return {
      ...customer,
      balance_due: balance ? balance.balance_due : 0,
      oldest_due_date: balance ? balance.oldest_due_date : null,
      sales: sales.rows,
      payments: payments.rows,
    };
  }
}

module.exports = Customer;
