'use strict';

const router = require('express').Router();
const { user } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const owner = requireRole('owner');
const staff = requireRole('owner', 'manager');

router.use(authenticate);

router.get('/', staff, user.list);
router.post('/', owner, user.create);
router.get('/:id', staff, user.get);
router.put('/:id', owner, user.update);
router.post('/:id/reset-password', owner, user.resetPassword);

module.exports = router;