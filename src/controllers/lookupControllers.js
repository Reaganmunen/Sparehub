'use strict';

const AppError = require('../utils/AppError');
const { Brand, Category, Unit, VehicleModel, ExpenseCategory } = require('../models');
const { handlers, need, id, pick } = require('../utils/controller');

/**
 * Brands, categories, units, vehicle models and expense categories are all the same shape:
 * anyone logged in can read them, managers and the owner can add and change them.
 */
function crud(Model) {
  return handlers({
    list: async (req, res) => {
      const filters = { ...req.query };
      if (Model.fields.includes('is_active') && filters.is_active === undefined) filters.is_active = true;
      res.json({ data: await Model.findAll(filters) });
    },
    get: async (req, res) => {
      const row = await Model.findById(id(req.params.id));
      if (!row) throw new AppError('Not found', 404);
      res.json({ data: row });
    },
    create: async (req, res) => {
      need(req, 'owner', 'manager');
      res.status(201).json({ data: await Model.create(pick(req.body, Model.fields)) });
    },
    update: async (req, res) => {
      need(req, 'owner', 'manager');
      const row = await Model.update(id(req.params.id), pick(req.body, Model.fields));
      if (!row) throw new AppError('Not found', 404);
      res.json({ data: row });
    },
  });
}

module.exports = {
  brand: crud(Brand),
  category: crud(Category),
  unit: crud(Unit),
  vehicleModel: crud(VehicleModel),
  expenseCategory: crud(ExpenseCategory),
};
