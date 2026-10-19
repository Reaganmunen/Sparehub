'use strict';

const router = require('express').Router();
const { customer } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const staff = requireRole('owner', 'manager');

router.use(authenticate);

router.get('/', customer.list);
router.post('/', customer.create); // cashiers may add a regular (controller strips credit_limit)
router.get('/:id/balance', customer.balance);
router.get('/:id', staff, customer.statement);
router.put('/:id', staff, customer.update);

module.exports = router;