'use strict';

// Vercel entry point: Vercel runs this file as a serverless function and hands every /api/* request to the Express app.
// (server.js is still used for running locally with `npm start`.)
require('dotenv').config();
module.exports = require('../src/app');
