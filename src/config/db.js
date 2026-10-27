'use strict';

const { Pool, types } = require('pg');
const AppError = require('../utils/AppError');

// ---------------------------------------------------------------------------------
// Type parsing: PostgreSQL NUMERIC and BIGINT arrive as strings by default.
// Turn them into JavaScript numbers; keep DATE columns as plain 'YYYY-MM-DD' text.
// ---------------------------------------------------------------------------------
types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC
types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT (COUNT, SUM of ints)
types.setTypeParser(1082, (v) => v); // DATE

// ---------------------------------------------------------------------------------
// Connection pool. Set these in your .env file:
//   DATABASE_URL=postgres://user:password@localhost:5432/spareparts_pos
// or the separate values below.
// ---------------------------------------------------------------------------------
// On Vercel every function instance opens its own pool, so keep it small (Neon's pooler handles the rest).
const onVercel = Boolean(process.env.VERCEL);
const poolSettings = {
  max: Number(process.env.DB_POOL_MAX) || (onVercel ? 3 : 10),
  idleTimeoutMillis: 10000, // give connections back quickly when the function goes quiet
  connectionTimeoutMillis: 10000, // fail with an error instead of hanging if the database cannot be reached
};

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        ...poolSettings,
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined, // sslmode=require in the URL also works
      }
    : {
        ...poolSettings,
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5433,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'spareparts_pos',
      }
);

pool.on('error', (err) => console.error('Unexpected PostgreSQL pool error:', err.message));

/**
 * Run one query. `opts.client` (optional) is a client that is already inside a transaction.
 * Every model method takes a last argument `opts = { client, userId, ... }`.
 */
function query(text, params = [], opts = {}) {
  const executor = (opts && opts.client) || pool;
  return executor.query(text, params);
}

/**
 * BEGIN ... COMMIT around `fn(client)`. Also tells the database WHO is making the change
 * (the schema's triggers use it to record who changed a price).
 */
async function withTransaction(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Use the caller's transaction if there is one, otherwise open a new one. */
function inTransaction(opts, fn) {
  if (opts && opts.client) return fn(opts.client);
  return withTransaction(opts && opts.userId, fn);
}

// ---------------------------------------------------------------------------------
// Small SQL helpers. Column names always come from a fixed whitelist in the models,
// values always go through $1, $2 placeholders, so there is no SQL injection risk.
// ---------------------------------------------------------------------------------
function buildInsert(data, allowed) {
  const columns = [];
  const values = [];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      columns.push(key);
      values.push(data[key]);
    }
  }
  if (!columns.length) throw new AppError('No data supplied');
  return {
    columns: columns.join(', '),
    placeholders: columns.map((_, i) => `$${i + 1}`).join(', '),
    values,
  };
}

function buildUpdate(data, allowed, startAt = 1) {
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      values.push(data[key]);
      sets.push(`${key} = $${startAt + values.length - 1}`);
    }
  }
  if (!sets.length) throw new AppError('Nothing to update');
  return { sets: sets.join(', '), values };
}

/** Builds WHERE clauses step by step:  w.add('branch_id = ?', 3).add('is_active = TRUE') */
class Where {
  constructor() {
    this.parts = [];
    this.values = [];
  }

  // add('x = ?', value)  -> every ? becomes the same $n.   add('is_active = TRUE') -> no value.
  add(sql, ...value) {
    if (value.length) {
      this.values.push(value[0]);
      this.parts.push(sql.replace(/\?/g, `$${this.values.length}`));
    } else {
      this.parts.push(sql);
    }
    return this;
  }

  // Every typed word must appear in at least one of the columns (case-insensitive).
  search(columns, q) {
    const words = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    for (const word of words) {
      this.values.push(like(word));
      const i = this.values.length;
      this.parts.push('(' + columns.map((c) => `${c} ILIKE $${i}`).join(' OR ') + ')');
    }
    return this;
  }

  sql() {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }
}

const like = (q) => `%${String(q).replace(/[\\%_]/g, '\\$&')}%`;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** The calendar date of a timestamp in Nairobi time, e.g. dayOf('s.sold_at') */
const dayOf = (column) => `(${column} AT TIME ZONE 'Africa/Nairobi')::date`;
const TODAY = "(now() AT TIME ZONE 'Africa/Nairobi')::date";

function paging(f = {}, defaultLimit = 25) {
  const limit = Math.min(Math.max(parseInt(f.limit, 10) || defaultLimit, 1), 200);
  const page = Math.max(parseInt(f.page, 10) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

/** Rows selected with `COUNT(*) OVER() AS total_count` -> { data, total, page, limit } */
function toPage(rows, p) {
  const total = rows.length ? rows[0].total_count : 0;
  return {
    data: rows.map(({ total_count, ...rest }) => rest),
    total,
    page: p.page,
    limit: p.limit,
  };
}

/** Removes fields (like cost prices) from rows the current user is not allowed to see. */
function omit(rows, fields) {
  const strip = (r) => {
    const copy = { ...r };
    for (const f of fields) delete copy[f];
    return copy;
  };
  return Array.isArray(rows) ? rows.map(strip) : strip(rows);
}

module.exports = {
  pool,
  query,
  withTransaction,
  inTransaction,
  buildInsert,
  buildUpdate,
  Where,
  like,
  round2,
  dayOf,
  TODAY,
  paging,
  toPage,
  omit,
};
