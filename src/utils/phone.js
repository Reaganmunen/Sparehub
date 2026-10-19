'use strict';

/**
 * Turns any common Kenyan phone format into 2547XXXXXXXX (what Safaricom Daraja and WhatsApp want).
 *   0712345678, 712345678, +254712345678, 254 712 345 678  ->  254712345678
 * Returns null when the number is not a valid Kenyan mobile number.
 */
function normalizePhone(input) {
  if (input === undefined || input === null) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('254')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[17]\d{8}$/.test(digits)) return null;
  return `254${digits}`;
}

module.exports = { normalizePhone };
