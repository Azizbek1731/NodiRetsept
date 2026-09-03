'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const db = require('./lib/db');
const SqliteStore = require('./lib/session-store');
const auth = require('./lib/auth');
const fmt = require('./lib/format');
const ids = require('./lib/ids');
const { icon } = require('./lib/icons');
const { rxLines } = require('./lib/prescriptions');
const i18n = require('./lib/i18n');
const tgBot = require('./telegram/bot');
const { bootstrap } = require('./lib/seed');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', config.paths.views);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(session({
  name: 'nodiretsept.sid',
  secret: config.sessionSecret,
  store: new SqliteStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production' && config.publicUrl.startsWith('https://'),
    maxAge: 1000 * 60 * 60 * 12,
  },
}));

// Statik fayllar
app.use('/static', express.static(config.paths.public, { maxAge: config.env === 'production' ? '7d' : 0 }));
app.use('/uploads', express.static(config.paths.uploads, { maxAge: '7d' }));
app.use('/vendor/jsqr.js', express.static(path.join(config.root, 'node_modules', 'jsqr', 'dist', 'jsQR.js')));

app.use(i18n.middleware);
app.use(auth.attachUser);

// Ko'rinishlarda hamma joyda kerak bo'ladigan yordamchilar
app.use((req, res, next) => {
  res.locals.fmt = fmt.forLocale(req.locale);
  res.locals.icon = icon;
  res.locals.rxLines = rxLines;
  res.locals.botUsername = tgBot.info().username;
  res.locals.currentUrl = req.originalUrl || '/';
  res.locals.ids = ids;
  res.locals.publicUrl = config.publicUrl;
  res.locals.appName = 'NodiRetsept';
  res.locals.flash = req.session.flash || null;
  res.locals.query = req.query || {};
  delete req.session.flash;
  res.locals.title = 'NodiRetsept';
  res.locals.bodyClass = '';
  next();
});

// Ommaviy qidiruv uchun tezlik cheklovi (ID ni brutforce qilishning oldini oladi)
const lookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ ok: false, error: req.t('err.tooMany') }),
});
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('error', {
    title: req.t('err.error'), code: 429, message: req.t('err.tooManyLogin'), bodyClass: '',
  }),
});

app.locals.lookupLimiter = lookupLimiter;

// Til almashtirish — URL o'zgarmaydi, tanlov cookie da saqlanadi
app.get('/lang/:code', (req, res) => {
  const code = i18n.canonical(req.params.code);   // "uz-cyrl" ham qabul qilinadi
  if (code) {
    res.cookie(i18n.COOKIE, code, {
      maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax', path: '/',
    });
  }
  const back = typeof req.query.next === 'string' && req.query.next.startsWith('/')
    && !req.query.next.startsWith('//') ? req.query.next : '/';
  res.redirect(back);
});

// Marshrutlar
app.use('/', require('./routes/auth')(loginLimiter));
app.use('/', require('./routes/public')(lookupLimiter));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/doctor'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  if (auth.wantsJson(req)) return res.status(404).json({ ok: false, error: req.t('err.notFound') });
  res.status(404).render('error', {
    title: req.t('notfound.pageTitle'), code: 404, message: req.t('notfound.pageText'),
  });
});

// Xatoliklar
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  // Fayl yuklashdagi xatolarni tushunarli qilib qaytaramiz
  if (err && err.code && String(err.code).startsWith('LIMIT_')) {
    err.status = 400;
    err.expose = true;
    err.message = req.t(err.code === 'LIMIT_FILE_SIZE' ? 'err.fileTooBig' : 'err.fileBad');
  }
  // Sahifadan yuborilgan forma bo'lsa — orqaga qaytarib, xabar ko'rsatamiz
  if (err && err.expose && req.session && !auth.wantsJson(req) && req.method === 'POST') {
    req.session.flash = { type: 'error', text: err.message };
    const back = req.get('referer');
    if (back && back.startsWith(config.publicUrl)) return res.redirect(back);
  }
  if (!err || !err.expose) console.error('[xato]', err);
  const status = err.status || 500;
  if (auth.wantsJson(req)) {
    return res.status(status).json({ ok: false, error: err.expose ? err.message : req.t('err.server') });
  }
  res.status(status).render('error', {
    title: req.t('err.error'), code: status,
    message: err.expose ? err.message : req.t('err.serverPage'),
  });
});

function start() {
  console.log('\n  NodiRetsept — ishga tushmoqda…');
  bootstrap();

  const server = app.listen(config.port, () => {
    console.log(`  ✓ Sayt:     ${config.publicUrl}`);
    console.log(`  ✓ Baza:     ${config.paths.db}`);
    if (config.telegram.enabled && config.telegram.token) {
      tgBot.start().catch((e) => console.error('  ! Telegram bot ishga tushmadi:', e.message));
    } else {
      console.log('  · Telegram bot o\'chirilgan (.env dagi TELEGRAM_ENABLED / TOKEN ni tekshiring)');
    }
    console.log('');
  });

  const shutdown = () => {
    console.log('\n  NodiRetsept to\'xtatilmoqda…');
    server.close(() => { try { db.close(); } catch { /* — */ } process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { app, start };
