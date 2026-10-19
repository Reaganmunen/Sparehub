'use strict';

const AppError = require('../utils/AppError');
const { User, AuditLog } = require('../models');
const { handlers, need, id, pick, bool, isOwner, scopeBranch, audit } = require('../utils/controller');

const FIELDS = [
  'branch_id', 'full_name', 'username', 'email', 'phone', 'role', 'can_override_min_price',
  'can_view_costs', 'max_discount_percent', 'is_active', 'must_change_password',
];

module.exports = handlers({
  /** GET /users  ?branch_id &role &is_active &q   (owner: everyone; manager: people in their shop) */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    const rows = await User.list({ branchId: scopeBranch(req, q.branch_id), role: q.role, isActive: bool(q.is_active), q: q.q });
    res.json({ data: rows });
  },

  get: async (req, res) => {
    need(req, 'owner', 'manager');
    const user = await User.findById(id(req.params.id));
    if (!user) throw new AppError('User not found', 404);
    if (!isOwner(req.user) && user.branch_id !== req.user.branch_id) throw new AppError('That person works in the other shop', 403);
    res.json({ data: user });
  },

  /** POST /users  (owner only)  { full_name, username, password, role, branch_id, can_override_min_price, can_view_costs, max_discount_percent, ... } */
  create: async (req, res) => {
    need(req, 'owner');
    const data = { must_change_password: true, ...pick(req.body, [...FIELDS, 'password']) };
    const user = await User.create(data);
    await audit(req, 'user.create', 'user', user.id, { username: user.username, role: user.role, branch_id: user.branch_id });
    res.status(201).json({ data: user });
  },

  /** PUT /users/:id (owner only). Passwords are changed with resetPassword, not here. */
  update: async (req, res) => {
    need(req, 'owner');
    const userId = id(req.params.id);
    const data = pick(req.body, FIELDS);
    if (userId === req.user.id && (data.is_active === false || (data.role && data.role !== 'owner'))) {
      throw new AppError('You cannot switch off or demote your own account', 409);
    }
    const user = await User.update(userId, data);
    if (!user) throw new AppError('User not found', 404);
    await audit(req, 'user.update', 'user', userId, { changed: Object.keys(data), values: data });
    res.json({ data: user });
  },

  /** POST /users/:id/reset-password  (owner only)  { new_password }  -> they must choose their own at next login */
  resetPassword: async (req, res) => {
    need(req, 'owner');
    const userId = id(req.params.id);
    const ok = await User.setPassword(userId, (req.body || {}).new_password, { mustChange: true });
    if (!ok) throw new AppError('User not found', 404);
    await audit(req, 'user.password_reset', 'user', userId);
    res.json({ data: { reset: true } });
  },
});
