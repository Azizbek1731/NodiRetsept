'use strict';
const path = require('path');

/**
 * Ko'p tillilik. Muhim qaror: til URL da emas, cookie da saqlanadi.
 * Sabab — retsept havolalari (/r/NR-XXXX) QR kodlarga yozilib, bemorlarga
 * allaqachon tarqatilgan. URL ga til prefiksini qo'shish ularni buzgan bo'lardi.
 */
const LOCALES = ['uz', 'uz-Cyrl', 'ru', 'en'];
const DEFAULT_LOCALE = 'uz';
const COOKIE = 'nr_lang';

const NAMES = { uz: 'O\'zbekcha', 'uz-Cyrl': 'Ўзбекча', ru: 'Русский', en: 'English' };
const SHORT = { uz: 'UZ', 'uz-Cyrl': 'ЎЗ', ru: 'RU', en: 'EN' };

const dict = {};
for (const l of LOCALES) dict[l] = require(path.join(__dirname, '..', 'i18n', `${l}.json`));

/** Kiritilgan kodni ro'yxatdagi kanonik ko'rinishga keltiradi ("uz-cyrl" → "uz-Cyrl") */
function canonical(code) {
  if (!code) return null;
  const low = String(code).toLowerCase();
  return LOCALES.find((l) => l.toLowerCase() === low) || null;
}

/** "a.b.c" yo'li bo'yicha qiymat olish */
function lookup(obj, key) {
  let cur = obj;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  // Satr ham, ro'yxat ham qaytishi mumkin (masalan tanlov variantlari)
  return typeof cur === 'string' || Array.isArray(cur) ? cur : undefined;
}

/** {nom} ko'rinishidagi o'rinbosarlarni almashtirish */
function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])));
}

/**
 * Tarjimani qaytaradi. Tanlangan tilda topilmasa — o'zbekchaga, u ham
 * bo'lmasa kalitning o'ziga qaytadi (shunda yo'q tarjima ko'rinib turadi).
 */
function translate(locale, key, params) {
  const loc = canonical(locale) || DEFAULT_LOCALE;
  const val = lookup(dict[loc], key) ?? lookup(dict[DEFAULT_LOCALE], key);
  if (val === undefined) {
    if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] tarjima yo'q: ${key} (${loc})`);
    return key;
  }
  return Array.isArray(val) ? val.slice() : interpolate(val, params);
}

/** Accept-Language sarlavhasidan mos tilni topish */
function fromHeader(header) {
  if (!header) return null;
  const wanted = String(header).split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: tag.trim().toLowerCase(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const exact = canonical(tag);
    if (exact) return exact;
    const base = canonical(tag.split('-')[0]);
    if (base) return base;
  }
  return null;
}

/** So'rov uchun tilni aniqlash: ?lang= → cookie → brauzer → standart */
function detect(req) {
  const q = canonical(req.query && req.query.lang);
  if (q) return q;
  const c = canonical(req.cookies && req.cookies[COOKIE]);
  if (c) return c;
  return fromHeader(req.get && req.get('accept-language')) || DEFAULT_LOCALE;
}

function middleware(req, res, next) {
  const locale = detect(req);
  req.locale = locale;
  req.t = (key, params) => translate(locale, key, params);
  res.locals.locale = locale;
  res.locals.t = req.t;
  res.locals.locales = LOCALES.map((code) => ({ code, name: NAMES[code], short: SHORT[code] }));
  res.locals.localeName = NAMES[locale];
  next();
}

module.exports = {
  LOCALES, DEFAULT_LOCALE, COOKIE, NAMES, SHORT,
  t: translate, detect, middleware, fromHeader, canonical,
};
