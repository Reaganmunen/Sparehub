'use strict';

const db = require('../config/db');

/** Business settings stored in the app_settings table (VAT on/off, lockout rules, negative stock...). */
class Setting {
  static async all(opts = {}) {
    const { rows } = await db.query('SELECT key, value, description, updated_at FROM app_settings ORDER BY key', [], opts);
    return rows;
  }

  static async get(key, fallback = null, opts = {}) {
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key], opts);
    return rows.length ? rows[0].value : fallback;
  }

  static async getBool(key, fallback = false, opts = {}) {
    const value = await Setting.get(key, null, opts);
    return value === null ? fallback : value === 'true';
  }

  static async getNumber(key, fallback = 0, opts = {}) {
    const value = await Setting.get(key, null, opts);
    const n = Number(value);
    return value === null || Number.isNaN(n) ? fallback : n;
  }

  static async set(key, value, opts = {}) {
    const { rows } = await db.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       RETURNING key, value, description, updated_at`,
      [key, String(value)],
      opts
    );
    return rows[0];
  }
}

module.exports = Setting;
