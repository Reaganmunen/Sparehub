'use strict';

const router = require('express').Router();
const { shift } = require('../controllers');
const { authenticate } = require('../middleware');

router.use(authenticate);

router.post('/open', shift.open);
router.get('/current', shift.current);
router.get('/', shift.list);
router.post('/:id/close', shift.close);
router.get('/:id', shift.get);

module.exports = router;