'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

const METHODS = ['cash', 'mpesa', 'bank_transfer', 'card'];

/** Money spent running the shops: rent, power, transport, wages, repairs... */
class Expense {
  /**
   * data = { branch_id, category_id, amount, description, expense_date, method, reference, paid_to, approved_by }
   * opts.userId = who recorded it. A cash expense is taken from the cashier's open shift automatically,
   * so the till reconciliation at the end of the shift stays right.
   */
  static async create(data, opts = {}) {
    if (!opts.userId) throw new AppError('userId is required');
    const method = data.method || 'cash';
    if (!METHODS.includes(method)) throw new AppError('Unknown payment method');
    if (!(Number(data.amount) > 0)) throw new AppError('The amount must be more than zero');
    if (!String(data.description || '').trim()) throw new AppError('Say what the money was spent on');

    const { rows } = await db.query(
      `INSERT INTO expenses (branch_id, category_id, shift_id, amount, description, expense_date, method, reference,
                             paid_to, created_by, approved_by)
       VALUES ($1, $2,
               CASE WHEN $7 = 'cash' THEN (SELECT id FROM shifts WHERE cashier_id = $10 AND branch_id = $1 AND status = 'open') END,
               $3, $4, COALESCE($5::date, ${db.TODAY}), $7::payment_method, $6, $8, $10, $9)
       RETURNING *`,
      [
        data.branch_id, data.category_id, data.amount, data.description, data.expense_date || null,
        data.reference || null, method, data.paid_to || null, data.approved_by || null, opts.userId,
      ],
      opts
    );
    return rows[0];
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT e.*, c.name AS category, u.full_name AS created_by_name
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN users u ON u.id = e.created_by
        WHERE e.id = $1`,
      [id],
      opts
    );
    return rows[0] || null;
  }

  /** f = { branchId, categoryId, from, to, q, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('e.branch_id = ?', f.branchId);
    if (f.categoryId) w.add('e.category_id = ?', f.categoryId);
    if (f.from) w.add('e.expense_date >= ?::date', f.from);
    if (f.to) w.add('e.expense_date <= ?::date', f.to);
    if (f.q) w.search(['e.description', 'e.paid_to', 'e.reference'], f.q);
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT e.id, e.branch_id, e.category_id, c.name AS category, e.amount, e.description, e.expense_date,
              e.method, e.reference, e.paid_to, u.full_name AS created_by_name, COUNT(*) OVER() AS total_count
         FROM expenses e
         JOIN expense_categories c ON c.id = e.category_id
         JOIN users u              ON u.id = e.created_by
         ${w.sql()}
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }

  /** Totals per category for a period (for charts). f = { branchId, from, to } */
  static async totalsByCategory(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('e.branch_id = ?', f.branchId);
    if (f.from) w.add('e.expense_date >= ?::date', f.from);
    if (f.to) w.add('e.expense_date <= ?::date', f.to);
    const { rows } = await db.query(
      `SELECT c.id AS category_id, c.name AS category, SUM(e.amount) AS total, COUNT(*) AS entries
         FROM expenses e JOIN expense_categories c ON c.id = e.category_id
         ${w.sql()}
        GROUP BY c.id, c.name ORDER BY total DESC`,
      w.values,
      opts
    );
    return rows;
  }
}

module.exports = Expense;
