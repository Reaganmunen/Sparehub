'use strict';

const router = require('express').Router();
const { payment } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const staff = requireRole('owner', 'manager');

router.use(authenticate);

router.get('/', staff, payment.list);
router.post('/settle-debt', payment.settleDebt);
router.post('/:id/void', staff, payment.void);

module.exports = router;