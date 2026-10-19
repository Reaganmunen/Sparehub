'use strict';

const router = require('express').Router();
const { purchase } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate, requireRole('owner', 'manager'));

router.get('/', purchase.list);
router.post('/', purchase.create);
router.get('/:id', purchase.get);
router.put('/:id', purchase.updateDraft);
router.post('/:id/receive', purchase.receive);
router.post('/:id/cancel', purchase.cancel);

module.exports = router;