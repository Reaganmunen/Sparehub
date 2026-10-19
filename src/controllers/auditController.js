'use strict';

const { AuditLog } = require('../models');
const { handlers, need, scopeBranch } = require('../utils/controller');

module.exports = handlers({
  /** GET /audit  ?user_id &branch_id &action (e.g. sale.void, product.update, stock.adjust) &entity_type &entity_id &from &to &page &limit */
  list: async (req, res) => {
    need(req, 'owner', 'manager');
    const q = req.query;
    res.json(await AuditLog.list({
      userId: q.user_id, branchId: scopeBranch(req, q.branch_id), action: q.action, entityType: q.entity_type,
      entityId: q.entity_id, from: q.from, to: q.to, page: q.page, limit: q.limit,
    }));
  },
});
