'use strict';

/**
 * Empties EVERY table in the database (all rows gone, ID counters back to 1). Tables, columns,
 * enums, triggers and functions are left alone, so the schema is exactly as it was.
 *
 *   node scripts/reset-db.js                 asks you to type the database name to confirm
 *   node scripts/reset-db.js --yes           no question asked (use in your own scripts)
 *   node scripts/reset-db.js --include-settings   also empties app_settings (see note below)
 *   node scripts/reset-db.js --force-remote  needed when the database is not on this computer
 *
 * app_settings is KEPT by default. It is configuration, not business data, and the Settings page can
 * only change keys that already exist (settingController rejects unknown keys). If you empty it, the
 * Settings page stops working until the keys are inserted again.
 *
 * Refuses to run when NODE_ENV=production.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const readline = require('readline');
const db = require('../src/config/db');

const args = new Set(process.argv.slice(2));
const KEEP = new Set(['app_settings', 'schema_migrations', 'migrations', 'knex_migrations', 'pgmigrations', 'spatial_ref_sys']);
if (args.has('--include-settings')) KEEP.delete('app_settings');

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to wipe the database when NODE_ENV=production.');
    process.exit(1);
  }

  const { rows: who } = await db.query(
    "SELECT current_database() AS db, inet_server_addr()::text AS addr, current_user AS usr"
  );
  const { db: dbName, addr, usr } = who[0];
  const isLocal = !addr || ['127.0.0.1', '::1'].includes(addr.split('/')[0]);

  console.log(`\nTarget database: ${dbName}   (user: ${usr}, server: ${addr || 'local socket'})`);

  if (!isLocal && !args.has('--force-remote')) {
    console.error('This database is not on this computer (looks like Supabase/Neon). Use --force-remote if you really mean it.');
    process.exit(1);
  }

  const { rows: tables } = await db.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  const wipe = tables.map((t) => t.tablename).filter((t) => !KEEP.has(t));
  if (!wipe.length) {
    console.log('No tables found. Run your schema first.');
    return;
  }
  console.log(`\nWill empty ${wipe.length} tables:\n  ${wipe.join(', ')}`);
  console.log(`Will keep: ${[...KEEP].filter((k) => tables.some((t) => t.tablename === k)).join(', ') || '(nothing)'}`);

  if (!args.has('--yes')) {
    const typed = await ask(`\nThis deletes ALL the data. Type the database name (${dbName}) to continue: `);
    if (typed !== dbName) {
      console.log('Names did not match. Nothing was changed.');
      return;
    }
  }

  const list = wipe.map((t) => `"${t.replace(/"/g, '""')}"`).join(', ');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // CASCADE handles foreign keys between tables; RESTART IDENTITY puts serial / identity counters back to 1.
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

    // Sequences that belong to no column (for example a receipt-number counter) are not covered by RESTART IDENTITY.
    const { rows: loose } = await client.query(`
      SELECT quote_ident(s.schemaname) || '.' || quote_ident(s.sequencename) AS name
        FROM pg_sequences s
       WHERE s.schemaname = 'public'
         AND NOT EXISTS (
               SELECT 1 FROM pg_depend d
                 JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
                WHERE d.deptype IN ('a', 'i') AND c.relname = s.sequencename)`);
    for (const s of loose) await client.query(`ALTER SEQUENCE ${s.name} RESTART WITH 1`);
    if (loose.length) console.log(`Reset ${loose.length} stand-alone sequence(s): ${loose.map((s) => s.name).join(', ')}`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Prove it worked
  let leftover = 0;
  for (const t of wipe) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
    if (rows[0].n) {
      leftover += rows[0].n;
      console.log(`  ! ${t} still has ${rows[0].n} rows`);
    }
  }
  console.log(leftover ? '\nSomething is still there, see above.' : '\nDone. Every table is empty and counters start from 1 again.');
  console.log('Next: node scripts/create-production-users.js');
}

main()
  .catch((err) => {
    console.error('\nReset failed, nothing was changed:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
