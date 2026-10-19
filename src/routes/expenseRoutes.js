'use strict';

const router = require('express').Router();
const { expense } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const staff = requireRole('owner', 'manager');

router.use(authenticate);

router.post('/', expense.create); // cashier needs manager approval (handled in controller)
router.get('/totals', staff, expense.totals);
router.get('/', staff, expense.list);
router.get('/:id', staff, expense.get);

module.exports = router;