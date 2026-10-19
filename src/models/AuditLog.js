'use strict';

const db = require('../config/db');

/** Who did what: logins, voided sales, price changes, permission changes... */
class AuditLog {
  /**
   * Never throws: a logging problem must not stop a sale. Failures are printed to the console.
   * log({ user_id, branch_id, action: 'sale.void', entity_type: 'sale', entity_id: 12, details: {...}, ip_address, user_agent })
   */
  static async log(entry, opts = {}) {
    try {
      await db.query(
        `INSERT INTO audit_logs (user_id, branch_id, action, entity_type, entity_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::inet, $8)`,
        [
          entry.user_id || null,
          entry.branch_id || null,
          entry.action,
          entry.entity_type || null,
          entry.entity_id || null,
          entry.details ? JSON.stringify(entry.details) : null,
          entry.ip_address || null,
          entry.user_agent || null,
        ],
        opts
      );
    } catch (err) {
      console.error('Audit log failed:', err.message);
    }
  }

  static async list(f = {}, opts = {}) {
    const w = new db.Where();
    if (f.userId) w.add('a.user_id = ?', f.userId);
    if (f.branchId) w.add('a.branch_id = ?', f.branchId);
    if (f.action) w.add('a.action ILIKE ?', db.like(f.action));
    if (f.entityType) w.add('a.entity_type = ?', f.entityType);
    if (f.entityId) w.add('a.entity_id = ?', f.entityId);
    if (f.from) w.add(`${db.dayOf('a.created_at')} >= ?::date`, f.from);
    if (f.to) w.add(`${db.dayOf('a.created_at')} <= ?::date`, f.to);
    const p = db.paging(f, 50);
    const i = w.values.length;
    const { rows } = await db.query(
      `SELECT a.id, a.user_id, u.full_name AS user_name, a.branch_id, a.action, a.entity_type, a.entity_id,
              a.details, a.ip_address, a.created_at, COUNT(*) OVER() AS total_count
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${w.sql()}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $${i + 1} OFFSET $${i + 2}`,
      [...w.values, p.limit, p.offset],
      opts
    );
    return db.toPage(rows, p);
  }
}

module.exports = AuditLog;
