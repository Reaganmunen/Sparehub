'use strict';

/**
 * Seeds test logins and sample data for Spare Hub.
 *
 *   node scripts/seed.js                 add / refresh the test data (safe to run again)
 *   SEED_PASSWORD='Other@123' node scripts/seed.js   use a different password for every test login
 *
 * What it does
 *   - makes sure the two shops exist (BB = Boda Boda, TT = Tuk Tuk)
 *   - creates an owner, a manager and cashiers for each shop (plus a switched-off and a "must change password" account)
 *   - creates categories, brands, units, bikes / tuk tuks, products (with fitments, opening stock, a per-shop price),
 *     customers (including credit limits) and suppliers
 *
 * Re-running is safe: people are matched by username, products by SKU, everything else by name.
 * Re-running resets every test login's password, unlocks it, and restores its role / shop / active flag.
 * Opening stock is only added when a product is first created, so stock never doubles up.
 * It refuses to run when NODE_ENV=production.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../src/config/db');
const { User, Branch, Brand, Category, Unit, VehicleModel, Product, Stock, Customer, Supplier } = require('../src/models');

const PASSWORD = process.env.SEED_PASSWORD || 'Test@1234';

// ------------------------------------------------------------------------------------------------
// Test people. branch: 'BB' | 'TT' | null (owner sees both shops)
// ------------------------------------------------------------------------------------------------
const USERS = [
  { username: 'owner', full_name: 'Fred (Owner)', role: 'owner', branch: null, can_override_min_price: true, can_view_costs: true, max_discount_percent: 100, phone: '0700000001', note: 'Both shops, all settings, sees costs and profit' },

  { username: 'bb.manager', full_name: 'Brian Otieno', role: 'manager', branch: 'BB', can_override_min_price: true, can_view_costs: true, max_discount_percent: 15, phone: '0700000011', note: 'Boda Boda manager' },
  { username: 'bb.cashier1', full_name: 'Amina Hassan', role: 'cashier', branch: 'BB', can_override_min_price: false, can_view_costs: false, max_discount_percent: 5, phone: '0700000012', note: 'Boda Boda cashier, cannot sell below minimum price' },
  { username: 'bb.cashier2', full_name: 'Kevin Mwangi', role: 'cashier', branch: 'BB', can_override_min_price: true, can_view_costs: false, max_discount_percent: 10, phone: '0700000013', note: 'Boda Boda cashier WITH below-minimum permission' },

  { username: 'tt.manager', full_name: 'Salim Juma', role: 'manager', branch: 'TT', can_override_min_price: true, can_view_costs: true, max_discount_percent: 15, phone: '0700000021', note: 'Tuk Tuk manager' },
  { username: 'tt.cashier1', full_name: 'Grace Wanjiru', role: 'cashier', branch: 'TT', can_override_min_price: false, can_view_costs: false, max_discount_percent: 5, phone: '0700000022', note: 'Tuk Tuk cashier, cannot sell below minimum price' },
  { username: 'tt.cashier2', full_name: 'Peter Omondi', role: 'cashier', branch: 'TT', can_override_min_price: false, can_view_costs: true, max_discount_percent: 0, phone: '0700000023', note: 'Tuk Tuk cashier, no discounts, CAN see costs' },

  { username: 'bb.inactive', full_name: 'Old Cashier (switched off)', role: 'cashier', branch: 'BB', is_active: false, max_discount_percent: 0, phone: '0700000091', note: 'Login must be REFUSED (account switched off)' },
  { username: 'tt.newstaff', full_name: 'New Staff (reset password)', role: 'cashier', branch: 'TT', must_change_password: true, max_discount_percent: 0, phone: '0700000092', note: 'Must choose a new password at first login' },
];

// ------------------------------------------------------------------------------------------------
// Lookups
// ------------------------------------------------------------------------------------------------
const UNITS = [['Piece', 'pc'], ['Pair', 'pr'], ['Set', 'set'], ['Litre', 'ltr'], ['Metre', 'm']];
const CATEGORIES = ['Engine', 'Brakes', 'Clutch & Transmission', 'Electrical', 'Suspension', 'Body & Mirrors', 'Filters', 'Lubricants', 'Tyres & Wheels', 'Cables & Chains'];
const BRANDS = ['Bajaj', 'TVS', 'Honda', 'Yamaha', 'Bosch', 'NGK', 'Castrol', 'Motul', 'Hero', 'Generic', 'Local'];

// key -> [type 'bike' | 'tuk', make, model, engine_cc]
const VEHICLES = {
  boxer: ['bike', 'Bajaj', 'Boxer BM150', 150],
  boxerx: ['bike', 'Bajaj', 'Boxer X150', 150],
  pulsar: ['bike', 'Bajaj', 'Pulsar 180', 180],
  tvshlx: ['bike', 'TVS', 'HLX 125', 125],
  tvsstar: ['bike', 'TVS', 'Star City 110', 110],
  cb125: ['bike', 'Honda', 'CB 125', 125],
  ybr: ['bike', 'Yamaha', 'YBR 125', 125],
  herohf: ['bike', 'Hero', 'HF Deluxe', 100],
  re4s: ['tuk', 'Bajaj', 'RE 4-Stroke', 200],
  maxima: ['tuk', 'Bajaj', 'Maxima Cargo', 236],
  tvsking: ['tuk', 'TVS', 'King Duramax', 200],
  piaggio: ['tuk', 'Piaggio', 'Ape City', 200],
};

// ------------------------------------------------------------------------------------------------
// Products: sku, name, part_number, category, brand, buy, sell, min, wholesale, reorder, fits[], stock {BB, TT}
// Stock levels deliberately include low-stock and out-of-stock items so alerts can be tested.
// ------------------------------------------------------------------------------------------------
const P = (sku, name, part_number, category, brand, buy, sell, min, wholesale, reorder, fits, stock, unit = 'pc') =>
  ({ sku, name, part_number, category, brand, buy, sell, min, wholesale, reorder, fits, stock, unit });

const PRODUCTS = [
  // ---- boda boda parts (stocked at BB) ----
  P('BB-BRK-001', 'Brake Pad Set - Front (Boxer)', 'BJ-BP-150F', 'Brakes', 'Bajaj', 350, 600, 520, 520, 10, ['boxer', 'boxerx'], { BB: 40 }, 'set'),
  P('BB-BRK-002', 'Brake Shoe Set - Rear', 'BJ-BS-150R', 'Brakes', 'Generic', 280, 450, 400, 400, 10, ['boxer', 'tvshlx', 'herohf'], { BB: 6 }, 'set'),
  P('BB-BRK-003', 'Brake Lever - Right', 'HN-BL-125R', 'Brakes', 'Honda', 180, 350, 300, 300, 5, ['cb125', 'ybr'], { BB: 0 }),
  P('BB-ENG-001', 'Piston Kit STD (Boxer 150)', 'BJ-PK-150', 'Engine', 'Bajaj', 1400, 2200, 1900, 2000, 5, ['boxer', 'boxerx'], { BB: 12 }, 'set'),
  P('BB-ENG-002', 'Piston Rings Set STD', 'BJ-PR-150', 'Engine', 'Generic', 450, 800, 700, 720, 8, ['boxer', 'boxerx', 'pulsar'], { BB: 25 }, 'set'),
  P('BB-ENG-003', 'Cylinder Head Gasket', 'TV-GK-125', 'Engine', 'TVS', 120, 250, 200, 210, 10, ['tvshlx', 'tvsstar'], { BB: 3 }),
  P('BB-CLT-001', 'Clutch Plate Set (Pulsar 180)', 'BJ-CP-180', 'Clutch & Transmission', 'Bajaj', 900, 1500, 1300, 1350, 5, ['pulsar'], { BB: 9 }, 'set'),
  P('BB-CLT-002', 'Chain & Sprocket Kit', 'GN-CS-125', 'Cables & Chains', 'Generic', 1100, 1800, 1600, 1650, 6, ['cb125', 'ybr', 'tvshlx', 'herohf'], { BB: 14 }, 'set'),
  P('BB-CLT-003', 'Clutch Cable', 'GN-CC-150', 'Cables & Chains', 'Local', 90, 200, 150, 160, 15, ['boxer', 'boxerx', 'pulsar'], { BB: 30 }),
  P('BB-ELC-001', 'Headlight Bulb 12V 35/35W', 'GN-HB-12', 'Electrical', 'Generic', 40, 120, 90, 100, 20, ['boxer', 'boxerx', 'pulsar', 'tvshlx', 'cb125', 'ybr'], { BB: 60 }),
  P('BB-ELC-002', 'CDI Unit (Boxer)', 'BJ-CDI-150', 'Electrical', 'Bajaj', 650, 1100, 950, 1000, 4, ['boxer'], { BB: 2 }),
  P('BB-SUS-001', 'Front Shock Absorber (pair)', 'GN-FS-125', 'Suspension', 'Generic', 1500, 2400, 2100, 2200, 3, ['cb125', 'ybr', 'tvshlx'], { BB: 7 }, 'pr'),
  P('BB-BOD-001', 'Side Mirror (pair)', 'GN-SM-UNI', 'Body & Mirrors', 'Local', 150, 350, 280, 300, 10, ['boxer', 'boxerx', 'pulsar', 'tvshlx', 'cb125', 'ybr', 'herohf'], { BB: 35 }, 'pr'),
  P('BB-TYR-001', 'Tyre 2.75-17 Tubeless', 'GN-TY-275', 'Tyres & Wheels', 'Local', 1300, 2000, 1800, 1850, 6, ['boxer', 'boxerx', 'tvshlx', 'herohf'], { BB: 11 }),

  // ---- tuk tuk parts (stocked at TT) ----
  P('TT-BRK-001', 'Brake Shoe Set (Tuk Tuk)', 'BJ-BS-RE', 'Brakes', 'Bajaj', 420, 700, 620, 640, 10, ['re4s', 'maxima'], { TT: 28 }, 'set'),
  P('TT-BRK-002', 'Brake Drum - Front', 'BJ-BD-RE', 'Brakes', 'Bajaj', 1100, 1800, 1600, 1650, 3, ['re4s'], { TT: 2 }),
  P('TT-CLT-001', 'Clutch Plate Set (Tuk Tuk)', 'BJ-CP-RE', 'Clutch & Transmission', 'Bajaj', 1200, 2000, 1750, 1800, 5, ['re4s', 'maxima', 'tvsking'], { TT: 10 }, 'set'),
  P('TT-CLT-002', 'Clutch Cable (Tuk Tuk)', 'GN-CC-RE', 'Cables & Chains', 'Local', 110, 250, 200, 210, 10, ['re4s', 'maxima', 'tvsking', 'piaggio'], { TT: 22 }),
  P('TT-CLT-003', 'Accelerator Cable', 'GN-AC-RE', 'Cables & Chains', 'Local', 100, 220, 180, 190, 10, ['re4s', 'tvsking'], { TT: 1 }),
  P('TT-ENG-001', 'Piston Kit STD (RE 200)', 'BJ-PK-RE', 'Engine', 'Bajaj', 2200, 3400, 3000, 3100, 4, ['re4s'], { TT: 6 }, 'set'),
  P('TT-ENG-002', 'Carburettor Assembly', 'BJ-CB-RE', 'Engine', 'Bajaj', 2800, 4200, 3800, 3900, 3, ['re4s', 'maxima'], { TT: 5 }),
  P('TT-ENG-003', 'Engine Mounting Rubber', 'GN-EM-RE', 'Engine', 'Generic', 180, 400, 320, 340, 8, ['re4s', 'maxima', 'tvsking'], { TT: 0 }),
  P('TT-ELC-001', 'Headlight Assembly (Tuk Tuk)', 'GN-HL-RE', 'Electrical', 'Generic', 650, 1200, 1000, 1050, 4, ['re4s', 'maxima', 'tvsking', 'piaggio'], { TT: 8 }),
  P('TT-ELC-002', 'Starter Motor', 'BJ-SM-RE', 'Electrical', 'Bosch', 3500, 5500, 4900, 5000, 2, ['re4s'], { TT: 3 }),
  P('TT-SUS-001', 'Rear Shock Absorber', 'GN-RS-RE', 'Suspension', 'Generic', 1100, 1900, 1650, 1700, 4, ['re4s', 'maxima', 'tvsking'], { TT: 12 }),
  P('TT-BOD-001', 'Rear View Mirror (Tuk Tuk)', 'GN-RM-RE', 'Body & Mirrors', 'Local', 200, 450, 350, 380, 6, ['re4s', 'maxima', 'tvsking', 'piaggio'], { TT: 18 }),
  P('TT-TYR-001', 'Tyre 4.00-8 (Tuk Tuk)', 'GN-TY-400', 'Tyres & Wheels', 'Local', 1700, 2600, 2300, 2400, 6, ['re4s', 'maxima', 'tvsking'], { TT: 14 }),

  // ---- sold in BOTH shops ----
  P('ALL-LUB-001', 'Engine Oil 20W-50 (1 Litre)', 'CS-20W50-1L', 'Lubricants', 'Castrol', 520, 750, 700, 700, 20, [], { BB: 48, TT: 36 }, 'ltr'),
  P('ALL-LUB-002', 'Gear Oil 80W-90 (500ml)', 'MT-8090-500', 'Lubricants', 'Motul', 260, 450, 400, 410, 12, [], { BB: 4, TT: 15 }),
  P('ALL-ELC-001', 'Spark Plug (NGK)', 'NGK-C7HSA', 'Electrical', 'NGK', 90, 200, 160, 170, 25, ['boxer', 'boxerx', 'pulsar', 'tvshlx', 'cb125', 'ybr', 're4s', 'maxima'], { BB: 80, TT: 55 }),
  P('ALL-FLT-001', 'Air Filter Element', 'GN-AF-UNI', 'Filters', 'Generic', 120, 300, 250, 260, 15, ['boxer', 'boxerx', 'pulsar', 're4s', 'maxima', 'tvsking'], { BB: 20, TT: 7 }),
  P('ALL-ELC-002', 'Battery 12V 5Ah', 'GN-BT-5AH', 'Electrical', 'Generic', 1400, 2200, 1950, 2000, 4, ['boxer', 'tvshlx', 'cb125', 're4s'], { BB: 5, TT: 0 }),
];

// A price that differs in one shop only (shows the per-shop price override)
const BRANCH_PRICE_OVERRIDES = [{ sku: 'ALL-LUB-001', branch: 'TT', selling_price: 780, min_selling_price: 720 }];

const CUSTOMERS = [
  { name: 'Juma Mechanic', phone: '0711000001', credit_limit: 20000, notes: 'Regular mechanic, credit allowed' },
  { name: 'Mombasa Boda Riders Sacco', phone: '0711000002', credit_limit: 50000, notes: 'Group account, monthly settlement' },
  { name: 'Hassan Tuk Tuk Garage', phone: '0711000003', credit_limit: 35000, notes: 'Wholesale buyer' },
  { name: 'Mary Wambui', phone: '0711000004', credit_limit: 0, notes: 'Cash only: credit sale must be refused' },
  { name: 'Ali Fundi', phone: '0711000005', credit_limit: 5000, notes: 'Small credit limit: easy to hit the limit' },
];

const SUPPLIERS = [
  { name: 'Bajaj Spares Mombasa Distributor', contact_person: 'Mr. Shah', phone: '0722000001', payment_terms_days: 30, address: 'Kilindini Road, Mombasa' },
  { name: 'Nairobi Auto Parts Wholesalers', contact_person: 'Ms. Kamau', phone: '0722000002', payment_terms_days: 14, address: 'Ngara, Nairobi' },
  { name: 'Coastal Lubricants Ltd', contact_person: 'Hamisi', phone: '0722000003', payment_terms_days: 7, address: 'Changamwe, Mombasa' },
];

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------
const log = (msg) => console.log(msg);

/** Labels of a Postgres enum used by table.column (null if the column is not an enum). */
async function enumLabels(table, column) {
  const { rows } = await db.query(
    `SELECT e.enumlabel FROM information_schema.columns c
       JOIN pg_type t ON t.typname = c.udt_name
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE c.table_name = $1 AND c.column_name = $2
      ORDER BY e.enumsortorder`,
    [table, column]
  );
  return rows.length ? rows.map((r) => r.enumlabel) : null;
}

/** Picks the enum label that matches `re`, otherwise the first one. */
const pickLabel = (labels, re) => (labels && (labels.find((l) => re.test(l)) || labels[0])) || null;

async function findOrCreateByName(Model, name, extra = {}) {
  const existing = (await Model.findAll()).find((r) => String(r.name).toLowerCase() === name.toLowerCase());
  return existing || Model.create({ name, ...extra });
}

// ------------------------------------------------------------------------------------------------
// Steps
// ------------------------------------------------------------------------------------------------
async function seedBranches() {
  const shopTypes = await enumLabels('branches', 'shop_type');
  const defs = [
    { code: 'BB', name: 'Boda Boda Spares', shopRe: /boda|bike|motor/i, town: 'Mombasa', phone: '0700000100', mpesa_till_number: '5000001' },
    { code: 'TT', name: 'Tuk Tuk Spares', shopRe: /tuk/i, town: 'Mombasa', phone: '0700000200', mpesa_till_number: '5000002' },
  ];
  const out = {};
  for (const d of defs) {
    let b = await Branch.findByCode(d.code);
    if (!b) {
      const data = { code: d.code, name: d.name, town: d.town, phone: d.phone, mpesa_till_number: d.mpesa_till_number };
      if (shopTypes) data.shop_type = pickLabel(shopTypes, d.shopRe);
      b = await Branch.create(data);
      log(`  + shop ${d.code} created (${d.name})`);
    } else {
      log(`  = shop ${d.code} already there (${b.name})`);
    }
    out[d.code] = b;
  }
  return out;
}

async function seedUsers(branches) {
  const ids = {};
  for (const u of USERS) {
    const data = {
      full_name: u.full_name,
      username: u.username,
      email: `${u.username.replace(/\./g, '_')}@sparehub.test`,
      phone: u.phone,
      role: u.role,
      branch_id: u.branch ? branches[u.branch].id : null,
      can_override_min_price: Boolean(u.can_override_min_price),
      can_view_costs: Boolean(u.can_view_costs),
      max_discount_percent: u.max_discount_percent ?? 0,
      is_active: u.is_active !== false,
      must_change_password: Boolean(u.must_change_password),
    };
    const existing = await User.findByUsername(u.username);
    let row;
    if (existing) {
      row = await User.update(existing.id, data);
      await User.setPassword(existing.id, PASSWORD, { mustChange: data.must_change_password });
      log(`  ~ ${u.username} refreshed`);
    } else {
      row = await User.create({ ...data, password: PASSWORD });
      log(`  + ${u.username} created`);
    }
    ids[u.username] = row.id;
  }
  return ids;
}

async function seedLookups() {
  for (const [name, abbreviation] of UNITS) {
    const exists = (await Unit.findAll()).some((u) => u.abbreviation === abbreviation || u.name.toLowerCase() === name.toLowerCase());
    if (!exists) await Unit.create({ name, abbreviation });
  }
  const categories = {};
  for (const n of CATEGORIES) categories[n] = (await findOrCreateByName(Category, n)).id;
  const brands = {};
  for (const n of BRANDS) brands[n] = (await findOrCreateByName(Brand, n)).id;

  const vehicleTypes = await enumLabels('vehicle_models', 'vehicle_type');
  const typeFor = (t) => (vehicleTypes ? pickLabel(vehicleTypes, t === 'tuk' ? /tuk/i : /bike|boda|motor/i) : t === 'tuk' ? 'tuk_tuk' : 'boda_boda');
  const existing = await VehicleModel.findAll();
  const vehicles = {};
  for (const [key, [type, make, model, cc]] of Object.entries(VEHICLES)) {
    const found = existing.find((v) => v.make === make && v.model === model);
    vehicles[key] = (found || (await VehicleModel.create({ vehicle_type: typeFor(type), make, model, engine_cc: cc }))).id;
  }
  const units = {};
  for (const u of await Unit.findAll()) units[u.abbreviation] = u.id;
  log(`  ${CATEGORIES.length} categories, ${BRANDS.length} brands, ${Object.keys(VEHICLES).length} vehicle models, ${UNITS.length} units ready`);
  return { categories, brands, vehicles, units };
}

async function seedProducts(branches, userIds, lookups) {
  let created = 0;
  let skipped = 0;
  for (const p of PRODUCTS) {
    const { rows } = await db.query('SELECT id FROM products WHERE sku = $1', [p.sku]);
    if (rows.length) {
      skipped++;
      continue;
    }
    const shops = Object.keys(p.stock);
    await Product.create(
      {
        sku: p.sku,
        name: p.name,
        part_number: p.part_number,
        barcode: `600${String(PRODUCTS.indexOf(p) + 1).padStart(9, '0')}`,
        category_id: lookups.categories[p.category],
        brand_id: lookups.brands[p.brand],
        unit_id: lookups.units[p.unit],
        buying_price: p.buy,
        selling_price: p.sell,
        min_selling_price: p.min,
        wholesale_price: p.wholesale,
        default_reorder_level: p.reorder,
        fitments: p.fits.map((k) => lookups.vehicles[k]),
        branch_ids: shops.map((s) => branches[s].id),
        opening_stock: shops.map((s) => ({ branch_id: branches[s].id, quantity: p.stock[s], unit_cost: p.buy })),
      },
      { userId: userIds.owner }
    );
    created++;
  }
  log(`  + ${created} products created, ${skipped} already existed`);

  for (const o of BRANCH_PRICE_OVERRIDES) {
    const { rows } = await db.query('SELECT id FROM products WHERE sku = $1', [o.sku]);
    if (rows.length) await Stock.updateSettings(branches[o.branch].id, rows[0].id, { selling_price: o.selling_price, min_selling_price: o.min_selling_price });
  }
  if (BRANCH_PRICE_OVERRIDES.length) log(`  ~ ${BRANCH_PRICE_OVERRIDES.length} shop-specific price set`);
}

async function seedCustomers() {
  let n = 0;
  for (const c of CUSTOMERS) {
    if (await Customer.findByPhone(c.phone)) continue;
    await Customer.create(c);
    n++;
  }
  log(`  + ${n} customers created`);
}

async function seedSuppliers() {
  const existing = await Supplier.findAll();
  let n = 0;
  for (const s of SUPPLIERS) {
    if (existing.some((e) => e.name === s.name)) continue;
    await Supplier.create(s);
    n++;
  }
  log(`  + ${n} suppliers created`);
}

function printLogins() {
  const rows = USERS.map((u) => ({
    Username: u.username,
    Password: PASSWORD,
    Role: u.role,
    Shop: u.branch || 'both',
    Expect: u.note,
  }));
  console.log('\nTEST LOGINS');
  console.table(rows);
}

// ------------------------------------------------------------------------------------------------
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed test data when NODE_ENV=production.');
    process.exit(1);
  }
  if (PASSWORD.length < 8) {
    console.error('SEED_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }
  await db.query('SELECT 1');
  log('Seeding Spare Hub test data...');

  log('\nShops');
  const branches = await seedBranches();
  log('\nUsers');
  const userIds = await seedUsers(branches);
  log('\nLookups');
  const lookups = await seedLookups();
  log('\nProducts and stock');
  await seedProducts(branches, userIds, lookups);
  log('\nCustomers');
  await seedCustomers();
  log('\nSuppliers');
  await seedSuppliers();

  printLogins();
  log('Done.');
}

main()
  .catch((err) => {
    console.error('\nSeeding failed:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());