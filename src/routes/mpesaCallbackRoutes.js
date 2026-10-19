'use strict';

const router = require('express').Router();
const { mpesa } = require('../controllers');

/**
 * PUBLIC: Safaricom calls this, so there is no login and no rate limit.
 * The secret in the URL is the protection (MPESA_CALLBACK_SECRET).
 * mainRoutes mounts this BEFORE the rate limiter.
 */
router.post('/:secret', mpesa.callback);

module.exports = router;