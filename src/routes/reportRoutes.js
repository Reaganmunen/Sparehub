'use strict';

const router = require('express').Router();
const { report } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate, requireRole('owner', 'manager'));

// /dashboard must come before /:name
router.get('/dashboard', report.dashboard);
router.get('/:name/export', report.export);
router.get('/:name', report.run);

module.exports = router;