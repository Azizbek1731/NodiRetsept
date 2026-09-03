'use strict';

const MONTHS_UZ = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const WEEKDAYS_UZ = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

/** Mahalliy (server) vaqt bo'yicha YYYY-MM-DD */
function toISODate(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function parseISODate(s) {
  if (!s) return null;
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 2026-09-03 -> 03.09.2026 */
function dmy(s) {
  const d = parseISODate(s) || (s ? new Date(s) : null);
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 2026-09-03 -> 3-sentabr, 2026-yil */
function longDate(s) {
  const d = parseISODate(s) || (s ? new Date(s) : null);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}-${MONTHS_UZ[d.getMonth()]}, ${d.getFullYear()}-yil`;
}

/** ISO timestamp -> 03.09.2026 14:25 */
function dateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function age(birthYear) {
  if (!birthYear) return null;
  const a = new Date().getFullYear() - Number(birthYear);
  return a >= 0 && a < 130 ? a : null;
}

function initials(fullName) {
  if (!fullName) return '?';
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

/** Familiya I.SH. ko'rinishi */
function shortName(fullName) {
  if (!fullName) return '';
  const p = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return p[0] || '';
  return p[0] + ' ' + p.slice(1).map((x) => x[0].toUpperCase() + '.').join('');
}

function phoneFmt(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('998')) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  if (d.length === 9) return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
  return String(p);
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

module.exports = {
  MONTHS_UZ, WEEKDAYS_UZ, toISODate, parseISODate, dmy, longDate, dateTime,
  addDays, age, initials, shortName, phoneFmt, plural,
};
