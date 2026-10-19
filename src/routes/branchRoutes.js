'use strict';

const router = require('express').Router();
const { branch } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const owner = requireRole('owner');

router.use(authenticate);

router.get('/', branch.list);
router.post('/', owner, branch.create);
router.get('/:id', branch.get);
router.put('/:id', owner, branch.update);

module.exports = router;