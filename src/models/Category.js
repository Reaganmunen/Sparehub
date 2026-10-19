'use strict';

const BaseModel = require('./BaseModel');

class Category extends BaseModel {
  static table = 'categories';
  static fields = ['parent_id', 'name', 'is_active'];
  static orderBy = 'name';
}

module.exports = Category;
