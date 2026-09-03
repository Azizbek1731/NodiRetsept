'use strict';
const crypto = require('crypto');

// Chalkashtiradigan belgilar (0,1,I,L,O,U) chiqarib tashlangan alifbo —
// bemor ID ni qo'lda kiritganda xato qilmasligi uchun.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomCode(len = 8) {
  const bytes = crypto.randomBytes(len * 2);
  let out = '';
  for (let i = 0; out.length < len && i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 256 - (256 % ALPHABET.length)) continue; // moduldagi og'ishni yo'qotamiz
    out += ALPHABET[b % ALPHABET.length];
  }
  return out.length === len ? out : out + randomCode(len - out.length);
}

/** Retsept uchun ommaviy ID: NR-XXXXXXXX */
function newPrescriptionId(exists) {
  for (let i = 0; i < 50; i++) {
    const id = 'NR-' + randomCode(8);
    if (!exists || !exists(id)) return id;
  }
  throw new Error('Retsept ID yaratib bo\'lmadi');
}

/**
 * Foydalanuvchi kiritgan ID ni me'yorlashtirish.
 * "nr k7m2 9qx4", "NR-K7M29QX4", "k7m29qx4" — hammasi "NR-K7M29QX4" ga aylanadi.
 */
function normalizeId(input) {
  if (!input) return '';
  let s = String(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('NR')) s = s.slice(2);
  if (!s) return '';
  return 'NR-' + s;
}

/** Ko'rsatish uchun chiroyli ko'rinish: NR-K7M2-9QX4 */
function prettyId(id) {
  if (!id) return '';
  const body = String(id).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^NR/, '');
  return body.length === 8 ? `NR-${body.slice(0, 4)}-${body.slice(4)}` : String(id).toUpperCase();
}

function patientCode(id) {
  return 'B-' + String(id).padStart(5, '0');
}

module.exports = { randomCode, newPrescriptionId, normalizeId, prettyId, patientCode };
