'use strict';

const router = require('express').Router();
const { auth } = require('../controllers');
const { authenticateAllowingPasswordChange, loginLimiter } = require('../middleware');

router.post('/login', loginLimiter, auth.login);
router.get('/me', authenticateAllowingPasswordChange, auth.me);
router.post('/change-password', authenticateAllowingPasswordChange, auth.changePassword);

module.exports = router;