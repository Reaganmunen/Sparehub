'use strict';

const AppError = require('../utils/AppError');

/** 404 for any URL no route answered. Mount after all routes. */
function notFound(req, res, next) {
  next(new AppError(`Not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
}

// "Key (sku)=(BB-0001) already exists." -> "sku"
const columnFromDetail = (detail) => {
  const m = /Key \(([^)]+)\)=/.exec(detail || '');
  return m ? m[1].replace(/"/g, '') : null;
};
const label = (col) => String(col || 'value').replace(/_/g, ' ');

/**
 * Turns anything thrown into { status, message, code }.
 * AppError messages were written for people, so they pass through. Database errors are translated into plain
 * language (never the raw SQL message); anything unknown becomes a generic 500 and is logged in full.
 */
function translate(err) {
  if (err instanceof AppError) return { status: err.status, message: err.message, code: err.code };

  // ---- request / library errors ----
  if (err.type === 'entity.parse.failed') return { status: 400, message: 'The request body is not valid JSON', code: 'BAD_JSON' };
  if (err.type === 'entity.too.large') return { status: 413, message: 'The request is too large', code: 'TOO_LARGE' };
  if (err.name === 'MulterError') {
    return err.code === 'LIMIT_FILE_SIZE'
      ? { status: 413, message: 'That file is too big (the limit is 5 MB)', code: 'FILE_TOO_LARGE' }
      : { status: 400, message: 'The file upload failed. Send one file in the "file" field.', code: 'UPLOAD_FAILED' };
  }
  if (err.name === 'TokenExpiredError') return { status: 401, message: 'Your session has expired. Please log in again.', code: 'TOKEN_EXPIRED' };
  if (err.name === 'JsonWebTokenError') return { status: 401, message: 'Please log in again', code: 'BAD_TOKEN' };

  // ---- PostgreSQL ----
  switch (err.code) {
    case '23505': {
      const col = columnFromDetail(err.detail);
      if (/receipt|reference|mpesa/i.test(`${err.constraint} ${col}`)) {
        return { status: 409, message: 'That M-Pesa code or reference has already been used', code: 'DUPLICATE' };
      }
      return { status: 409, message: `Another record already has that ${label(col)}`, code: 'DUPLICATE' };
    }
    case '23503':
      return /is still referenced/i.test(err.detail || '')
        ? { status: 409, message: 'This cannot be removed because other records depend on it. Switch it off instead.', code: 'IN_USE' }
        : { status: 400, message: 'One of the items you chose does not exist', code: 'BAD_REFERENCE' };
    case '23502':
      return { status: 400, message: `${label(err.column)} is required`, code: 'REQUIRED' };
    case '23514':
      if (err.constraint === 'chk_min_price_rule') {
        return { status: 403, message: 'That price is below the minimum. A manager must approve it.', code: 'BELOW_MIN_PRICE' };
      }
      return { status: 400, message: 'One of the values is not allowed (for example a negative quantity or price)', code: 'INVALID_VALUE' };
    case '22P02': case '22003': case '22007': case '22008': case '22001': case '22023':
      return { status: 400, message: 'One of the values has the wrong format or is too large', code: 'INVALID_FORMAT' };
    case '42501': case 'P0001':
      // raised on purpose by our own triggers / functions, so the message is meant to be read
      return { status: err.code === '42501' ? 403 : 409, message: err.message, code: err.code === '42501' ? 'NOT_ALLOWED' : 'RULE_BROKEN' };
    case '40001': case '40P01':
      return { status: 503, message: 'The system was busy. Please try again.', code: 'RETRY' };
    case '57014':
      return { status: 503, message: 'That took too long. Try a smaller date range.', code: 'TIMEOUT' };
    default:
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '53300'].includes(err.code)) {
    return { status: 503, message: 'The database is not reachable right now. Please try again shortly.', code: 'DB_DOWN' };
  }
  return { status: 500, message: 'Something went wrong on our side. Please try again.', code: 'SERVER_ERROR' };
}

/** Mount LAST:  app.use(notFound); app.use(errorHandler); */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const out = translate(err);

  if (out.status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} user=${req.user ? req.user.id : '-'}`, err);
  }
  const body = { error: { message: out.message, code: out.code || null } };
  if (process.env.NODE_ENV !== 'production' && out.status >= 400 && !(err instanceof AppError)) {
    body.error.debug = { name: err.name, code: err.code, constraint: err.constraint, detail: err.detail, message: err.message };
  }
  res.status(out.status).json(body);
}

module.exports = { notFound, errorHandler };
