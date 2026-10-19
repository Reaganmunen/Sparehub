'use strict';

/**
 * Shared helpers for every controller.
 *
 * ASSUMES the authentication middleware (written next) has set:
 *   req.user = the row from User.findById(payload.sub)   -> { id, branch_id, role, can_view_costs, ... }
 */

const AppError = require('./AppError');
const { AuditLog, User, Shift, Setting } = require('../models');

// ---- async plumbing ---------------------------------------------------------------------------
const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
/** handlers({ list: async (req,res)=>{}, ... }) -> same object, every function forwards errors to next() */
const handlers = (obj) => Object.fromEntries(Object.entries(obj).map(([k, fn]) => [k, wrap(fn)]));

// ---- who is this? -----------------------------------------------------------------------------
const isOwner = (u) => u.role === 'owner';
const isManager = (u) => u.role === 'owner' || u.role === 'manager';
/** Buying prices, profit and floor prices: the owner always, anyone else only if the owner switched it on. */
const canSeeCosts = (u) => u.role === 'owner' || Boolean(u.can_view_costs);

function need(req, ...roles) {
  if (!roles.includes(req.user.role)) throw new AppError('You are not allowed to do this', 403, 'FORBIDDEN');
}

// ---- small input helpers ----------------------------------------------------------------------
function id(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new AppError(`Invalid ${label}`);
  return n;
}
const pick = (obj = {}, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
};
const bool = (v) => (v === undefined || v === '' ? undefined : v === true || v === 'true' || v === '1');
function dateOrUndefined(v, label) {
  if (v === undefined || v === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new AppError(`${label} must look like 2026-10-31`);
  return String(v);
}

// ---- shop scoping: staff only ever touch their own shop ---------------------------------------
/** For lists: staff -> their own shop. Owner -> the shop asked for, or null (= both shops). */
function scopeBranch(req, requested) {
  if (!isOwner(req.user)) return req.user.branch_id;
  return requested ? id(requested, 'branch_id') : null;
}
/** For creating things: staff -> their own shop. Owner must say which shop. */
function branchRequired(req, requested) {
  if (!isOwner(req.user)) return req.user.branch_id;
  if (!requested) throw new AppError('Choose a shop (branch_id)');
  return id(requested, 'branch_id');
}
/** For one record: it must belong to the user's shop (owner: any). */
function assertBranch(req, branchId) {
  if (!isOwner(req.user) && Number(branchId) !== Number(req.user.branch_id)) {
    throw new AppError('That record belongs to the other shop', 403, 'OTHER_BRANCH');
  }
}

/** Options passed to every model call: who is acting, and whether they may see costs. */
const ctx = (req, extra = {}) => ({ userId: req.user.id, includeCost: canSeeCosts(req.user), ...extra });

// ---- audit log --------------------------------------------------------------------------------
function audit(req, action, entityType, entityId, details, branchId) {
  return AuditLog.log({
    user_id: req.user.id,
    branch_id: branchId || req.user.branch_id || null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    ip_address: req.ip,
    user_agent: req.get('user-agent'),
  });
}

// ---- manager approval -------------------------------------------------------------------------
/**
 * A manager (or the owner) types their username and password on the cashier's screen to approve
 * something: a price below the minimum, a big discount, a void, a return...
 * creds = { username, password }
 */
async function verifyApprover(creds, branchId) {
  if (!creds || !creds.username || !creds.password) {
    throw new AppError('A manager must approve this. Ask them to enter their username and password.', 403, 'APPROVAL_REQUIRED');
  }
  const fail = () => new AppError('Approval failed. Check the username and password.', 403, 'APPROVAL_FAILED');
  const u = await User.findByUsername(String(creds.username).trim());
  if (!u || !u.is_active || User.isLocked(u)) throw fail();
  if (!(await User.verifyPassword(u, creds.password))) {
    await User.recordLoginFailure(u.id);
    throw fail();
  }
  const ok = u.role === 'owner' || (u.role === 'manager' && (!branchId || Number(u.branch_id) === Number(branchId)));
  if (!ok) throw new AppError('Only a manager of this shop or the owner can approve this', 403, 'APPROVAL_FAILED');
  return u;
}

/** Managers and the owner approve their own actions; a cashier needs a manager's credentials (req.body.approval). */
async function approvedBy(req, branchId) {
  if (isManager(req.user)) return req.user;
  return verifyApprover(req.body && req.body.approval, branchId);
}

// ---- shifts -----------------------------------------------------------------------------------
/** Cashiers must have an open shift in this shop before taking money (the owner can switch this off in settings). */
async function requireOpenShift(req, branchId) {
  if (req.user.role !== 'cashier') return null;
  if (!(await Setting.getBool('require_open_shift', true))) return null;
  const shift = await Shift.findOpenForCashier(req.user.id);
  if (!shift || Number(shift.branch_id) !== Number(branchId)) {
    throw new AppError('Open your shift before selling or taking money', 409, 'NO_OPEN_SHIFT');
  }
  return shift;
}

module.exports = {
  handlers, isOwner, isManager, canSeeCosts, need, id, pick, bool, dateOrUndefined,
  scopeBranch, branchRequired, assertBranch, ctx, audit, verifyApprover, approvedBy, requireOpenShift,
};
