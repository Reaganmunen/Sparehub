'use strict';

const BaseModel = require('./BaseModel');

class Brand extends BaseModel {
  static table = 'brands';
  static fields = ['name', 'is_active'];
  static orderBy = 'name';
}

module.exports = Brand;
