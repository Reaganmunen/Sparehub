'use strict';

const router = require('express').Router();
const { supplier } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate, requireRole('owner'));

router.post('/:id/void', supplier.voidPayment);

module.exports = router;