'use strict';
const express = require('express');
const auth = require('../lib/auth');
const db = require('../lib/db');
const { h } = db;
const rxLib = require('../lib/prescriptions');
const fmt = require('../lib/format');
const upload = require('../lib/upload');

const router = express.Router();

/** Retsept yozish oynasi uchun umumiy ma'lumotlar (tanlov ro'yxatlari tilga bog'liq) */
function editorData(user, t) {
  const list = (key) => {
    const v = t(`editorOpts.${key}`);
    return Array.isArray(v) ? v : [];
  };
  return {
    today: fmt.toISODate(),
    forms: list('forms'),
    routes: list('routes'),
    frequencies: list('frequencies'),
    durations: list('durations'),
    instructions: list('instructions'),
    physioSuggest: list('physioSuggest'),
    genders: [t('editorOpts.genderMale'), t('editorOpts.genderFemale')],
    canPickDoctor: user.role === 'admin',
    doctors: user.role === 'admin'
      ? h.all("SELECT id, full_name, specialty FROM users WHERE role='doctor' AND is_active=1 ORDER BY full_name")
      : [],
  };
}

/* ── Dashboard ────────────────────────────────────────────── */

router.get('/dashboard', auth.requireDoctor, (req, res) => {
  const stats = rxLib.stats(req.user.id);
  const recent = rxLib.list({ doctorId: req.user.id, limit: 8 }).rows;
  const todays = rxLib.list({
    doctorId: req.user.id, from: stats.periods.today, to: stats.periods.today, limit: 50,
  }).rows;
  res.render('doctor/dashboard', {
    title: req.t('nav.dashboard'),
    bodyClass: 'app-page',
    stats, recent, todays,
    editor: editorData(req.user, req.t),
  });
});

/* ── Bemorlar ─────────────────────────────────────────────── */

router.get('/patients', auth.requireDoctor, (req, res) => {
  const q = String(req.query.q || '').trim();
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 20;

  const params = [];
  let where = '1=1';
  if (q) {
    where += ' AND (p.full_name LIKE ? OR p.phone LIKE ? OR p.code LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (scope === 'mine') {
    where += ' AND (p.created_by = ? OR EXISTS (SELECT 1 FROM prescriptions r WHERE r.patient_id = p.id AND r.doctor_id = ?))';
    params.push(req.user.id, req.user.id);
  }
  const rows = h.all(
    `SELECT p.*,
            (SELECT COUNT(*) FROM prescriptions r WHERE r.patient_id = p.id) AS rx_count,
            (SELECT MAX(visit_date) FROM prescriptions r WHERE r.patient_id = p.id) AS last_visit
     FROM patients p WHERE ${where}
     ORDER BY (last_visit IS NULL), last_visit DESC, p.id DESC
     LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage);
  const total = h.get(`SELECT COUNT(*) AS n FROM patients p WHERE ${where}`, ...params).n;

  res.render('doctor/patients', {
    title: req.t('nav.patients'), bodyClass: 'app-page',
    patients: rows, total, page, perPage, q, listScope: scope,
    editor: editorData(req.user, req.t),
  });
});

router.get('/patients/:id', auth.requireDoctor, (req, res, next) => {
  const patient = h.get('SELECT * FROM patients WHERE id = ?', Number(req.params.id));
  if (!patient) return next();
  const history = rxLib.list({ patientId: patient.id, limit: 100 }).rows;
  res.render('doctor/patient', {
    title: patient.full_name, bodyClass: 'app-page',
    patient, history, editor: editorData(req.user, req.t),
  });
});

/* ── Retseptlar ro'yxati ──────────────────────────────────── */

router.get('/prescriptions', auth.requireDoctor, (req, res) => {
  const q = String(req.query.q || '').trim();
  const from = String(req.query.from || '') || null;
  const to = String(req.query.to || '') || null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 20;
  const { rows, total } = rxLib.list({
    doctorId: req.user.id, q, from, to, limit: perPage, offset: (page - 1) * perPage,
  });
  res.render('doctor/prescriptions', {
    title: req.t('nav.prescriptions'), bodyClass: 'app-page',
    prescriptions: rows, total, page, perPage, q, from, to,
    editor: editorData(req.user, req.t),
  });
});

/* ── Profil ───────────────────────────────────────────────── */

router.get('/profile', auth.requireRole('doctor', 'admin'), (req, res) => {
  const stats = req.user.role === 'doctor' ? rxLib.stats(req.user.id) : rxLib.stats();
  res.render('doctor/profile', {
    title: req.t('profile.title'), bodyClass: 'app-page',
    doctor: h.get('SELECT * FROM users WHERE id = ?', req.user.id),
    template: rxLib.effectiveTemplate(req.user.role === 'doctor' ? req.user.id : null),
    stats,
    editor: editorData(req.user, req.t),
  });
});

router.post('/profile', auth.requireRole('doctor', 'admin'), (req, res) => {
  const b = req.body || {};
  const s = (v) => (typeof v === 'string' ? v.trim() : null) || null;
  h.run(`UPDATE users SET full_name=?, phone=?, specialty=?, license_number=?, room=? WHERE id=?`,
    s(b.full_name) || req.user.full_name, s(b.phone), s(b.specialty), s(b.license_number), s(b.room), req.user.id);
  h.audit(req.user.id, 'profile.update', 'user', req.user.id, null);
  req.session.flash = { type: 'success', text: req.t('profile.savedOk') };
  res.redirect('/profile');
});

router.post('/profile/password', auth.requireRole('doctor', 'admin'), (req, res) => {
  const { current = '', password = '', confirm = '' } = req.body || {};
  if (!auth.verifyPassword(current, req.user.password_hash)) {
    req.session.flash = { type: 'error', text: req.t('profile.pwdWrong') };
  } else if (String(password).length < 6) {
    req.session.flash = { type: 'error', text: req.t('profile.pwdShort') };
  } else if (password !== confirm) {
    req.session.flash = { type: 'error', text: req.t('profile.pwdMismatch') };
  } else {
    h.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(password), req.user.id);
    h.audit(req.user.id, 'password.change', 'user', req.user.id, null);
    req.session.flash = { type: 'success', text: req.t('profile.pwdOk') };
  }
  res.redirect('/profile');
});

router.post('/profile/media', auth.requireRole('doctor', 'admin'),
  upload.stamps.fields([{ name: 'stamp', maxCount: 1 }, { name: 'signature', maxCount: 1 }]),
  (req, res) => {
    const files = req.files || {};
    const me = h.get('SELECT stamp_path, signature_path FROM users WHERE id = ?', req.user.id);
    if (files.stamp && files.stamp[0]) {
      upload.remove(me.stamp_path);
      h.run('UPDATE users SET stamp_path = ? WHERE id = ?', upload.relPath(files.stamp[0]), req.user.id);
    }
    if (files.signature && files.signature[0]) {
      upload.remove(me.signature_path);
      h.run('UPDATE users SET signature_path = ? WHERE id = ?', upload.relPath(files.signature[0]), req.user.id);
    }
    req.session.flash = { type: 'success', text: req.t('profile.mediaOk') };
    res.redirect('/profile');
  });

module.exports = router;
