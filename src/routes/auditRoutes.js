'use strict';

const router = require('express').Router();
const { audit } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate, requireRole('owner', 'manager'));

router.get('/', audit.list);

module.exports = router;