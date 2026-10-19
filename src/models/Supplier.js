'use strict';

const db = require('../config/db');
const BaseModel = require('./BaseModel');

class Supplier extends BaseModel {
  static table = 'suppliers';
  static orderBy = 'name';
  static fields = ['name', 'contact_person', 'phone', 'email', 'address', 'kra_pin', 'payment_terms_days', 'notes', 'is_active'];

  /** Suppliers with what we owe each one. f = { q, onlyOwed } */
  static async listWithBalances(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.q) w.search(['s.name', 's.phone', 's.contact_person'], f.q);
    if (f.onlyOwed) w.add('b.balance_owed > 0');
    const { rows } = await db.query(
      `SELECT s.id, s.name, s.contact_person, s.phone, s.email, s.payment_terms_days, s.is_active,
              b.balance_owed, b.oldest_due_date
         FROM suppliers s JOIN v_supplier_balances b ON b.supplier_id = s.id
         ${w.sql()}
        ORDER BY s.name`,
      w.values,
      opts
    );
    return rows;
  }

  /** The supplier with their balance, recent purchases and payments. */
  static async statement(id, opts = {}) {
    const supplier = await Supplier.findById(id, opts);
    if (!supplier) return null;
    const balance = await db.query('SELECT balance_owed, oldest_due_date FROM v_supplier_balances WHERE supplier_id = $1', [id], opts);
    const purchases = await db.query(
      `SELECT id, purchase_no, branch_id, purchase_date, status, total, amount_paid, payment_status, due_date
         FROM purchases WHERE supplier_id = $1 ORDER BY purchase_date DESC, id DESC LIMIT 100`,
      [id],
      opts
    );
    const payments = await db.query(
      `SELECT id, purchase_id, amount, method, reference, paid_at, voided_at
         FROM supplier_payments WHERE supplier_id = $1 ORDER BY paid_at DESC LIMIT 100`,
      [id],
      opts
    );
    return { ...supplier, ...(balance.rows[0] || { balance_owed: 0, oldest_due_date: null }), purchases: purchases.rows, payments: payments.rows };
  }
}

module.exports = Supplier;
