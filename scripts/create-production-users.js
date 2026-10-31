'use strict';

/**
 * Creates the REAL shops and people who will log in to Spare Hub in production.
 * Run it on an empty database (after scripts/reset-db.js), BEFORE you move the data to Supabase / Neon.
 *
 *   1. copy scripts/production-users.example.json to scripts/production-users.json and fill in real details
 *   2. node scripts/create-production-users.js
 *
 * Rules it follows
 *   - Passwords are NOT stored in this script. Leave "password" out of a person and a strong random one is made.
 *     (Or set one yourself, minimum 8 characters.)
 *   - Every person gets must_change_password = true, so each one picks their own password at first login.
 *   - Generated passwords are printed ONCE and saved to scripts/production-credentials.txt. Hand them out,
 *     then delete that file. Never commit it.
 *   - An existing username is skipped and left untouched (a password is never overwritten by accident).
 *   - Shops are created if their code is missing; existing shops are left alone.
 *   - Everything happens in one transaction: if one person is invalid, nothing is saved.
 *
 *   node scripts/create-production-users.js path/to/other.json     use a different file
 *   node scripts/create-production-users.js --dry-run              check the file, change nothing
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../src/config/db');
const { User, Branch, Setting } = require('../src/models');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const fileArg = argv.find((a) => !a.startsWith('--'));
const CONFIG = path.resolve(fileArg || path.join(__dirname, 'production-users.json'));
const CREDENTIALS_FILE = path.join(__dirname, 'production-credentials.txt');

const ROLES = ['owner', 'manager', 'cashier'];

function generatePassword(length = 14) {
  // No look-alike characters (0/O, 1/l/I). Always contains lower, upper, digit and symbol.
  const sets = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '@#$%&*?'];
  const all = sets.join('');
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const out = sets.map(pick);
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** Labels of a Postgres enum used by table.column (null if the column is not an enum). */
async function enumLabels(client, table, column) {
  const { rows } = await client.query(
    `SELECT e.enumlabel FROM information_schema.columns c
       JOIN pg_type t ON t.typname = c.udt_name
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE c.table_name = $1 AND c.column_name = $2
      ORDER BY e.enumsortorder`,
    [table, column]
  );
  return rows.length ? rows.map((r) => r.enumlabel) : null;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG)) {
    console.error(`Cannot find ${CONFIG}\nCopy scripts/production-users.example.json to scripts/production-users.json and fill it in.`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (err) {
    console.error(`${CONFIG} is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const problems = [];
  const branches = cfg.branches || [];
  const users = cfg.users || [];
  const codes = new Set(branches.map((b) => String(b.code || '').toUpperCase()));
  const seen = new Set();

  if (!branches.length) problems.push('"branches" is empty');
  for (const b of branches) if (!b.code || !b.name) problems.push(`a shop needs both "code" and "name" (got ${JSON.stringify(b)})`);
  if (!users.some((u) => u.role === 'owner')) problems.push('there must be at least one user with role "owner"');

  for (const u of users) {
    const who = u.username || '(no username)';
    if (!u.username || !/^[a-z0-9._-]{3,}$/i.test(u.username)) problems.push(`${who}: username needs 3+ letters, digits, dot, dash or underscore`);
    if (seen.has(String(u.username).toLowerCase())) problems.push(`${who}: username appears twice`);
    seen.add(String(u.username).toLowerCase());
    if (!u.full_name) problems.push(`${who}: full_name is missing`);
    if (!ROLES.includes(u.role)) problems.push(`${who}: role must be one of ${ROLES.join(', ')}`);
    if (u.role !== 'owner' && !codes.has(String(u.branch || '').toUpperCase())) problems.push(`${who}: "branch" must be one of ${[...codes].join(', ')}`);
    if (u.password !== undefined && String(u.password).length < 8) problems.push(`${who}: password must be at least 8 characters`);
    if (/@sparehub\.test$/i.test(u.email || '')) problems.push(`${who}: that is a test email address`);
  }

  if (problems.length) {
    console.error('Fix these in your file first:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  return cfg;
}

async function main() {
  if (!process.env.DATABASE_URL && !process.env.DB_NAME) console.log('Note: no DATABASE_URL set, using the local defaults from src/config/db.js');
  const cfg = loadConfig();
  await db.query('SELECT 1');

  const { rows: who } = await db.query('SELECT current_database() AS db');
  console.log(`\nDatabase: ${who[0].db}${DRY ? '   (DRY RUN, nothing will be saved)' : ''}`);

  const issued = [];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const opts = { client };

    // ---- shops ----
    const shopTypes = await enumLabels(client, 'branches', 'shop_type');
    const branches = {};
    console.log('\nShops');
    for (const b of cfg.branches) {
      const code = String(b.code).toUpperCase();
      let row = await Branch.findByCode(code, opts);
      if (row) {
        console.log(`  = ${code} already exists (${row.name}), left as is`);
      } else {
        const data = {
          code,
          name: b.name,
          address: b.address,
          town: b.town,
          phone: b.phone,
          email: b.email,
          kra_pin: b.kra_pin,
          mpesa_till_number: b.mpesa_till_number,
          mpesa_business_shortcode: b.mpesa_business_shortcode,
          receipt_header: b.receipt_header,
          receipt_footer: b.receipt_footer,
        };
        if (shopTypes) {
          const re = b.shop_type ? new RegExp(String(b.shop_type), 'i') : null;
          const label = (re && shopTypes.find((l) => re.test(l))) || shopTypes.find((l) => (/tuk/i.test(b.name) ? /tuk/i : /boda|bike|motor/i).test(l)) || shopTypes[0];
          data.shop_type = label;
        }
        row = await Branch.create(data, opts);
        console.log(`  + ${code} created (${row.name})`);
      }
      branches[code] = row;
    }

    // ---- business name shown in the app ----
    if (cfg.business_name) {
      await Setting.set('business_name', cfg.business_name, opts);
      console.log(`\nBusiness name set to "${cfg.business_name}"`);
    }

    // ---- people ----
    console.log('\nUsers');
    for (const u of cfg.users) {
      if (await User.findByUsername(u.username, opts)) {
        console.log(`  = ${u.username} already exists, skipped (password untouched)`);
        continue;
      }
      const generated = u.password === undefined;
      const password = generated ? generatePassword() : String(u.password);
      const isOwner = u.role === 'owner';
      await User.create(
        {
          full_name: u.full_name,
          username: u.username,
          email: u.email || null,
          phone: u.phone || null,
          role: u.role,
          branch_id: isOwner ? null : branches[String(u.branch).toUpperCase()].id,
          can_override_min_price: u.can_override_min_price ?? isOwner,
          can_view_costs: u.can_view_costs ?? (isOwner || u.role === 'manager'),
          max_discount_percent: u.max_discount_percent ?? (isOwner ? 100 : u.role === 'manager' ? 15 : 0),
          is_active: true,
          must_change_password: u.must_change_password ?? true,
          password,
        },
        opts
      );
      issued.push({ username: u.username, role: u.role, shop: isOwner ? 'both' : String(u.branch).toUpperCase(), password, generated });
      console.log(`  + ${u.username} (${u.role}) created`);
    }

    if (DRY) {
      await client.query('ROLLBACK');
      console.log('\nDry run finished. Rolled back, nothing saved.');
      return;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (!issued.length) {
    console.log('\nNo new users were created.');
    return;
  }

  const lines = issued.map((i) => `${i.username.padEnd(20)} ${i.role.padEnd(8)} ${i.shop.padEnd(5)} ${i.password}${i.generated ? '' : '   (set in your file)'}`);
  const text =
    `Spare Hub production logins, created ${new Date().toISOString()}\n` +
    'Each person must choose a new password at first login. DELETE THIS FILE after handing these out.\n\n' +
    'username             role     shop  password\n' +
    lines.join('\n') +
    '\n';
  fs.writeFileSync(CREDENTIALS_FILE, text, { mode: 0o600 });

  console.log('\n' + text);
  console.log(`Saved to ${CREDENTIALS_FILE}. Hand them out, then delete that file.`);
  console.log('Next: move the schema + this data to Supabase / Neon (pg_dump, see the notes).');
}

main()
  .catch((err) => {
    console.error('\nFailed, nothing was saved:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
