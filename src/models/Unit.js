'use strict';

const BaseModel = require('./BaseModel');

/** Piece, Pair, Set, Litre... */
class Unit extends BaseModel {
  static table = 'units';
  static fields = ['name', 'abbreviation'];
  static orderBy = 'name';
}

module.exports = Unit;
