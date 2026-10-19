'use strict';

/**
 * An error the user can safely be shown. The error-handling middleware (written later)
 * sends err.message back with err.status as the HTTP status code.
 */
class AppError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

module.exports = AppError;
