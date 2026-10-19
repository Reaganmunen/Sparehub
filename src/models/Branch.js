'use strict';

const db = require('../config/db');
const BaseModel = require('./BaseModel');

/** The shops. Seeded with BB (Boda Boda Spares) and TT (Tuk Tuk Spares). */
class Branch extends BaseModel {
  static table = 'branches';
  static orderBy = 'id';
  static fields = [
    'code', 'name', 'shop_type', 'address', 'town', 'phone', 'email', 'kra_pin',
    'mpesa_till_number', 'mpesa_business_shortcode', 'receipt_header', 'receipt_footer', 'is_active',
  ];

  static async create(data, opts = {}) {
    return super.create({ ...data, code: data.code ? String(data.code).toUpperCase() : data.code }, opts);
  }

  static async update(id, data, opts = {}) {
    const d = { ...data };
    if (d.code) d.code = String(d.code).toUpperCase();
    return super.update(id, d, opts);
  }

  static async findByCode(code, opts = {}) {
    const { rows } = await db.query('SELECT * FROM branches WHERE code = $1', [String(code).toUpperCase()], opts);
    return rows[0] || null;
  }
}

module.exports = Branch;
