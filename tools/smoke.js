'use strict';
/**
 * Tez sinov: har bir sahifani har bir tilda va har bir rol ostida haqiqatan ochib ko'radi.
 *
 * Nega kerak: EJS shablonini kompilyatsiya qilish uni ishga tushirmaydi, shuning uchun
 * "t is not a function" kabi xatolar faqat sahifa ochilganda bilinadi. Bu skript
 * shundaylarni deploydan oldin ushlaydi.
 *
 * Ishlatish:  npm test
 */
process.env.TELEGRAM_ENABLED = 'false';
process.env.PORT = process.env.SMOKE_PORT || '4111';
process.env.PUBLIC_URL = `http://127.0.0.1:${process.env.PORT}`;

const { app } = require('../src/server');
const { bootstrap } = require('../src/lib/seed');
const db = require('../src/lib/db');
const i18n = require('../src/lib/i18n');

const BASE = process.env.PUBLIC_URL;

function pick(sql) { try { return db.prepare(sql).get(); } catch { return null; } }

async function login(username, password) {
  const r = await fetch(`${BASE}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
  return (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  bootstrap();
  const server = app.listen(Number(process.env.PORT));
  await new Promise((res) => server.once('listening', res));

  const rx = pick('SELECT public_id, id FROM prescriptions ORDER BY id DESC LIMIT 1');
  const patient = pick('SELECT id FROM patients ORDER BY id DESC LIMIT 1');
  const doctor = pick("SELECT id, username FROM users WHERE role='doctor' LIMIT 1");

  const pages = {
    guest: ['/', '/scan', '/login', '/yoq-sahifa|404',
      ...(rx ? [`/r/${rx.public_id}`, `/r/${rx.public_id}/pdf`, `/r/${rx.public_id}/qr.png`] : [])],
    doctor: doctor ? ['/dashboard', '/patients', '/prescriptions', '/profile',
      ...(patient ? [`/patients/${patient.id}`] : [])] : [],
    admin: ['/admin', '/admin/doctors', '/admin/doctors/new', '/admin/blank', '/admin/patients',
      '/admin/prescriptions', '/admin/telegram', '/admin/settings', '/profile',
      ...(doctor ? [`/admin/doctors/${doctor.id}`] : [])],
  };
  const api = {
    doctor: doctor ? ['/api/patients/search?q=', '/api/drugs?q=a',
      ...(rx ? [`/api/prescriptions/${rx.id}`] : [])] : [],
  };

  const jars = { guest: '' };
  jars.admin = await login(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD || 'admin123');
  // Shifokor paroli ma'lum bo'lmasa, uning sahifalarini o'tkazib yuboramiz
  jars.doctor = doctor ? await login(doctor.username, 'shifokor123') : '';
  if (!jars.doctor) { pages.doctor = []; api.doctor = []; }

  let total = 0;
  const bad = [];
  for (const lang of i18n.LOCALES) {
    for (const [role, urls] of Object.entries(pages)) {
      for (const raw of urls) {
        const [u, want] = raw.split('|');
        total++;
        const url = BASE + u + (u.includes('?') ? '&' : '?') + 'lang=' + lang;
        try {
          const r = await fetch(url, { headers: jars[role] ? { cookie: jars[role] } : {}, redirect: 'manual' });
          const ok = want ? r.status === Number(want) : (r.status === 200 || r.status === 302);
          if (!ok) bad.push(`${role} · ${lang} · ${u} → ${r.status}`);
        } catch (e) { bad.push(`${role} · ${lang} · ${u} → ${e.message}`); }
      }
    }
    for (const [role, urls] of Object.entries(api)) {
      for (const u of urls) {
        total++;
        const url = BASE + u + (u.includes('?') ? '&' : '?') + 'lang=' + lang;
        const r = await fetch(url, { headers: { cookie: jars[role], accept: 'application/json' } });
        if (r.status !== 200) bad.push(`API ${role} · ${lang} · ${u} → ${r.status}`);
      }
    }
  }

  // Tarjima kalitlari to'liqmi
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
    (typeof v === 'object' && !Array.isArray(v)) ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
  const base = keys(require(`../src/i18n/${i18n.DEFAULT_LOCALE}.json`));
  for (const l of i18n.LOCALES) {
    const missing = base.filter((k) => !keys(require(`../src/i18n/${l}.json`)).includes(k));
    if (missing.length) bad.push(`${l} tarjimasida yetishmayapti: ${missing.slice(0, 5).join(', ')}`);
  }

  server.close();
  console.log(`\n  ${total} ta so'rov · ${i18n.LOCALES.length} ta til`);
  if (bad.length) {
    bad.forEach((b) => console.log('  ✗ ' + b));
    console.log(`\n  ${bad.length} ta XATO\n`);
    process.exit(1);
  }
  console.log('  ✓ barcha sahifalar barcha tillarda ochildi\n');
  process.exit(0);
})().catch((e) => { console.error('Sinov xatosi:', e); process.exit(1); });
