'use strict';

const router = require('express').Router();
const { product } = require('../controllers');
const { authenticate, requireRole, upload } = require('../middleware');

const owner = requireRole('owner');
const staff = requireRole('owner', 'manager');

router.use(authenticate);

// ---- cashier screen (fixed paths first) ----
router.get('/pos', product.posSearch);
router.get('/pos/all', product.posAll);
router.get('/pos/scan/:code', product.scan);

// ---- Excel / CSV import ----
router.get('/import/template', owner, product.importTemplate);
router.post('/import', owner, upload.spreadsheet, product.importFile);

// ---- catalogue ----
router.get('/', staff, product.list);
router.post('/', staff, product.create); // managers: controller forces their own shop
router.get('/:id/price-history', product.priceHistory); // controller checks "can view costs"
router.post('/:id/active', owner, product.setActive);
router.get('/:id', staff, product.get);
router.put('/:id', owner, product.update);

module.exports = router;