'use strict';

const MONTHS = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
       'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
  'uz-Cyrl': ['январ', 'феврал', 'март', 'апрел', 'май', 'июн',
              'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
       'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June',
       'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT = {
  uz: MONTHS.uz.map((m) => m.slice(0, 3)),
  'uz-Cyrl': ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const MONTHS_UZ = MONTHS.uz;

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

/** Tilga mos to'liq sana: 3-sentabr, 2026-yil · 3 сентября 2026 г. · 3 September 2026 */
function longDate(s, locale = 'uz') {
  const d = parseISODate(s) || (s ? new Date(s) : null);
  if (!d || Number.isNaN(d.getTime())) return '';
  const loc = MONTHS[locale] ? locale : 'uz';
  const m = MONTHS[loc][d.getMonth()];
  if (loc === 'ru') return `${d.getDate()} ${m} ${d.getFullYear()} г.`;
  if (loc === 'en') return `${d.getDate()} ${m} ${d.getFullYear()}`;
  if (loc === 'uz-Cyrl') return `${d.getDate()}-${m}, ${d.getFullYear()}-йил`;
  return `${d.getDate()}-${m}, ${d.getFullYear()}-yil`;
}

/** Grafiklardagi qisqa oy nomi */
function monthShort(index, locale = 'uz') {
  const loc = MONTHS_SHORT[locale] ? locale : 'uz';
  return MONTHS_SHORT[loc][index];
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

/** Ko'rinishlar uchun tilga bog'langan nusxa: fmt.longDate(sana) o'z-o'zidan to'g'ri tilda chiqadi */
function forLocale(locale) {
  return {
    ...module.exports,
    locale,
    longDate: (s) => longDate(s, locale),
    monthShort: (i) => monthShort(i, locale),
  };
}

module.exports = {
  MONTHS, MONTHS_SHORT, MONTHS_UZ, toISODate, parseISODate, dmy, longDate, dateTime,
  addDays, age, initials, shortName, phoneFmt, plural, monthShort, forLocale,
};
