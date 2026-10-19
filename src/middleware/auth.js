'use strict';

const AppError = require('../utils/AppError');
const { User } = require('../models');
const { verifyToken } = require('../controllers/authController');

/**
 * Reads "Authorization: Bearer <token>", checks it, loads the person fresh from the database and sets req.user.
 * Loading them on every request (instead of trusting the token) means switching someone off, changing their role
 * or their permissions takes effect immediately, not when their token expires.
 *
 * allowPendingPasswordChange: a person whose password was just reset (must_change_password) may do NOTHING
 * except change it. Only the /auth/me and /auth/change-password routes use the "allowing" version.
 */
function makeAuth(allowPendingPasswordChange) {
  return async function authenticate(req, res, next) {
    try {
      const [scheme, token] = (req.get('authorization') || '').split(' ');
      if (!/^bearer$/i.test(scheme || '') || !token) throw new AppError('Please log in', 401, 'NO_TOKEN');

      let payload;
      try {
        payload = verifyToken(token);
      } catch (err) {
        if (err.name === 'TokenExpiredError') throw new AppError('Your session has expired. Please log in again.', 401, 'TOKEN_EXPIRED');
        throw new AppError('Please log in again', 401, 'BAD_TOKEN');
      }

      const user = await User.findById(payload.sub);
      if (!user) throw new AppError('Please log in again', 401, 'BAD_TOKEN');
      if (!user.is_active) throw new AppError('This account is switched off. Ask the owner.', 403, 'INACTIVE');
      if (user.must_change_password && !allowPendingPasswordChange) {
        throw new AppError('You must choose a new password before you continue', 403, 'PASSWORD_CHANGE_REQUIRED');
      }

      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

const authenticate = makeAuth(false);
const authenticateAllowingPasswordChange = makeAuth(true);

/** Route-level role gate:  router.get('/x', authenticate, requireRole('owner', 'manager'), handler). Controllers re-check too. */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new AppError('You are not allowed to do this', 403, 'FORBIDDEN'));
  next();
};

module.exports = { authenticate, authenticateAllowingPasswordChange, requireRole };
