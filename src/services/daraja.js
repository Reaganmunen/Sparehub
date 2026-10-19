'use strict';

/**
 * Safaricom Daraja: M-Pesa Express (STK push) to a Till (Buy Goods).
 *
 * .env:
 *   DARAJA_ENV=sandbox | production
 *   DARAJA_CONSUMER_KEY=...        DARAJA_CONSUMER_SECRET=...
 *   DARAJA_PASSKEY=...             (the Lipa na M-Pesa Online passkey Safaricom gives you for the Till)
 *   DARAJA_SHORTCODE=174379        (fallback; the branch's mpesa_business_shortcode is used first)
 *   APP_PUBLIC_URL=https://pos.yourdomain.co.ke   (must be public HTTPS so Safaricom can reach the callback)
 *   MPESA_CALLBACK_SECRET=<long random string>    (becomes part of the callback URL)
 *
 * The callback route you mount MUST be:  POST /api/mpesa/callback/:secret
 * Needs Node 18+ (built-in fetch).
 */

const AppError = require('../utils/AppError');

const isProd = () => process.env.DARAJA_ENV === 'production';
const baseUrl = () => (isProd() ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

let cached = { token: null, expiresAt: 0 };

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  if (!key || !secret) throw new AppError('M-Pesa is not set up on the server yet', 500, 'MPESA_CONFIG');

  let res;
  try {
    res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new AppError('Could not reach M-Pesa. Check the internet and try again.', 504, 'MPESA_UNREACHABLE');
  }
  if (!res.ok) throw new AppError('M-Pesa refused our login. Check the Daraja keys.', 502, 'MPESA_AUTH');
  const json = await res.json();
  cached = { token: json.access_token, expiresAt: Date.now() + (Number(json.expires_in || 3599) - 60) * 1000 };
  return cached.token;
}

/** 20261019094500 in Nairobi time (UTC+3, no daylight saving) */
function timestamp() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
}

function callbackUrl() {
  const base = process.env.APP_PUBLIC_URL;
  const secret = process.env.MPESA_CALLBACK_SECRET;
  if (!base || !secret) throw new AppError('M-Pesa callback is not configured (APP_PUBLIC_URL, MPESA_CALLBACK_SECRET)', 500, 'MPESA_CONFIG');
  return `${base.replace(/\/$/, '')}/api/mpesa/callback/${secret}`;
}

/**
 * Sends the PIN prompt to the customer's phone.
 * branch = the branches row (mpesa_till_number, mpesa_business_shortcode); phone = 2547XXXXXXXX; amount = whole KES.
 * Returns Daraja's response ({ MerchantRequestID, CheckoutRequestID, CustomerMessage, ... }).
 */
async function stkPush({ branch, phone, amount, accountReference, description }) {
  const shortcode = branch.mpesa_business_shortcode || process.env.DARAJA_SHORTCODE;
  const till = branch.mpesa_till_number;
  const passkey = process.env.DARAJA_PASSKEY;
  if (!shortcode || !passkey || (isProd() && !till)) {
    throw new AppError(`M-Pesa is not set up for ${branch.name}. The owner must add its Till details.`, 409, 'MPESA_CONFIG');
  }

  const token = await getToken();
  const ts = timestamp();
  const body = {
    BusinessShortCode: shortcode,
    Password: Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64'),
    Timestamp: ts,
    // The sandbox only understands PayBill; real Tills use Buy Goods with PartyB = the Till number.
    TransactionType: isProd() ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: isProd() ? till : shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrl(),
    AccountReference: String(accountReference || 'POS').slice(0, 12),
    TransactionDesc: String(description || 'Payment').slice(0, 13),
  };

  let res;
  try {
    res = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new AppError('M-Pesa did not respond. If the customer got a prompt, use the M-Pesa code instead.', 504, 'MPESA_TIMEOUT');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || String(json.ResponseCode) !== '0') {
    throw new AppError(json.errorMessage || json.ResponseDescription || 'M-Pesa rejected the request', 502, 'MPESA_REJECTED');
  }
  return json;
}

module.exports = { stkPush };
