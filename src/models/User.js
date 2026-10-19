'use strict';

const bcrypt = require('bcryptjs');
const db = require('../config/db');
const AppError = require('../utils/AppError');

// Never select password_hash unless you are logging someone in.
const PUBLIC_COLUMNS = `id, branch_id, full_name, username, email, phone, role, can_override_min_price,
  can_view_costs, max_discount_percent, is_active, must_change_password, last_login_at, created_at`;

const EDITABLE = [
  'branch_id', 'full_name', 'username', 'email', 'phone', 'role', 'can_override_min_price',
  'can_view_costs', 'max_discount_percent', 'is_active', 'must_change_password',
];

class User {
  static async findById(id, opts = {}) {
    const { rows } = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id], opts);
    return rows[0] || null;
  }

  /** For login only: includes password_hash, failed_login_attempts and locked_until. */
  static async findByUsername(username, opts = {}) {
    const { rows } = await db.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username], opts);
    return rows[0] || null;
  }

  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('branch_id = ?', f.branchId);
    if (f.role) w.add('role = ?::user_role', f.role);
    if (f.isActive !== undefined && f.isActive !== '') w.add('is_active = ?', f.isActive);
    if (f.q) w.search(['full_name', 'username', 'email', 'phone'], f.q);
    const { rows } = await db.query(
      `SELECT ${PUBLIC_COLUMNS} FROM users ${w.sql()} ORDER BY role, full_name`,
      w.values,
      opts
    );
    return rows;
  }

  /** data.password is the plain password; it is hashed here (bcrypt, 10 rounds). */
  static async create(data, opts = {}) {
    if (!data.password || String(data.password).length < 8) {
      throw new AppError('The password must be at least 8 characters');
    }
    if (data.role === 'owner') data = { ...data, branch_id: null };
    else if (!data.branch_id) throw new AppError('Choose the shop this person works in');

    const password_hash = await bcrypt.hash(String(data.password), 10);
    const ins = db.buildInsert({ ...data, password_hash }, [...EDITABLE, 'password_hash']);
    const { rows } = await db.query(
      `INSERT INTO users (${ins.columns}) VALUES (${ins.placeholders}) RETURNING ${PUBLIC_COLUMNS}`,
      ins.values,
      opts
    );
    return rows[0];
  }

  static async update(id, data, opts = {}) {
    const d = { ...data };
    if (d.role === 'owner') d.branch_id = null;
    const up = db.buildUpdate(d, EDITABLE, 2);
    const { rows } = await db.query(
      `UPDATE users SET ${up.sets} WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [id, ...up.values],
      opts
    );
    return rows[0] || null;
  }

  /** Sets a new password. mustChange = true forces the person to choose their own at next login. */
  static async setPassword(id, newPassword, { mustChange = false } = {}, opts = {}) {
    if (!newPassword || String(newPassword).length < 8) {
      throw new AppError('The password must be at least 8 characters');
    }
    const hash = await bcrypt.hash(String(newPassword), 10);
    const { rowCount } = await db.query(
      `UPDATE users SET password_hash = $2, must_change_password = $3,
                        failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [id, hash, mustChange],
      opts
    );
    return rowCount === 1;
  }

  static verifyPassword(user, plainPassword) {
    return bcrypt.compare(String(plainPassword || ''), user.password_hash);
  }

  static isLocked(user) {
    return Boolean(user.locked_until && new Date(user.locked_until) > new Date());
  }

  static async recordLoginSuccess(id, opts = {}) {
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [id],
      opts
    );
  }

  /** Counts a wrong password. After max_failed_logins (setting) the account locks for lockout_minutes. */
  static async recordLoginFailure(id, opts = {}) {
    const { rows } = await db.query(
      `UPDATE users SET
          failed_login_attempts = CASE
              WHEN failed_login_attempts + 1 >= COALESCE((SELECT value::int FROM app_settings WHERE key = 'max_failed_logins'), 5)
              THEN 0 ELSE failed_login_attempts + 1 END,
          locked_until = CASE
              WHEN failed_login_attempts + 1 >= COALESCE((SELECT value::int FROM app_settings WHERE key = 'max_failed_logins'), 5)
              THEN now() + make_interval(mins => COALESCE((SELECT value::int FROM app_settings WHERE key = 'lockout_minutes'), 15))
              ELSE locked_until END
        WHERE id = $1
        RETURNING failed_login_attempts, locked_until`,
      [id],
      opts
    );
    return rows[0];
  }
}

module.exports = User;
