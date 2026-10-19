'use strict';

const router = require('express').Router();
const { mpesa } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

router.use(authenticate);

router.post('/stk-push', mpesa.stkPush);
router.get('/review', requireRole('owner', 'manager'), mpesa.needingReview);
router.get('/sales/:saleId', mpesa.status);

module.exports = router;