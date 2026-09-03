'use strict';
const bcrypt = require('bcryptjs');
const db = require('./db');
const { h } = db;

const ROUNDS = 10;

function hashPassword(plain) { return bcrypt.hashSync(String(plain), ROUNDS); }
function verifyPassword(plain, hash) {
  try { return bcrypt.compareSync(String(plain), String(hash)); } catch { return false; }
}

function findUserByUsername(username) {
  return h.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', String(username || '').trim());
}
function findUserById(id) {
  return h.get('SELECT * FROM users WHERE id = ?', id);
}

/** Har bir so'rovda joriy foydalanuvchini res.locals ga joylaymiz. */
function attachUser(req, res, next) {
  req.user = null;
  if (req.session && req.session.userId) {
    const u = findUserById(req.session.userId);
    if (u && u.is_active) req.user = u;
    else req.session.destroy(() => {});
  }
  res.locals.currentUser = req.user;
  res.locals.currentPath = req.path;
  next();
}

function wantsJson(req) {
  return req.xhr || (req.get('accept') || '').includes('application/json') ||
    req.path.startsWith('/api/');
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ ok: false, error: 'Avval tizimga kiring' });
  const back = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${back}`);
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (roles.includes(req.user.role)) return next();
    if (wantsJson(req)) return res.status(403).json({ ok: false, error: 'Ruxsat yo\'q' });
    return res.status(403).render('error', {
      title: 'Ruxsat yo\'q', code: 403,
      message: 'Bu bo\'limga kirish huquqingiz yo\'q.',
    });
  };
}

const requireDoctor = requireRole('doctor');
const requireAdmin = requireRole('admin');
/** Retsept yozish/ko'rish: shifokor o'ziniki bilan, admin hammasi bilan ishlaydi */
const requireStaff = requireRole('doctor', 'admin');

module.exports = {
  hashPassword, verifyPassword, findUserByUsername, findUserById,
  attachUser, requireAuth, requireRole, requireDoctor, requireAdmin, requireStaff, wantsJson,
};
