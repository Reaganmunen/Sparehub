'use strict';

const express = require('express');
const { brand, category, unit, vehicleModel, expenseCategory } = require('../controllers');
const { authenticate, requireRole } = require('../middleware');

const staff = requireRole('owner', 'manager');

/** Brands, categories, units, vehicle models and expense categories all share the same four endpoints. */
function crudRouter(controller) {
  const r = express.Router();
  r.use(authenticate);
  r.get('/', controller.list);
  r.post('/', staff, controller.create);
  r.get('/:id', controller.get);
  r.put('/:id', staff, controller.update);
  return r;
}

const router = express.Router();

router.use('/brands', crudRouter(brand));
router.use('/categories', crudRouter(category));
router.use('/units', crudRouter(unit));
router.use('/vehicle-models', crudRouter(vehicleModel));
router.use('/expense-categories', crudRouter(expenseCategory));

module.exports = router;