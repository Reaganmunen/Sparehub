'use strict';

// .env must load BEFORE anything that reads process.env (config/db.js does at require time)
require('dotenv').config();

const app = require('./src/app');
const db = require('./src/config/db');
const mpesa = require('./src/controllers/mpesaController');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing in .env - the server cannot start.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 5000;

async function start() {
  try {
    await db.query('SELECT 1'); // fail early if the database is unreachable
    console.log('Database connected');
  } catch (err) {
    console.error('Could not connect to the database:', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, () => console.log(`Spare Hub API running on port ${PORT}`));

  // Marks M-Pesa prompts nobody answered as timed out (every minute)
  mpesa.startExpiryJob(3);

  // ---- clean shutdown (Ctrl+C, Render redeploys) ----
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      try {
        await db.pool.end();
      } catch (err) {
        console.error('Error closing the database pool:', err.message);
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref(); // force-exit if something hangs
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

start();