'use strict';

const router = require('express').Router();
const { setting } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const owner = requireRole('owner');

router.use(authenticate);

// keep /public above anything with a parameter
router.get('/public', setting.publicList);
router.get('/', owner, setting.list);
router.put('/', owner, setting.update);

module.exports = router;