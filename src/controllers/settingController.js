'use strict';

const AppError = require('../utils/AppError');
const { Setting } = require('../models');
const { handlers, need, audit } = require('../utils/controller');

// Settings every logged-in screen may read (the POS needs these)
const PUBLIC_KEYS = ['business_name', 'vat_enabled', 'allow_negative_stock', 'require_open_shift'];

module.exports = handlers({
  /** GET /settings (owner): everything */
  list: async (req, res) => {
    need(req, 'owner');
    res.json({ data: await Setting.all() });
  },

  /** GET /settings/public (any logged-in user) */
  publicList: async (req, res) => {
    const all = await Setting.all();
    res.json({ data: Object.fromEntries(all.filter((s) => PUBLIC_KEYS.includes(s.key)).map((s) => [s.key, s.value])) });
  },

  /** PUT /settings (owner)  { settings: { vat_enabled: true, lockout_minutes: 15 } }  Only existing keys can be changed. */
  update: async (req, res) => {
    need(req, 'owner');
    const incoming = (req.body && req.body.settings) || {};
    const known = new Set((await Setting.all()).map((s) => s.key));
    const entries = Object.entries(incoming);
    if (!entries.length) throw new AppError('No settings supplied');
    for (const [key] of entries) if (!known.has(key)) throw new AppError(`Unknown setting "${key}"`);

    for (const [key, value] of entries) await Setting.set(key, value);
    await audit(req, 'settings.update', 'settings', null, { changes: incoming });
    res.json({ data: await Setting.all() });
  },
});
