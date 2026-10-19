'use strict';

// One place to import every model:   const { Sale, Product } = require('../models');
module.exports = {
  AuditLog: require('./AuditLog'),
  Branch: require('./Branch'),
  Brand: require('./Brand'),
  Category: require('./Category'),
  Customer: require('./Customer'),
  Expense: require('./Expense'),
  ExpenseCategory: require('./ExpenseCategory'),
  MpesaTransaction: require('./MpesaTransaction'),
  Payment: require('./Payment'),
  Product: require('./Product'),
  Purchase: require('./Purchase'),
  Report: require('./Report'),
  Sale: require('./Sale'),
  SaleReturn: require('./SaleReturn'),
  Setting: require('./Setting'),
  Shift: require('./Shift'),
  Stock: require('./Stock'),
  StockTransfer: require('./StockTransfer'),
  Stocktake: require('./Stocktake'),
  Supplier: require('./Supplier'),
  SupplierPayment: require('./SupplierPayment'),
  Unit: require('./Unit'),
  User: require('./User'),
  VehicleModel: require('./VehicleModel'),
};
