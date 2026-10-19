'use strict';

const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const { User, AuditLog } = require('../models');
const { handlers, audit } = require('../utils/controller');

/** .env: JWT_SECRET=<long random string>   JWT_EXPIRES_IN=12h (optional). The token carries only { sub: userId }. */
function secret() {
  if (!process.env.JWT_SECRET) throw new AppError('The server is not configured (JWT_SECRET is missing)', 500);
  return process.env.JWT_SECRET;
}
const signToken = (user) => jwt.sign({ sub: user.id }, secret(), { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
const verifyToken = (token) => jwt.verify(token, secret());

const clientInfo = (req) => ({ ip_address: req.ip, user_agent: req.get('user-agent') });

module.exports = {
  signToken,
  verifyToken,
  ...handlers({
    /** POST /auth/login  { username, password } */
    login: async (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) throw new AppError('Enter your username and password');

      const user = await User.findByUsername(String(username).trim());
      if (!user) throw new AppError('Wrong username or password', 401);
      if (!user.is_active) throw new AppError('This account is switched off. Ask the owner.', 403, 'INACTIVE');
      if (User.isLocked(user)) {
        const mins = Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 60000));
        throw new AppError(`Too many wrong attempts. Try again in ${mins} minute(s).`, 423, 'LOCKED');
      }

      if (!(await User.verifyPassword(user, password))) {
        await User.recordLoginFailure(user.id);
        await AuditLog.log({ user_id: user.id, branch_id: user.branch_id, action: 'auth.login_failed', entity_type: 'user', entity_id: user.id, ...clientInfo(req) });
        throw new AppError('Wrong username or password', 401);
      }

      await User.recordLoginSuccess(user.id);
      await AuditLog.log({ user_id: user.id, branch_id: user.branch_id, action: 'auth.login', entity_type: 'user', entity_id: user.id, ...clientInfo(req) });
      res.json({ token: signToken(user), user: await User.findById(user.id) });
    },

    /** GET /auth/me */
    me: async (req, res) => {
      res.json({ data: req.user });
    },

    /** POST /auth/change-password  { current_password, new_password } */
    changePassword: async (req, res) => {
      const { current_password, new_password } = req.body || {};
      if (!current_password || !new_password) throw new AppError('Enter your current and your new password');
      if (current_password === new_password) throw new AppError('The new password must be different from the old one');

      const full = await User.findByUsername(req.user.username);
      if (!(await User.verifyPassword(full, current_password))) throw new AppError('Your current password is wrong', 403);

      await User.setPassword(req.user.id, new_password, { mustChange: false });
      await audit(req, 'auth.password_changed', 'user', req.user.id);
      res.json({ data: { changed: true } });
    },
  }),
};
