'use strict';

// One place to import every controller:   const { sale, product } = require('./controllers');
const lookups = require('./lookupControllers');

module.exports = {
  auth: require('./authController'),
  user: require('./userController'),
  branch: require('./branchController'),
  setting: require('./settingController'),
  brand: lookups.brand,
  category: lookups.category,
  unit: lookups.unit,
  vehicleModel: lookups.vehicleModel,
  expenseCategory: lookups.expenseCategory,
  product: require('./productController'),
  stock: require('./stockController'),
  customer: require('./customerController'),
  supplier: require('./supplierController'),
  purchase: require('./purchaseController'),
  sale: require('./saleController'),
  mpesa: require('./mpesaController'),
  salesReturn: require('./returnController'),
  payment: require('./paymentController'),
  expense: require('./expenseController'),
  shift: require('./shiftController'),
  transfer: require('./transferController'),
  stocktake: require('./stocktakeController'),
  report: require('./reportController'),
  audit: require('./auditController'),
};
