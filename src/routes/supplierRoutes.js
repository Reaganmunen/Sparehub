'use strict';

const router = require('express').Router();
const { supplier } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate, requireRole('owner', 'manager'));

router.get('/', supplier.list);
router.post('/', supplier.create);
router.get('/:id/payments', supplier.payments);
router.post('/:id/payments', supplier.pay);
router.get('/:id', supplier.statement);
router.put('/:id', supplier.update);

module.exports = router;