'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

const LEVEL_COLUMNS = `branch_id, branch_name, product_id, sku, barcode, part_number, product_name, category, brand,
  unit, quantity, reorder_level, is_low_stock, selling_price, wholesale_price, shelf_location, last_counted_at, is_active`;
const COST_COLUMNS = 'average_cost, min_selling_price, stock_value_at_cost, stock_value_at_selling';

// Manual stock changes and their direction. Sales, purchases and transfers have their own models.
const MANUAL_MOVEMENTS = {
  opening_stock: 1,
  adjustment_in: 1,
  adjustment_out: -1,
  damage: -1,
  supplier_return: -1,
};

/** Stock per shop. Quantities only ever change through stock_movements (the database keeps them in step). */
class Stock {
  /** f = { branchId, q, categoryId, lowOnly, page, limit }. Cost columns need opts.includeCost. */
  static async levels(f = {}, opts = {}) {
    const w = new db.Where().add('is_active = TRUE');
    if (f.branchId) w.add('branch_id = ?', f.branchId);
    if (f.q) w.search(['product_name', 'sku', 'barcode', 'part_number'], f.q);
    if (f.lowOnly) w.add('is_low_stock = TRUE');
    if (f.categoryId) w.add('product_id IN (SELECT id FROM products WHERE category_id = ?)', f.categoryId);
    const p = db.paging(f);
    const i = w.values.length;
    const cols = LEVEL_COLUMNS + (opts.includeCost ? `, ${COST_COLUMNS}` : '');
    const { rows } = await db.query(
      `SELECT ${cols}, COUNT(*) OVER() AS total_count FROM v_stock_levels ${w.sql()}
        ORDER BY product_name LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }

  static async findOne(branchId, productId, opts = {}) {
    const cols = LEVEL_COLUMNS + (opts.includeCost ? `, ${COST_COLUMNS}` : '');
    const { rows } = await db.query(
      `SELECT ${cols} FROM v_stock_levels WHERE branch_id = $1 AND product_id = $2`,
      [branchId, productId],
      opts
    );
    return rows[0] || null;
  }

  static async lowStock(branchId, opts = {}) {
    const cols = LEVEL_COLUMNS + (opts.includeCost ? `, ${COST_COLUMNS}` : '');
    const { rows } = await db.query(
      `SELECT ${cols} FROM v_low_stock WHERE ($1::int IS NULL OR branch_id = $1) ORDER BY branch_id, product_name`,
      [branchId || null],
      opts
    );
    return rows;
  }

  /** Makes a product available in a shop (it then shows in that shop's POS), with zero stock. */
  static async listProductInBranch(branchId, productId, opts = {}) {
    await db.query(
      'INSERT INTO branch_stock (branch_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [branchId, productId],
      opts
    );
    return Stock.findOne(branchId, productId, opts);
  }

  /** Shop-specific settings: reorder level, shelf, and optional price overrides for this shop only. */
  static async updateSettings(branchId, productId, data, opts = {}) {
    const allowed = ['reorder_level', 'selling_price', 'min_selling_price', 'wholesale_price', 'shelf_location'];
    const d = {};
    for (const k of allowed) if (data[k] !== undefined) d[k] = data[k] === '' ? null : data[k];
    const up = db.buildUpdate(d, allowed, 3);
    const { rowCount } = await db.query(
      `UPDATE branch_stock SET ${up.sets}, updated_at = now() WHERE branch_id = $1 AND product_id = $2`,
      [branchId, productId, ...up.values],
      opts
    );
    if (!rowCount) throw new AppError('This product is not listed in that shop yet', 404);
    return Stock.findOne(branchId, productId, opts);
  }

  /**
   * Manual stock change, recorded in the ledger. type is one of:
   *   opening_stock, adjustment_in, adjustment_out, damage, supplier_return
   * quantity is always positive; the type decides the direction. A reason is required except for opening_stock.
   */
  static async adjust({ branchId, productId, type, quantity, unitCost, reason }, opts = {}) {
    const direction = MANUAL_MOVEMENTS[type];
    if (!direction) throw new AppError(`Unknown stock change type "${type}"`);
    const qty = Number(quantity);
    if (!(qty > 0)) throw new AppError('The quantity must be more than zero');
    if (type !== 'opening_stock' && !String(reason || '').trim()) throw new AppError('Please give a reason for this stock change');

    return db.inTransaction(opts, async (client) => {
      await client.query(
        `INSERT INTO stock_movements (branch_id, product_id, movement_type, quantity_change, unit_cost, reference_type, reason, created_by)
         VALUES ($1, $2, $3::stock_movement_type, $4, $5, 'manual', $6, $7)`,
        [branchId, productId, type, direction * qty, unitCost ?? null, reason || null, opts.userId || null]
      );
      return Stock.findOne(branchId, productId, { client, includeCost: opts.includeCost });
    });
  }

  /** The history of a product's stock: every sale, purchase, transfer and adjustment. */
  static async movements(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.branchId) w.add('m.branch_id = ?', f.branchId);
    if (f.productId) w.add('m.product_id = ?', f.productId);
    if (f.type) w.add('m.movement_type = ?::stock_movement_type', f.type);
    if (f.from) w.add(`${db.dayOf('m.created_at')} >= ?::date`, f.from);
    if (f.to) w.add(`${db.dayOf('m.created_at')} <= ?::date`, f.to);
    const p = db.paging(f, 50);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT m.id, m.branch_id, m.product_id, p.sku, p.name AS product_name, m.movement_type, m.quantity_change,
              m.quantity_after, m.reference_type, m.reference_id, m.reason, m.created_at,
              u.full_name AS created_by_name, COUNT(*) OVER() AS total_count
         FROM stock_movements m
         JOIN products p    ON p.id = m.product_id
         LEFT JOIN users u  ON u.id = m.created_by
         ${w.sql()}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }
}

module.exports = Stock;
