'use strict';

const AppError = require('../utils/AppError');
const { Branch } = require('../models');
const { handlers, need, id, pick, isOwner, audit } = require('../utils/controller');

module.exports = handlers({
  /** GET /branches  (owner: both shops; staff: their own) */
  list: async (req, res) => {
    const rows = await Branch.findAll({ is_active: true });
    res.json({ data: isOwner(req.user) ? rows : rows.filter((b) => b.id === req.user.branch_id) });
  },

  get: async (req, res) => {
    const branch = await Branch.findById(id(req.params.id));
    if (!branch) throw new AppError('Shop not found', 404);
    if (!isOwner(req.user) && branch.id !== req.user.branch_id) throw new AppError('That is the other shop', 403);
    res.json({ data: branch });
  },

  create: async (req, res) => {
    need(req, 'owner');
    const branch = await Branch.create(pick(req.body, Branch.fields));
    await audit(req, 'branch.create', 'branch', branch.id, { code: branch.code, name: branch.name });
    res.status(201).json({ data: branch });
  },

  /** PUT /branches/:id (owner): name, receipt header/footer, M-Pesa Till number and shortcode... */
  update: async (req, res) => {
    need(req, 'owner');
    const data = pick(req.body, Branch.fields);
    const branch = await Branch.update(id(req.params.id), data);
    if (!branch) throw new AppError('Shop not found', 404);
    await audit(req, 'branch.update', 'branch', branch.id, { changed: Object.keys(data), values: data }, branch.id);
    res.json({ data: branch });
  },
});
