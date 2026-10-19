'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const mainRoutes = require('./routes/mainRoutes');
const { notFound, errorHandler } = require('./middleware');

const app = express();

// Behind Render / a proxy: makes req.ip (rate limits, audit log) the real client address.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP off so the plain HTML frontend can use inline scripts / CDN files
app.use(
  cors({
    // CORS_ORIGIN=https://shop.example.com,http://localhost:5500   (leave empty to allow any origin)
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// All API endpoints
app.use('/api', mainRoutes);

// Frontend files (HTML/CSS/JS) from /public, if the folder exists
app.use(express.static(path.join(__dirname, '..', 'public')));

// Must be last
app.use(notFound);
app.use(errorHandler);

module.exports = app;