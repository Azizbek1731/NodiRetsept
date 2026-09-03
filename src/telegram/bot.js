'use strict';
const net = require('net');
const { Bot, InputFile, Keyboard, InlineKeyboard, GrammyError, HttpError } = require('grammy');

// Node ning "Happy Eyeballs" mexanizmi har bir IP ga ulanishga standart holda atigi 250 ms
// beradi. Server Telegram serverlaridan uzoqda bo'lsa (masalan AWS Sidney → Yevropa, ~280 ms)
// yoki hostda IPv6 marshruti bo'lmasa, ulanish shu chegarada uzilib, bot ishga tushmay qoladi.
// Chegarani kengaytiramiz — bu faqat kutish vaqti, tez tarmoqqa ta'sir qilmaydi.
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === 'function') {
  net.setDefaultAutoSelectFamilyAttemptTimeout(5000);
}

const config = require('../config');
const db = require('../lib/db');
const { h } = db;
const i18n = require('../lib/i18n');
const rxLib = require('../lib/prescriptions');
const pdfLib = require('../lib/pdf');
const qr = require('../lib/qr');
const ids = require('../lib/ids');
const fmt = require('../lib/format');

const state = { running: false, username: null, error: null, startedAt: null };
let bot = null;

/** Suhbat holati: qaysi chat ID kutayotgani (server qayta ishga tushsa tozalanadi) */
const waiting = new Map();
/** Oddiy tezlik cheklovi: chat boshiga daqiqasiga 15 ta so'rov */
const hits = new Map();

function throttled(chatId) {
  const now = Date.now();
  const rec = hits.get(chatId) || { n: 0, t: now };
  if (now - rec.t > 60_000) { rec.n = 0; rec.t = now; }
  rec.n++;
  hits.set(chatId, rec);
  return rec.n > 15;
}

/* ── Til ─────────────────────────────────────────────────── */

/** Telegram bergan til kodidan boshlang'ich tilni taxmin qilamiz */
function guessLang(code) {
  const c = String(code || '').toLowerCase();
  if (c.startsWith('ru')) return 'ru';
  if (c.startsWith('en')) return 'en';
  if (c.startsWith('uz')) return 'uz';
  return i18n.DEFAULT_LOCALE;
}

function userLang(ctx) {
  const row = h.get('SELECT lang FROM telegram_users WHERE chat_id = ?', String(ctx.chat.id));
  if (row && row.lang && i18n.LOCALES.includes(row.lang)) return row.lang;
  return guessLang(ctx.from && ctx.from.language_code);
}

/** Tarjima funksiyasi + kalitlar to'plamini bitta joyda beramiz */
function L(ctx) {
  const lang = userLang(ctx);
  const t = (key, params) => i18n.t(lang, key, params);
  return { lang, t };
}

/* ── Klaviaturalar ───────────────────────────────────────── */

function contactKb(t) {
  return new Keyboard().requestContact(t('bot.contactBtn')).resized().oneTime();
}
function mainKb(t) {
  return new Keyboard()
    .text(t('bot.searchBtn')).row()
    .text(t('bot.mineBtn')).text(t('bot.helpBtn')).row()
    .text(t('bot.langBtn'))
    .resized();
}

/**
 * Tugma matnini amalga aylantiramiz. Foydalanuvchining klaviaturasi eski tilda
 * qolgan bo'lishi mumkin, shuning uchun barcha tillardagi variantlarni tekshiramiz.
 */
const BUTTON_KEYS = ['bot.searchBtn', 'bot.mineBtn', 'bot.helpBtn', 'bot.langBtn'];
function buttonAction(text) {
  const clean = String(text || '').trim();
  for (const locale of i18n.LOCALES) {
    for (const key of BUTTON_KEYS) {
      if (i18n.t(locale, key) === clean) return key;
    }
  }
  return null;
}

function langKb() {
  const kb = new InlineKeyboard();
  i18n.LOCALES.forEach((code, i) => {
    kb.text(i18n.NAMES[code], `lang:${code}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

/* ── Foydalanuvchilar ────────────────────────────────────── */

function digits(p) { return String(p || '').replace(/\D/g, ''); }

function upsertUser(ctx, phone) {
  const chatId = String(ctx.chat.id);
  const now = new Date().toISOString();
  const from = ctx.from || {};
  const ex = h.get('SELECT * FROM telegram_users WHERE chat_id = ?', chatId);
  if (ex) {
    h.run(`UPDATE telegram_users SET phone = COALESCE(?, phone), first_name = ?, username = ?,
           lang = COALESCE(lang, ?), last_seen_at = ? WHERE chat_id = ?`,
      phone ? digits(phone) : null, from.first_name || null, from.username || null,
      guessLang(from.language_code), now, chatId);
    return h.get('SELECT * FROM telegram_users WHERE chat_id = ?', chatId);
  }
  h.run(`INSERT INTO telegram_users (chat_id, phone, first_name, username, lang, created_at, last_seen_at)
         VALUES (?,?,?,?,?,?,?)`,
    chatId, phone ? digits(phone) : null, from.first_name || null, from.username || null,
    guessLang(from.language_code), now, now);
  return h.get('SELECT * FROM telegram_users WHERE chat_id = ?', chatId);
}

function setLang(ctx, lang) {
  h.run('UPDATE telegram_users SET lang = ? WHERE chat_id = ?', lang, String(ctx.chat.id));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Retsept yuborish ────────────────────────────────────── */

/** Retsept haqida qisqacha matn (foydalanuvchi tilida) */
function summary(rx, t, lang) {
  const f = fmt.forLocale(lang);
  const lines = [
    t('bot.sumTitle', { id: esc(rx.pretty_id) }),
    '',
    `${t('bot.sumPatient')}: <b>${esc(rx.patient.full_name)}</b>${rx.patient.birth_year ? ` (${rx.patient.birth_year})` : ''}`,
    `${t('bot.sumDate')}: <b>${f.dmy(rx.visit_date)}</b>`,
    `${t('bot.sumDoctor')}: <b>${esc(rx.doctor.full_name)}</b>${rx.doctor.specialty ? `, ${esc(rx.doctor.specialty)}` : ''}`,
  ];
  if (rx.diagnosis) {
    lines.push(`${t('bot.sumDx')}: <b>${esc(rx.diagnosis)}</b>${rx.icd10 ? ` (${esc(rx.icd10)})` : ''}`);
  }
  if (rx.items.length) {
    lines.push('', `<b>${t('bot.sumDrugs')}</b>`);
    rx.items.forEach((it, i) => {
      const l = rxLib.rxLines(it);
      lines.push(`${i + 1}. <b>${esc(l.head)}</b>${l.dtd ? ` — ${esc(l.dtd)}` : ''}`);
      if (l.sig) lines.push(`   <i>S. ${esc(l.sig)}</i>`);
    });
  }
  if (rx.physiotherapy) lines.push('', `${t('bot.sumPhysio')} ${esc(rx.physiotherapy)}`);
  if (rx.next_visit) lines.push('', `${t('bot.sumNext')}: <b>${f.dmy(rx.next_visit)}</b>`);
  return lines.join('\n');
}

async function sendPrescription(ctx, rx) {
  const { t, lang } = L(ctx);
  const url = qr.prescriptionUrl(rx.public_id);
  const kb = new InlineKeyboard().url(t('bot.openOnSite'), url);

  if (rx.status === 'cancelled') {
    await ctx.reply(t('bot.cancelledRx', { id: esc(rx.pretty_id) }), { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  await ctx.replyWithChatAction('upload_document');
  const buf = await pdfLib.buildPrescriptionPdf(rx, lang);
  await ctx.replyWithDocument(new InputFile(buf, pdfLib.fileName(rx)), {
    caption: summary(rx, t, lang),
    parse_mode: 'HTML',
    reply_markup: kb,
  });

  h.run('UPDATE prescriptions SET view_count = view_count + 1 WHERE id = ?', rx.id);
  h.run('INSERT INTO access_log (prescription_id, channel, meta, created_at) VALUES (?,?,?,?)',
    rx.id, 'telegram', JSON.stringify({ chat_id: String(ctx.chat.id), lang }), new Date().toISOString());
}

async function handleLookup(ctx, raw) {
  const { t } = L(ctx);
  const chatId = String(ctx.chat.id);
  if (throttled(chatId)) return ctx.reply(t('bot.throttled'));

  const normalized = ids.normalizeId(raw);
  if (!normalized || normalized.length < 8) {
    return ctx.reply(t('bot.idBadFormat'), { parse_mode: 'HTML' });
  }
  const rx = rxLib.getByPublicId(normalized);
  if (!rx) {
    waiting.set(chatId, 'id');
    return ctx.reply(t('bot.idNotFound', { id: esc(ids.prettyId(normalized)) }), { parse_mode: 'HTML' });
  }
  waiting.delete(chatId);
  await sendPrescription(ctx, rx);
}

function askId(ctx) {
  const { t } = L(ctx);
  waiting.set(String(ctx.chat.id), 'id');
  return ctx.reply(t('bot.askId'), { parse_mode: 'HTML', reply_markup: mainKb(t) });
}

async function myPrescriptions(ctx, user) {
  const { t, lang } = L(ctx);
  const f = fmt.forLocale(lang);
  const tail = digits(user.phone).slice(-9);
  if (!tail) return ctx.reply(t('bot.noPhoneSaved'));
  const rows = h.all(
    `SELECT p.* FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id
     WHERE replace(replace(replace(IFNULL(pt.phone,''),'+',''),' ',''),'-','') LIKE ?
       AND p.status = 'active'
     ORDER BY p.visit_date DESC LIMIT 10`, `%${tail}`);
  if (!rows.length) {
    return ctx.reply(t('bot.mineNone'), { parse_mode: 'HTML', reply_markup: mainKb(t) });
  }
  const kb = new InlineKeyboard();
  rows.forEach((r, i) => {
    kb.text(`${ids.prettyId(r.public_id)} · ${f.dmy(r.visit_date)}`, `rx:${r.public_id}`);
    if (i < rows.length - 1) kb.row();
  });
  return ctx.reply(t('bot.mineFound', { n: rows.length }), { parse_mode: 'HTML', reply_markup: kb });
}

/* ── Bot ─────────────────────────────────────────────────── */

function buildBot() {
  const b = new Bot(config.telegram.token);

  b.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('[telegram] so\'rov xatosi:', e.description);
    else if (e instanceof HttpError) console.error('[telegram] tarmoq xatosi:', e.message);
    else console.error('[telegram] xato:', e);
  });

  // /start (chuqur havola bilan ham: t.me/bot?start=NR-XXXXXXXX)
  b.command('start', async (ctx) => {
    const user = upsertUser(ctx, null);
    const { t } = L(ctx);
    const name = ctx.from && ctx.from.first_name ? ', ' + esc(ctx.from.first_name) : '';
    const payload = (ctx.match || '').trim();

    if (!user.phone) {
      return ctx.reply(t('bot.welcomeNew', { name }), { parse_mode: 'HTML', reply_markup: contactKb(t) });
    }
    if (payload) return handleLookup(ctx, payload);
    return ctx.reply(t('bot.welcomeBack', { name }), { parse_mode: 'HTML', reply_markup: mainKb(t) });
  });

  b.command('help', (ctx) => {
    const { t } = L(ctx);
    return ctx.reply(t('bot.help', { url: config.publicUrl }), { parse_mode: 'HTML', reply_markup: mainKb(t) });
  });
  b.command('search', (ctx) => askId(ctx));
  b.command('lang', (ctx) => {
    const { t } = L(ctx);
    return ctx.reply(t('bot.langChoose'), { reply_markup: langKb() });
  });

  // Telefon raqam
  b.on('message:contact', async (ctx) => {
    const { t } = L(ctx);
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      return ctx.reply(t('bot.ownPhone'), { parse_mode: 'HTML', reply_markup: contactKb(t) });
    }
    upsertUser(ctx, contact.phone_number);
    await ctx.reply(t('bot.phoneOk', { phone: esc(fmt.phoneFmt(digits(contact.phone_number))) }),
      { parse_mode: 'HTML', reply_markup: mainKb(t) });
  });

  // Inline tugmalar
  b.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data || '';
    await ctx.answerCallbackQuery();

    if (data.startsWith('lang:')) {
      const code = data.slice(5);
      if (!i18n.LOCALES.includes(code)) return;
      upsertUser(ctx, null);
      setLang(ctx, code);
      const t = (k, p) => i18n.t(code, k, p);
      return ctx.reply(t('bot.langChanged'), { reply_markup: mainKb(t) });
    }
    if (data.startsWith('rx:')) {
      const rx = rxLib.getByPublicId(data.slice(3));
      const { t } = L(ctx);
      if (!rx) return ctx.reply(t('bot.rxNotFound'));
      return sendPrescription(ctx, rx);
    }
  });

  // Tugmalar va matnlar
  b.on('message:text', async (ctx) => {
    const text = (ctx.message.text || '').trim();
    const chatId = String(ctx.chat.id);
    const user = upsertUser(ctx, null);
    const { t } = L(ctx);

    const action = buttonAction(text);
    if (action === 'bot.langBtn') return ctx.reply(t('bot.langChoose'), { reply_markup: langKb() });

    if (!user.phone) return ctx.reply(t('bot.needPhone'), { reply_markup: contactKb(t) });

    if (action === 'bot.searchBtn') return askId(ctx);
    if (action === 'bot.helpBtn') {
      return ctx.reply(t('bot.help', { url: config.publicUrl }), { parse_mode: 'HTML', reply_markup: mainKb(t) });
    }
    if (action === 'bot.mineBtn') return myPrescriptions(ctx, user);

    if (waiting.get(chatId) === 'id' || /^(nr[\s-]?)?[a-z0-9][a-z0-9\s-]{5,20}$/i.test(text)) {
      return handleLookup(ctx, text);
    }
    return ctx.reply(t('bot.notUnderstood'), { parse_mode: 'HTML', reply_markup: mainKb(t) });
  });

  return b;
}

async function start() {
  if (!config.telegram.token) { state.error = 'Token ko\'rsatilmagan'; return; }
  bot = buildBot();
  await bot.init();
  state.username = bot.botInfo.username;

  bot.start({
    drop_pending_updates: true,
    onStart: () => {
      state.running = true;
      state.startedAt = new Date().toISOString();
      console.log(`  ✓ Telegram: @${state.username} ishga tushdi`);
    },
  }).catch((e) => {
    state.running = false;
    state.error = e.message;
    console.error('  ! Telegram bot to\'xtadi:', e.message);
  });
}

async function stop() {
  if (bot) { try { await bot.stop(); } catch { /* — */ } }
  state.running = false;
}

function info() { return { ...state }; }

module.exports = { start, stop, info, buildBot };
