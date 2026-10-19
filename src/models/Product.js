'use strict';

const db = require('../config/db');
const AppError = require('../utils/AppError');

const COLUMNS = [
  'sku', 'barcode', 'part_number', 'name', 'description', 'category_id', 'brand_id', 'unit_id',
  'buying_price', 'selling_price', 'min_selling_price', 'wholesale_price', 'tax_rate',
  'default_reorder_level', 'track_stock', 'image_url', 'is_active', 'created_by',
];
const UPDATABLE = COLUMNS.filter((c) => c !== 'created_by');

// Columns only managers / the owner may see (opts.includeCost = true)
const PRIVATE_FIELDS = ['buying_price', 'min_selling_price'];

function clean(data) {
  const d = { ...data };
  for (const k of ['barcode', 'part_number', 'description', 'image_url', 'wholesale_price', 'category_id', 'brand_id']) {
    if (d[k] === '') d[k] = null;
  }
  if (typeof d.sku === 'string') d.sku = d.sku.trim().toUpperCase();
  if (typeof d.name === 'string') d.name = d.name.trim();
  return d;
}

async function setFitments(client, productId, vehicleModelIds) {
  await client.query('DELETE FROM product_fitments WHERE product_id = $1', [productId]);
  if (vehicleModelIds.length) {
    await client.query(
      `INSERT INTO product_fitments (product_id, vehicle_model_id)
       SELECT $1::int, v FROM unnest($2::int[]) AS v ON CONFLICT DO NOTHING`,
      [productId, vehicleModelIds]
    );
  }
}

async function findOrCreateByName(client, table, name, extraWhere = '') {
  const found = await client.query(`SELECT id FROM ${table} WHERE LOWER(name) = LOWER($1) ${extraWhere}`, [name]);
  if (found.rows.length) return found.rows[0].id;
  const created = await client.query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id`, [name]);
  return created.rows[0].id;
}

class Product {
  /**
   * Product list for the cashier's search box. Reads the v_pos_products view: no cost price.
   * The minimum price is hidden too (opts.includeCost) so cashiers cannot just haggle down to the floor;
   * the database enforces it anyway.
   * f = { branchId, q, categoryId, brandId, vehicleModelId, inStockOnly, limit }
   */
  static async searchForPos(f = {}, opts = {}) {
    if (!f.branchId) throw new AppError('branchId is required');
    const w = new db.Where().add('v.branch_id = ?', f.branchId);
    if (f.q) w.search(['v.product_name', 'v.sku', 'v.barcode', 'v.part_number'], f.q);
    if (f.categoryId) w.add('v.product_id IN (SELECT id FROM products WHERE category_id = ?)', f.categoryId);
    if (f.brandId) w.add('v.product_id IN (SELECT id FROM products WHERE brand_id = ?)', f.brandId);
    if (f.vehicleModelId) w.add('v.product_id IN (SELECT product_id FROM product_fitments WHERE vehicle_model_id = ?)', f.vehicleModelId);
    if (f.inStockOnly) w.add('(v.quantity > 0 OR NOT v.track_stock)');

    let order = 'v.product_name';
    const values = [...w.values];
    if (f.q) {
      values.push(String(f.q).trim());
      const i = values.length;
      order = `(v.barcode = $${i} OR UPPER(v.sku) = UPPER($${i}) OR UPPER(v.part_number) = UPPER($${i})) DESC, v.product_name`;
    }
    values.push(Math.min(parseInt(f.limit, 10) || 30, 100));

    const cols = `v.product_id, v.sku, v.barcode, v.part_number, v.product_name, v.category, v.brand, v.unit,
                  v.quantity, v.selling_price, v.wholesale_price, v.tax_rate, v.track_stock, v.shelf_location`
      + (opts.includeCost ? ', v.min_selling_price' : '');
    const { rows } = await db.query(
      `SELECT ${cols} FROM v_pos_products v ${w.sql()} ORDER BY ${order} LIMIT $${values.length}`,
      values,
      opts
    );
    return rows;
  }

  /** Exact barcode or SKU scan at the till. */
  static async findForPosByCode(branchId, code, opts = {}) {
    const { rows } = await db.query(
      `SELECT product_id, sku, barcode, part_number, product_name, unit, quantity, selling_price,
              wholesale_price, tax_rate, track_stock
         FROM v_pos_products
        WHERE branch_id = $1 AND (barcode = $2 OR UPPER(sku) = UPPER($2))`,
      [branchId, String(code).trim()],
      opts
    );
    return rows[0] || null;
  }

  /** Catalogue list for the admin screens (all shops). f = { q, categoryId, brandId, isActive, page, limit } */
  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.q) w.search(['p.name', 'p.sku', 'p.barcode', 'p.part_number'], f.q);
    if (f.categoryId) w.add('p.category_id = ?', f.categoryId);
    if (f.brandId) w.add('p.brand_id = ?', f.brandId);
    if (f.isActive !== undefined && f.isActive !== '') w.add('p.is_active = ?', f.isActive);
    if (f.vehicleModelId) w.add('p.id IN (SELECT product_id FROM product_fitments WHERE vehicle_model_id = ?)', f.vehicleModelId);
    const p = db.paging(f);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category, b.name AS brand, u.abbreviation AS unit, COUNT(*) OVER() AS total_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b     ON b.id = p.brand_id
         JOIN units u           ON u.id = p.unit_id
         ${w.sql()}
        ORDER BY p.name
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    const page = db.toPage(rows, p);
    if (!opts.includeCost) page.data = db.omit(page.data, PRIVATE_FIELDS);
    return page;
  }

  static async findById(id, opts = {}) {
    const { rows } = await db.query(
      `SELECT p.*, c.name AS category, b.name AS brand, u.name AS unit, u.abbreviation AS unit_abbr,
              COALESCE((SELECT json_agg(json_build_object('id', vm.id, 'vehicle_type', vm.vehicle_type,
                                                          'make', vm.make, 'model', vm.model)
                                        ORDER BY vm.make, vm.model)
                          FROM product_fitments pf JOIN vehicle_models vm ON vm.id = pf.vehicle_model_id
                         WHERE pf.product_id = p.id), '[]'::json) AS fitments,
              COALESCE((SELECT json_agg(json_build_object('branch_id', bs.branch_id, 'quantity', bs.quantity,
                                                          'selling_price', bs.selling_price,
                                                          'reorder_level', bs.reorder_level,
                                                          'shelf_location', bs.shelf_location)
                                        ORDER BY bs.branch_id)
                          FROM branch_stock bs WHERE bs.product_id = p.id), '[]'::json) AS stock
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN brands b     ON b.id = p.brand_id
         JOIN units u           ON u.id = p.unit_id
        WHERE p.id = $1`,
      [id],
      opts
    );
    if (!rows[0]) return null;
    return opts.includeCost ? rows[0] : db.omit(rows[0], PRIVATE_FIELDS);
  }

  /**
   * Adds a product. Besides the product columns, data may also contain:
   *   fitments:       [vehicle_model_id, ...]             which bikes / tuk tuks it fits
   *   branch_ids:     [1, 2]                              shops that will sell it (so it shows in their POS)
   *   opening_stock:  [{ branch_id, quantity, unit_cost }] stock already on the shelf today
   * If min_selling_price is left out it equals the selling price (no discount allowed).
   */
  static async create(data, opts = {}) {
    const d = clean(data);
    if (!d.sku || !d.name) throw new AppError('SKU and product name are required');
    if (d.selling_price === undefined || d.selling_price === '' || d.selling_price === null) {
      throw new AppError('The selling price is required');
    }
    if (d.min_selling_price === undefined || d.min_selling_price === '' || d.min_selling_price === null) {
      d.min_selling_price = d.selling_price;
    }
    if (Number(d.min_selling_price) > Number(d.selling_price)) {
      throw new AppError('The minimum price cannot be higher than the selling price');
    }

    return db.inTransaction(opts, async (client) => {
      if (!d.unit_id) {
        const unit = await client.query("SELECT id FROM units WHERE abbreviation = 'pc'");
        d.unit_id = unit.rows[0] && unit.rows[0].id;
      }
      const ins = db.buildInsert({ ...d, created_by: opts.userId || d.created_by }, COLUMNS);
      const { rows } = await client.query(
        `INSERT INTO products (${ins.columns}) VALUES (${ins.placeholders}) RETURNING id`,
        ins.values
      );
      const id = rows[0].id;

      if (Array.isArray(d.fitments)) await setFitments(client, id, d.fitments);

      if (Array.isArray(d.branch_ids) && d.branch_ids.length) {
        await client.query(
          `INSERT INTO branch_stock (branch_id, product_id)
           SELECT b, $2::int FROM unnest($1::int[]) AS b ON CONFLICT DO NOTHING`,
          [d.branch_ids, id]
        );
      }

      for (const os of d.opening_stock || []) {
        if (Number(os.quantity) > 0) {
          await client.query(
            `INSERT INTO stock_movements (branch_id, product_id, movement_type, quantity_change, unit_cost, reference_type, created_by)
             VALUES ($1, $2, 'opening_stock', $3, $4, 'manual', $5)`,
            [os.branch_id, id, os.quantity, os.unit_cost ?? d.buying_price ?? 0, opts.userId || null]
          );
        }
      }
      return Product.findById(id, { client, includeCost: true });
    });
  }

  /** Price changes are logged automatically by the database, with opts.userId as the person responsible. */
  static async update(id, data, opts = {}) {
    const d = clean(data);
    return db.inTransaction(opts, async (client) => {
      const fields = UPDATABLE.filter((f) => d[f] !== undefined);
      if (fields.length) {
        const up = db.buildUpdate(d, UPDATABLE, 2);
        const result = await client.query(`UPDATE products SET ${up.sets} WHERE id = $1`, [id, ...up.values]);
        if (!result.rowCount) throw new AppError('Product not found', 404);
      }
      if (Array.isArray(d.fitments)) await setFitments(client, id, d.fitments);
      return Product.findById(id, { client, includeCost: true });
    });
  }

  static async setActive(id, isActive, opts = {}) {
    return Product.update(id, { is_active: Boolean(isActive) }, opts);
  }

  /** Every price change with who made it. Managers / owner only. */
  static async priceHistory(productId, opts = {}) {
    const { rows } = await db.query(
      `SELECT h.*, u.full_name AS changed_by_name
         FROM product_price_history h LEFT JOIN users u ON u.id = h.changed_by
        WHERE h.product_id = $1 ORDER BY h.changed_at DESC LIMIT 100`,
      [productId],
      opts
    );
    return rows;
  }

  /**
   * Bulk import from Excel / CSV (the controller turns the file into an array of objects).
   * Each row: { sku, name, part_number, barcode, category, brand, unit, buying_price, selling_price,
   *             min_selling_price, wholesale_price, reorder_level, branch_id, quantity }
   * - Existing SKU: its details and prices are updated (stock is NOT touched).
   * - New SKU: the product is created; if branch_id is given it is listed in that shop,
   *   and if quantity > 0 the opening stock is recorded.
   * A bad row is skipped and reported; the good rows are still saved.
   */
  static async importMany(rows, opts = {}) {
    if (!Array.isArray(rows) || !rows.length) throw new AppError('There are no rows to import');

    return db.inTransaction(opts, async (client) => {
      const result = { created: 0, updated: 0, failed: [] };
      const defaultUnit = (await client.query("SELECT id FROM units WHERE abbreviation = 'pc'")).rows[0];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        await client.query('SAVEPOINT import_row');
        try {
          const sku = String(row.sku || '').trim().toUpperCase();
          const name = String(row.name || '').trim();
          if (!sku || !name) throw new AppError('sku and name are required');
          const selling = Number(row.selling_price);
          if (!(selling >= 0)) throw new AppError('selling_price must be a number');
          const min = row.min_selling_price === undefined || row.min_selling_price === '' ? selling : Number(row.min_selling_price);

          const categoryId = row.category ? await findOrCreateByName(client, 'categories', String(row.category).trim(), 'AND parent_id IS NULL') : null;
          const brandId = row.brand ? await findOrCreateByName(client, 'brands', String(row.brand).trim()) : null;
          let unitId = defaultUnit && defaultUnit.id;
          if (row.unit) {
            const u = await client.query('SELECT id FROM units WHERE LOWER(abbreviation) = LOWER($1) OR LOWER(name) = LOWER($1)', [String(row.unit).trim()]);
            if (u.rows.length) unitId = u.rows[0].id;
          }

          const fields = {
            sku, name,
            barcode: row.barcode ? String(row.barcode).trim() : null,
            part_number: row.part_number ? String(row.part_number).trim() : null,
            category_id: categoryId, brand_id: brandId, unit_id: unitId,
            buying_price: Number(row.buying_price) || 0,
            selling_price: selling,
            min_selling_price: min,
            wholesale_price: row.wholesale_price === undefined || row.wholesale_price === '' ? null : Number(row.wholesale_price),
            default_reorder_level: Number(row.reorder_level) || 0,
          };

          const existing = await client.query('SELECT id FROM products WHERE sku = $1', [sku]);
          let productId;
          let isNew = false;
          if (existing.rows.length) {
            productId = existing.rows[0].id;
            const up = db.buildUpdate(fields, Object.keys(fields), 2);
            await client.query(`UPDATE products SET ${up.sets} WHERE id = $1`, [productId, ...up.values]);
            result.updated++;
          } else {
            const ins = db.buildInsert({ ...fields, created_by: opts.userId }, [...Object.keys(fields), 'created_by']);
            const created = await client.query(`INSERT INTO products (${ins.columns}) VALUES (${ins.placeholders}) RETURNING id`, ins.values);
            productId = created.rows[0].id;
            isNew = true;
            result.created++;
          }

          const branchId = row.branch_id || opts.branchId;
          const qty = Number(row.quantity) || 0;
          if (qty > 0 && !branchId) throw new AppError('branch_id is required when a quantity is given');
          if (branchId) {
            await client.query('INSERT INTO branch_stock (branch_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [branchId, productId]);
            if (isNew && qty > 0) {
              await client.query(
                `INSERT INTO stock_movements (branch_id, product_id, movement_type, quantity_change, unit_cost, reference_type, created_by)
                 VALUES ($1, $2, 'opening_stock', $3, $4, 'import', $5)`,
                [branchId, productId, qty, fields.buying_price, opts.userId || null]
              );
            }
          }
          await client.query('RELEASE SAVEPOINT import_row');
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT import_row');
          result.failed.push({ row: i + 1, sku: row.sku || null, error: err.message });
        }
      }
      return result;
    });
  }
}

module.exports = Product;
