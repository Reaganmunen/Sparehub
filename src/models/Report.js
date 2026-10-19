'use strict';

const db = require('../config/db');

// Profit figures are only for people allowed to see costs (opts.includeCost)
const PROFIT_FIELDS = ['cost_of_goods', 'gross_profit', 'net_profit'];
const hide = (rows, opts) => (opts.includeCost ? rows : db.omit(rows, PROFIT_FIELDS));

/**
 * Read-only reports for the owner's phone and the manager's screens.
 * Every method takes an optional branchId (empty = both shops) and a date range { from, to } as 'YYYY-MM-DD'.
 * Dates are Nairobi dates. Cost and profit columns appear only with opts.includeCost.
 */
class Report {
  /** The home screen: today's numbers, one row per shop, plus the total of both. */
  static async dashboard(branchId, opts = {}) {
    const { rows } = await db.query(
      'SELECT * FROM v_owner_dashboard WHERE ($1::int IS NULL OR branch_id = $1) ORDER BY branch_id',
      [branchId || null],
      opts
    );
    const keys = ['transactions_today', 'net_sales_today', 'cash_today', 'mpesa_today', 'expenses_today', 'low_stock_items', 'unpaid_credit', 'stock_value_at_cost'];
    const totals = {};
    for (const k of keys) totals[k] = db.round2(rows.reduce((sum, r) => sum + Number(r[k] || 0), 0));
    const shops = opts.includeCost ? rows : db.omit(rows, ['stock_value_at_cost']);
    if (!opts.includeCost) delete totals.stock_value_at_cost;
    return { shops, totals };
  }

  /** One row per shop per day. Defaults to the last 30 days. */
  static async dailySales({ branchId, from, to } = {}, opts = {}) {
    const { rows } = await db.query(
      `SELECT * FROM v_daily_sales
        WHERE ($1::int IS NULL OR branch_id = $1)
          AND sale_date BETWEEN COALESCE($2::date, ${db.TODAY} - 30) AND COALESCE($3::date, ${db.TODAY})
        ORDER BY sale_date DESC, branch_id`,
      [branchId || null, from || null, to || null],
      opts
    );
    return hide(rows, opts);
  }

  /** Total sales, discounts, returns and (with costs) profit for a period. */
  static async salesSummary({ branchId, from, to } = {}, opts = {}) {
    const { rows } = await db.query(
      `SELECT COALESCE(SUM(transactions), 0) AS transactions, COALESCE(SUM(gross_sales), 0) AS gross_sales,
              COALESCE(SUM(discounts_given), 0) AS discounts_given, COALESCE(SUM(returns), 0) AS returns,
              COALESCE(SUM(net_sales), 0) AS net_sales, COALESCE(SUM(cost_of_goods), 0) AS cost_of_goods,
              COALESCE(SUM(gross_profit), 0) AS gross_profit
         FROM v_daily_sales
        WHERE ($1::int IS NULL OR branch_id = $1)
          AND sale_date BETWEEN COALESCE($2::date, ${db.TODAY} - 30) AND COALESCE($3::date, ${db.TODAY})`,
      [branchId || null, from || null, to || null],
      opts
    );
    return hide(rows, opts)[0];
  }

  /**
   * Best sellers (orderBy 'quantity' or 'revenue') for a period. f = { branchId, from, to, limit, orderBy }
   * Profit per product appears with opts.includeCost.
   */
  static async topProducts({ branchId, from, to, limit = 20, orderBy = 'quantity' } = {}, opts = {}) {
    const order = orderBy === 'revenue' ? 'revenue' : 'quantity_sold';
    const profitCols = opts.includeCost
      ? `, ROUND(SUM(COALESCE(si.unit_cost, 0) * (si.quantity - si.returned_quantity)), 2) AS cost,
         ROUND(SUM((si.line_total / si.quantity - COALESCE(si.unit_cost, 0)) * (si.quantity - si.returned_quantity)), 2) AS profit`
      : '';
    const { rows } = await db.query(
      `SELECT si.product_id, p.sku, p.name AS product_name,
              SUM(si.quantity - si.returned_quantity) AS quantity_sold,
              ROUND(SUM(si.line_total * (si.quantity - si.returned_quantity) / si.quantity), 2) AS revenue${profitCols}
         FROM sale_items si
         JOIN sales s    ON s.id = si.sale_id AND s.status = 'completed'
         JOIN products p ON p.id = si.product_id
        WHERE ($1::int IS NULL OR s.branch_id = $1)
          AND ${db.dayOf('s.sold_at')} BETWEEN COALESCE($2::date, ${db.TODAY} - 30) AND COALESCE($3::date, ${db.TODAY})
        GROUP BY si.product_id, p.sku, p.name
       HAVING SUM(si.quantity - si.returned_quantity) > 0
        ORDER BY ${order} DESC
        LIMIT $4`,
      [branchId || null, from || null, to || null, Math.min(parseInt(limit, 10) || 20, 200)],
      opts
    );
    return rows;
  }

  /** Stock that has not sold for `days` days (money sitting on the shelf). */
  static async slowMovers({ branchId, days = 60, limit = 100 } = {}, opts = {}) {
    const valueCol = opts.includeCost ? ', ROUND(bs.quantity * bs.average_cost, 2) AS stock_value_at_cost' : '';
    const { rows } = await db.query(
      `SELECT bs.branch_id, p.id AS product_id, p.sku, p.name AS product_name, bs.quantity${valueCol},
              MAX(s.sold_at) AS last_sold_at
         FROM branch_stock bs
         JOIN products p        ON p.id = bs.product_id AND p.is_active AND p.track_stock
         LEFT JOIN sale_items si ON si.product_id = bs.product_id
         LEFT JOIN sales s       ON s.id = si.sale_id AND s.branch_id = bs.branch_id AND s.status = 'completed'
        WHERE bs.quantity > 0 AND ($1::int IS NULL OR bs.branch_id = $1)
        GROUP BY bs.branch_id, p.id, p.sku, p.name, bs.quantity, bs.average_cost
       HAVING MAX(s.sold_at) IS NULL OR MAX(s.sold_at) < now() - make_interval(days => $2::int)
        ORDER BY MAX(s.sold_at) NULLS FIRST, bs.quantity DESC
        LIMIT $3`,
      [branchId || null, parseInt(days, 10) || 60, Math.min(parseInt(limit, 10) || 100, 500)],
      opts
    );
    return rows;
  }

  /** Items at or below their reorder level. */
  static async lowStock(branchId, opts = {}) {
    const cols = 'branch_id, branch_name, product_id, sku, product_name, category, unit, quantity, reorder_level';
    const { rows } = await db.query(
      `SELECT ${cols} FROM v_low_stock WHERE ($1::int IS NULL OR branch_id = $1) ORDER BY branch_id, product_name`,
      [branchId || null],
      opts
    );
    return rows;
  }

  /** What the stock on the shelves is worth. Needs includeCost for the cost value. */
  static async stockValue(branchId, opts = {}) {
    const costCol = opts.includeCost ? ', SUM(stock_value_at_cost) AS value_at_cost' : '';
    const { rows } = await db.query(
      `SELECT branch_id, branch_name, COUNT(*) FILTER (WHERE quantity > 0) AS products_in_stock,
              SUM(stock_value_at_selling) AS value_at_selling${costCol}
         FROM v_stock_levels
        WHERE is_active AND ($1::int IS NULL OR branch_id = $1)
        GROUP BY branch_id, branch_name ORDER BY branch_id`,
      [branchId || null],
      opts
    );
    return rows;
  }

  /** Who owes the shops money. f = { onlyOverdue } */
  static async debtors({ onlyOverdue = false } = {}, opts = {}) {
    const { rows } = await db.query(
      `SELECT customer_id, name, phone, customer_type, credit_limit, balance_due, oldest_due_date, open_sales
         FROM v_customer_balances
        WHERE balance_due > 0 ${onlyOverdue ? 'AND oldest_due_date < ' + db.TODAY : ''}
        ORDER BY balance_due DESC`,
      [],
      opts
    );
    return rows;
  }

  /** Each overdue credit sale with days late. */
  static async overdueSales(branchId, opts = {}) {
    const { rows } = await db.query(
      'SELECT * FROM v_overdue_sales WHERE ($1::int IS NULL OR branch_id = $1) ORDER BY days_overdue DESC',
      [branchId || null],
      opts
    );
    return rows;
  }

  /** What the shops owe suppliers. */
  static async creditors(opts = {}) {
    const { rows } = await db.query(
      'SELECT supplier_id, name, phone, balance_owed, oldest_due_date FROM v_supplier_balances WHERE balance_owed > 0 ORDER BY balance_owed DESC',
      [],
      opts
    );
    return rows;
  }

  /** Cash, M-Pesa, bank and card takings per shop per day. */
  static async paymentsByMethod({ branchId, from, to } = {}, opts = {}) {
    const { rows } = await db.query(
      `SELECT * FROM v_payments_daily
        WHERE ($1::int IS NULL OR branch_id = $1)
          AND pay_date BETWEEN COALESCE($2::date, ${db.TODAY} - 30) AND COALESCE($3::date, ${db.TODAY})
        ORDER BY pay_date DESC, branch_id, method`,
      [branchId || null, from || null, to || null],
      opts
    );
    return rows;
  }

  /** Profit and loss per shop per month: sales profit minus expenses. */
  static async monthlyProfit({ branchId, from, to } = {}, opts = {}) {
    const { rows } = await db.query(
      `SELECT * FROM v_monthly_profit
        WHERE ($1::int IS NULL OR branch_id = $1)
          AND month >= date_trunc('month', COALESCE($2::date, ${db.TODAY} - 365))::date
          AND month <= COALESCE($3::date, ${db.TODAY})
        ORDER BY month DESC, branch_id`,
      [branchId || null, from || null, to || null],
      opts
    );
    return hide(rows, opts);
  }

  /** Per cashier: sales, discounts given, returns and voided sales (for spotting problems). */
  static async cashierPerformance({ branchId, from, to } = {}, opts = {}) {
    const { rows } = await db.query(
      `SELECT u.id AS cashier_id, u.full_name AS cashier, s.branch_id,
              COUNT(*) FILTER (WHERE s.status = 'completed') AS sales_count,
              COALESCE(SUM(s.total - s.returned_total) FILTER (WHERE s.status = 'completed'), 0) AS net_sales,
              COALESCE(SUM(s.discount_total) FILTER (WHERE s.status = 'completed'), 0) AS discounts_given,
              COALESCE(SUM(s.returned_total) FILTER (WHERE s.status = 'completed'), 0) AS returns_value,
              COUNT(*) FILTER (WHERE s.status = 'voided') AS voided_sales
         FROM sales s JOIN users u ON u.id = s.cashier_id
        WHERE s.status IN ('completed', 'voided')
          AND ($1::int IS NULL OR s.branch_id = $1)
          AND ${db.dayOf('s.sold_at')} BETWEEN COALESCE($2::date, ${db.TODAY} - 30) AND COALESCE($3::date, ${db.TODAY})
        GROUP BY u.id, u.full_name, s.branch_id
        ORDER BY net_sales DESC`,
      [branchId || null, from || null, to || null],
      opts
    );
    return rows;
  }
}

module.exports = Report;
