'use strict';

module.exports = {
  ...require('./auth'),
  ...require('./errorHandler'),
  ...require('./rateLimit'),
  upload: require('./upload'),
};
