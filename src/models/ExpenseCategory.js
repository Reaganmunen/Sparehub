'use strict';

const BaseModel = require('./BaseModel');

class ExpenseCategory extends BaseModel {
  static table = 'expense_categories';
  static fields = ['name', 'is_active'];
  static orderBy = 'name';
}

module.exports = ExpenseCategory;
