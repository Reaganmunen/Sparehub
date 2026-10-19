'use strict';

const router = require('express').Router();
const { stocktake } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate, requireRole('owner', 'manager'));

router.post('/', stocktake.start);
router.get('/', stocktake.list);
router.put('/:id/counts', stocktake.setCounts);
router.post('/:id/complete', stocktake.complete);
router.post('/:id/cancel', stocktake.cancel);
router.get('/:id', stocktake.get);

module.exports = router;