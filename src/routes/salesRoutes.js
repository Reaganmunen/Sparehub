'use strict';

const router = require('express').Router();
const { sale, payment } = require('../controllers');
const { authenticate } = require('../middleware');

router.use(authenticate);

// ---- fixed paths first ----
router.post('/checkout', sale.checkout);
router.post('/hold', sale.hold);
router.get('/held', sale.listHeld);
router.get('/', sale.list);

// ---- one sale ----
router.get('/:id/receipt', sale.receipt);
router.get('/:saleId/payments', payment.listBySale);
router.post('/:id/payments', sale.addPayment);
router.post('/:id/complete', sale.complete);
router.post('/:id/void', sale.void);
router.get('/:id', sale.get);
router.put('/:id', sale.updateHeld);
router.delete('/:id', sale.discardHeld);

module.exports = router;