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

const BTN = {
  contact: '📱 Telefon raqamni yuborish',
  search: '🔍 Retseptni izlash',
  mine: '🧾 Mening retseptlarim',
  help: 'ℹ️ Yordam',
};

const contactKb = new Keyboard().requestContact(BTN.contact).resized().oneTime();
const mainKb = new Keyboard().text(BTN.search).row().text(BTN.mine).text(BTN.help).resized();

function digits(p) { return String(p || '').replace(/\D/g, ''); }

function upsertUser(ctx, phone) {
  const chatId = String(ctx.chat.id);
  const now = new Date().toISOString();
  const from = ctx.from || {};
  const ex = h.get('SELECT * FROM telegram_users WHERE chat_id = ?', chatId);
  if (ex) {
    h.run('UPDATE telegram_users SET phone = COALESCE(?, phone), first_name = ?, username = ?, last_seen_at = ? WHERE chat_id = ?',
      phone ? digits(phone) : null, from.first_name || null, from.username || null, now, chatId);
    return h.get('SELECT * FROM telegram_users WHERE chat_id = ?', chatId);
  }
  h.run('INSERT INTO telegram_users (chat_id, phone, first_name, username, created_at, last_seen_at) VALUES (?,?,?,?,?,?)',
    chatId, phone ? digits(phone) : null, from.first_name || null, from.username || null, now, now);
  return h.get('SELECT * FROM telegram_users WHERE chat_id = ?', chatId);
}

function getUser(ctx) {
  return h.get('SELECT * FROM telegram_users WHERE chat_id = ?', String(ctx.chat.id));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Retsept haqida qisqacha matn */
function summary(rx) {
  const lines = [
    `🧾 <b>Retsept ${esc(rx.pretty_id)}</b>`,
    '',
    `👤 Bemor: <b>${esc(rx.patient.full_name)}</b>${rx.patient.birth_year ? ` (${rx.patient.birth_year}-yil)` : ''}`,
    `📅 Sana: <b>${fmt.dmy(rx.visit_date)}</b>`,
    `🩺 Shifokor: <b>${esc(rx.doctor.full_name)}</b>${rx.doctor.specialty ? `, ${esc(rx.doctor.specialty)}` : ''}`,
  ];
  if (rx.diagnosis) lines.push(`📌 Tashxis: <b>${esc(rx.diagnosis)}</b>${rx.icd10 ? ` (${esc(rx.icd10)})` : ''}`);
  if (rx.items.length) {
    lines.push('', '<b>Dori vositalari:</b>');
    rx.items.forEach((it, i) => {
      const l = rxLib.rxLines(it);
      lines.push(`${i + 1}. <b>${esc(l.head)}</b>${l.dtd ? ` — ${esc(l.dtd)}` : ''}`);
      if (l.sig) lines.push(`   <i>S. ${esc(l.sig)}</i>`);
    });
  }
  if (rx.physiotherapy) lines.push('', `💆 <b>Fizioterapiya:</b> ${esc(rx.physiotherapy)}`);
  if (rx.next_visit) lines.push('', `🔁 Keyingi qabul: <b>${fmt.dmy(rx.next_visit)}</b>`);
  return lines.join('\n');
}

async function sendPrescription(ctx, rx) {
  const url = qr.prescriptionUrl(rx.public_id);
  const kb = new InlineKeyboard().url('🌐 Saytda ochish', url);

  if (rx.status === 'cancelled') {
    await ctx.reply(
      `⚠️ <b>${esc(rx.pretty_id)}</b> retsepti shifokor tomonidan <b>bekor qilingan</b>.\n` +
      'Iltimos, shifokoringizga murojaat qiling.',
      { parse_mode: 'HTML', reply_markup: kb });
    return;
  }

  await ctx.replyWithChatAction('upload_document');
  const buf = await pdfLib.buildPrescriptionPdf(rx);
  await ctx.replyWithDocument(new InputFile(buf, pdfLib.fileName(rx)), {
    caption: summary(rx),
    parse_mode: 'HTML',
    reply_markup: kb,
  });

  h.run('UPDATE prescriptions SET view_count = view_count + 1 WHERE id = ?', rx.id);
  h.run('INSERT INTO access_log (prescription_id, channel, meta, created_at) VALUES (?,?,?,?)',
    rx.id, 'telegram', JSON.stringify({ chat_id: String(ctx.chat.id) }), new Date().toISOString());
}

async function handleLookup(ctx, raw) {
  const chatId = String(ctx.chat.id);
  if (throttled(chatId)) {
    return ctx.reply('⏳ Juda ko\'p so\'rov yuborildi. Bir daqiqadan so\'ng qayta urinib ko\'ring.');
  }
  const normalized = ids.normalizeId(raw);
  if (!normalized || normalized.length < 8) {
    return ctx.reply(
      '❌ ID noto\'g\'ri ko\'rinishda.\n\nRetsept ID si <code>NR-XXXX-XXXX</code> ko\'rinishida bo\'ladi. ' +
      'Masalan: <code>NR-K7M2-9QX4</code>', { parse_mode: 'HTML' });
  }
  const rx = rxLib.getByPublicId(normalized);
  if (!rx) {
    waiting.set(chatId, 'id');
    return ctx.reply(
      `❌ <code>${esc(ids.prettyId(normalized))}</code> bo'yicha retsept topilmadi.\n\n` +
      'ID ni tekshirib, qaytadan yuboring yoki shifokoringizga murojaat qiling.',
      { parse_mode: 'HTML' });
  }
  waiting.delete(chatId);
  await sendPrescription(ctx, rx);
}

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
    const payload = (ctx.match || '').trim();

    if (!user.phone) {
      return ctx.reply(
        `Assalomu alaykum${ctx.from.first_name ? ', ' + esc(ctx.from.first_name) : ''}! 👋\n\n` +
        '<b>NodiRetsept</b> — shifokor yozgan retseptni onlayn olish xizmati.\n\n' +
        'Boshlash uchun quyidagi tugma orqali telefon raqamingizni yuboring 👇',
        { parse_mode: 'HTML', reply_markup: contactKb });
    }
    if (payload) return handleLookup(ctx, payload);
    return ctx.reply(
      `Xush kelibsiz${ctx.from.first_name ? ', ' + esc(ctx.from.first_name) : ''}! 👋\n\n` +
      'Retseptingizni olish uchun <b>🔍 Retseptni izlash</b> tugmasini bosing va ' +
      'shifokor bergan ID ni yuboring.',
      { parse_mode: 'HTML', reply_markup: mainKb });
  });

  b.command('help', (ctx) => ctx.reply(helpText(), { parse_mode: 'HTML', reply_markup: mainKb }));
  b.command('search', (ctx) => askId(ctx));

  // Telefon raqam
  b.on('message:contact', async (ctx) => {
    const contact = ctx.message.contact;
    if (contact.user_id && contact.user_id !== ctx.from.id) {
      return ctx.reply('Iltimos, <b>o\'zingizning</b> telefon raqamingizni yuboring.',
        { parse_mode: 'HTML', reply_markup: contactKb });
    }
    upsertUser(ctx, contact.phone_number);
    await ctx.reply(
      `✅ Rahmat! Raqamingiz qabul qilindi: <b>${esc(fmt.phoneFmt(digits(contact.phone_number)))}</b>\n\n` +
      'Endi retseptingizni topishingiz mumkin.',
      { parse_mode: 'HTML', reply_markup: mainKb });
  });

  // Inline tugmalar («Mening retseptlarim» ro'yxatidan tanlash)
  b.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data || '';
    await ctx.answerCallbackQuery();
    if (!data.startsWith('rx:')) return;
    const rx = rxLib.getByPublicId(data.slice(3));
    if (!rx) return ctx.reply('Retsept topilmadi.');
    return sendPrescription(ctx, rx);
  });

  // Tugmalar va matnlar
  b.on('message:text', async (ctx) => {
    const text = (ctx.message.text || '').trim();
    const chatId = String(ctx.chat.id);
    const user = upsertUser(ctx, null);

    if (!user.phone) {
      return ctx.reply(
        'Xizmatdan foydalanish uchun avval telefon raqamingizni yuboring 👇',
        { reply_markup: contactKb });
    }

    if (text === BTN.search) return askId(ctx);
    if (text === BTN.help) return ctx.reply(helpText(), { parse_mode: 'HTML', reply_markup: mainKb });
    if (text === BTN.mine) return myPrescriptions(ctx, user);

    if (waiting.get(chatId) === 'id' || /^(nr[\s-]?)?[a-z0-9][a-z0-9\s-]{5,20}$/i.test(text)) {
      return handleLookup(ctx, text);
    }
    return ctx.reply(
      'Tushunmadim 🤔\n\nRetsept ID sini yuboring (masalan <code>NR-K7M2-9QX4</code>) ' +
      'yoki <b>🔍 Retseptni izlash</b> tugmasini bosing.',
      { parse_mode: 'HTML', reply_markup: mainKb });
  });

  return b;
}

function askId(ctx) {
  waiting.set(String(ctx.chat.id), 'id');
  return ctx.reply(
    '🔍 Retsept ID sini yuboring.\n\n' +
    'ID shifokor bergan qog\'ozda yoki QR kod ostida yozilgan bo\'ladi, masalan: <code>NR-K7M2-9QX4</code>',
    { parse_mode: 'HTML', reply_markup: mainKb });
}

async function myPrescriptions(ctx, user) {
  const phone = digits(user.phone);
  const tail = phone.slice(-9);
  if (!tail) return ctx.reply('Telefon raqamingiz saqlanmagan. /start ni bosing.');
  const rows = h.all(
    `SELECT p.* FROM prescriptions p JOIN patients pt ON pt.id = p.patient_id
     WHERE replace(replace(replace(IFNULL(pt.phone,''),'+',''),' ',''),'-','') LIKE ?
       AND p.status = 'active'
     ORDER BY p.visit_date DESC LIMIT 10`, `%${tail}`);
  if (!rows.length) {
    return ctx.reply(
      'Sizning raqamingizga biriktirilgan retsept topilmadi.\n\n' +
      'Retseptni ID orqali qidirib ko\'ring — <b>🔍 Retseptni izlash</b>.',
      { parse_mode: 'HTML', reply_markup: mainKb });
  }
  const kb = new InlineKeyboard();
  rows.forEach((r, i) => {
    kb.text(`${ids.prettyId(r.public_id)} · ${fmt.dmy(r.visit_date)}`, `rx:${r.public_id}`);
    if (i < rows.length - 1) kb.row();
  });
  return ctx.reply(`🧾 Sizga tegishli <b>${rows.length}</b> ta retsept topildi. Birini tanlang:`,
    { parse_mode: 'HTML', reply_markup: kb });
}

function helpText() {
  return [
    '<b>NodiRetsept boti qanday ishlaydi?</b>',
    '',
    '1️⃣ Shifokor retsept yozadi va sizga ID hamda QR kod beradi.',
    '2️⃣ <b>🔍 Retseptni izlash</b> tugmasini bosing.',
    '3️⃣ ID ni yuboring — masalan <code>NR-K7M2-9QX4</code>.',
    '4️⃣ Bot sizga retseptning PDF faylini yuboradi.',
    '',
    'QR kodni telefon kamerangiz bilan skanerlab ham to\'g\'ridan-to\'g\'ri ochishingiz mumkin.',
    '',
    `🌐 Sayt: ${config.publicUrl}`,
  ].join('\n');
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
