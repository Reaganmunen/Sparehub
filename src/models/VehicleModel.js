'use strict';

const BaseModel = require('./BaseModel');

/** The bikes and tuk tuks a part can fit (Bajaj Boxer, TVS King...). */
class VehicleModel extends BaseModel {
  static table = 'vehicle_models';
  static fields = ['vehicle_type', 'make', 'model', 'year_from', 'year_to', 'engine_cc', 'notes'];
  static orderBy = 'vehicle_type, make, model';
}

module.exports = VehicleModel;
