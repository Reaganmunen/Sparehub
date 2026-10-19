'use strict';

const router = require('express').Router();
const { salesReturn } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const staff = requireRole('owner', 'manager');

router.use(authenticate);

router.post('/', salesReturn.create); // cashier needs manager approval (handled in controller)
router.get('/', staff, salesReturn.list);
router.get('/:id', salesReturn.get);

module.exports = router;