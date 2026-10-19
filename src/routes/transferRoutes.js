'use strict';

const router = require('express').Router();
const { transfer } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const staff = requireRole('owner', 'manager');

router.use(authenticate);

router.post('/', staff, transfer.create);
router.get('/', staff, transfer.list);
router.post('/:id/dispatch', staff, transfer.dispatch);
router.post('/:id/receive', staff, transfer.receive);
router.post('/:id/cancel', staff, transfer.cancel);
router.get('/:id', transfer.get);

module.exports = router;