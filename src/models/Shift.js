'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

/** A cashier's working session at the till: opening float, takings, counted cash at the end. */
class Shift {
  static async open({ branch_id, cashier_id, opening_float = 0 }, opts = {}) {
    try {
      const { rows } = await db.query(
        'INSERT INTO shifts (branch_id, cashier_id, opening_float) VALUES ($1, $2, $3) RETURNING *',
        [branch_id, cashier_id, opening_float],
        opts
      );
      return rows[0];
    } catch (err) {
      if (err.code === '23505') throw new AppError('You already have an open shift. Close it first.', 409);
      throw err;
    }
  }

  static async findOpenForCashier(cashierId, opts = {}) {
    const { rows } = await db.query("SELECT * FROM shifts WHERE cashier_id = $1 AND status = 'open'", [cashierId], opts);
    return rows[0] || null;
  }

  /**
   * Closes the shift. The cashier only gives the cash they counted; the database works out what
   * should be in the till and the difference. Returns the full summary.
   */
  static async close(id, { counted_cash, notes } = {}, opts = {}) {
    if (counted_cash === undefined || counted_cash === null || counted_cash === '' || Number(counted_cash) < 0) {
      throw new AppError('Enter the cash you counted in the till');
    }
    const { rowCount } = await db.query(
      `UPDATE shifts SET status = 'closed', counted_cash = $2, notes = COALESCE($3, notes)
        WHERE id = $1 AND status = 'open'`,
      [id, counted_cash, notes || null],
      opts
    );
    if (!rowCount) throw new AppError('This shift is already closed or does not exist', 409);
    return Shift.summary(id, opts);
  }

  /** What came in and went out: cash, M-Pesa, refunds, expenses, expected cash and the variance. */
  static async summary(id, opts = {}) {
    const { rows } = await db.query('SELECT * FROM v_shift_summary WHERE shift_id = $1', [id], opts);
    return rows[0] || null;
  }

  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('branch_id = ?', f.branchId);
    if (f.cashierId) w.add('cashier_id = ?', f.cashierId);
    if (f.status) w.add('status = ?::shift_status', f.status);
    if (f.from) w.add(`${db.dayOf('opened_at')} >= ?::date`, f.from);
    if (f.to) w.add(`${db.dayOf('opened_at')} <= ?::date`, f.to);
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM v_shift_summary ${w.sql()}
        ORDER BY opened_at DESC LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }
}

module.exports = Shift;
