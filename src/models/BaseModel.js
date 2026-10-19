'use strict';

const db = require('../config/db');

/**
 * Plain create / read / update for simple tables (brands, categories, suppliers...).
 * A model extends it and only declares: table, fields (the columns a user may set), orderBy.
 * Rows are never hard-deleted: switch is_active off with update(id, { is_active: false }).
 */
class BaseModel {
  static table = '';
  static fields = [];
  static orderBy = 'id';

  // findAll({ is_active: true, branch_id: 2 })  -> simple "column = value" filters on known fields
  static async findAll(filters = {}, opts = {}) {
    const where = new db.Where();
    for (const key of this.fields) {
      if (filters[key] !== undefined && filters[key] !== '') where.add(`${key} = ?`, filters[key]);
    }
    const { rows } = await db.query(
      `SELECT * FROM ${this.table} ${where.sql()} ORDER BY ${this.orderBy}`,
      where.values,
      opts
    );
    return rows;
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query(`SELECT * FROM ${this.table} WHERE id = $1`, [id], opts);
    return rows[0] || null;
  }

  static async create(data, opts = {}) {
    const ins = db.buildInsert(data, this.fields);
    const { rows } = await db.query(
      `INSERT INTO ${this.table} (${ins.columns}) VALUES (${ins.placeholders}) RETURNING *`,
      ins.values,
      opts
    );
    return rows[0];
  }

  static async update(id, data, opts = {}) {
    const up = db.buildUpdate(data, this.fields, 2);
    const { rows } = await db.query(
      `UPDATE ${this.table} SET ${up.sets} WHERE id = $1 RETURNING *`,
      [id, ...up.values],
      opts
    );
    return rows[0] || null;
  }
}

module.exports = BaseModel;
