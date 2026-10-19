'use strict';

const router = require('express').Router();
const { stock } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const owner = requireRole('owner');
const staff = requireRole('owner', 'manager');

router.use(authenticate);

// ---- fixed paths first ----
router.get('/', stock.levels);
router.get('/low', stock.lowStock);
router.get('/movements', staff, stock.movements);
router.post('/adjust', staff, stock.adjust); // controller makes opening_stock owner-only

// ---- per shop + product ----
router.post('/:branchId/products/:productId', owner, stock.listProduct);
router.get('/:branchId/:productId', stock.one);
router.put('/:branchId/:productId', staff, stock.updateSettings);

module.exports = router;