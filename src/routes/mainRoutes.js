'use strict';

const router = require('express').Router();
const { apiLimiter } = require('../middleware');

/**
 * Every endpoint in the system hangs off this one router. app.js mounts it at /api.
 *
 *   /api/auth ........ login, me, change-password
 *   /api/mpesa/callback/:secret  (public, NOT rate limited)
 *   everything below is behind the general rate limiter, and (inside each file) behind login
 */

// 1. Safaricom must always get through: mounted BEFORE the rate limiter.
router.use('/mpesa/callback', require('./mpesaCallbackRoutes'));

// 2. General safety net for the rest of the API.
router.use(apiLimiter);

// 3. Everything else.
router.use('/auth', require('./authRoutes'));
router.use('/users', require('./userRoutes'));
router.use('/branches', require('./branchRoutes'));
router.use('/settings', require('./settingRoutes'));

// brands, categories, units, vehicle-models, expense-categories
router.use('/', require('./lookupRoutes'));

router.use('/products', require('./productRoutes'));
router.use('/stock', require('./stockRoutes'));
router.use('/customers', require('./customerRoutes'));
router.use('/suppliers', require('./supplierRoutes'));
router.use('/supplier-payments', require('./supplierPaymentRoutes'));
router.use('/purchases', require('./purchaseRoutes'));
router.use('/sales', require('./saleRoutes'));
router.use('/mpesa', require('./mpesaRoutes'));
router.use('/returns', require('./returnRoutes'));
router.use('/payments', require('./paymentRoutes'));
router.use('/expenses', require('./expenseRoutes'));
router.use('/shifts', require('./shiftRoutes'));
router.use('/transfers', require('./transferRoutes'));
router.use('/stocktakes', require('./stocktakeRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/audit', require('./auditRoutes'));

module.exports = router;