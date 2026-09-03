'use strict';
const express = require('express');
const auth = require('../lib/auth');
const db = require('../lib/db');
const { h } = db;
const rxLib = require('../lib/prescriptions');
const fmt = require('../lib/format');
const upload = require('../lib/upload');

const router = express.Router();

/** Retsept yozish oynasi uchun umumiy ma'lumotlar */
function editorData(user) {
  return {
    today: fmt.toISODate(),
    forms: ['tab.', 'caps.', 'sir.', 'sol. pro inj.', 'sol. pro inf.', 'pulv. pro inj.', 'gran.',
      'ung.', 'crem.', 'gel.', 'supp.', 'guttae', 'aerosol.', 'spray nasal.', 'susp.', 'past.'],
    routes: ['ichga', 'mushak orasiga', 'venaga', 'teri ostiga', 'tashqi', 'rektal', 'inhalyatsion',
      'til ostiga', 'burunga', 'ko\'zga', 'quloqqa'],
    frequencies: ['kuniga 1 mahal', 'kuniga 2 mahal', 'kuniga 3 mahal', 'kuniga 4 mahal',
      'har 6 soatda', 'har 8 soatda', 'har 12 soatda', 'kunora', 'zarurat bo\'lganda'],
    durations: ['3 kun', '5 kun', '7 kun', '10 kun', '14 kun', '1 oy', '2 oy', '3 oy', 'doimiy'],
    instructions: ['ovqatdan oldin', 'ovqat paytida', 'ovqatdan keyin', 'ertalab och qoringa',
      'kechqurun', 'ko\'p suv bilan'],
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
    title: 'Boshqaruv paneli',
    bodyClass: 'app-page',
    stats, recent, todays,
    editor: editorData(req.user),
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
    title: 'Bemorlar', bodyClass: 'app-page',
    patients: rows, total, page, perPage, q, scope,
    editor: editorData(req.user),
  });
});

router.get('/patients/:id', auth.requireDoctor, (req, res, next) => {
  const patient = h.get('SELECT * FROM patients WHERE id = ?', Number(req.params.id));
  if (!patient) return next();
  const history = rxLib.list({ patientId: patient.id, limit: 100 }).rows;
  res.render('doctor/patient', {
    title: patient.full_name, bodyClass: 'app-page',
    patient, history, editor: editorData(req.user),
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
    title: 'Retseptlar', bodyClass: 'app-page',
    prescriptions: rows, total, page, perPage, q, from, to,
    editor: editorData(req.user),
  });
});

/* ── Profil ───────────────────────────────────────────────── */

router.get('/profile', auth.requireRole('doctor', 'admin'), (req, res) => {
  const stats = req.user.role === 'doctor' ? rxLib.stats(req.user.id) : rxLib.stats();
  res.render('doctor/profile', {
    title: 'Profil', bodyClass: 'app-page',
    doctor: h.get('SELECT * FROM users WHERE id = ?', req.user.id),
    template: rxLib.effectiveTemplate(req.user.role === 'doctor' ? req.user.id : null),
    stats,
    editor: editorData(req.user),
  });
});

router.post('/profile', auth.requireRole('doctor', 'admin'), (req, res) => {
  const b = req.body || {};
  const s = (v) => (typeof v === 'string' ? v.trim() : null) || null;
  h.run(`UPDATE users SET full_name=?, phone=?, specialty=?, license_number=?, room=? WHERE id=?`,
    s(b.full_name) || req.user.full_name, s(b.phone), s(b.specialty), s(b.license_number), s(b.room), req.user.id);
  h.audit(req.user.id, 'profile.update', 'user', req.user.id, null);
  req.session.flash = { type: 'success', text: 'Profil ma\'lumotlari saqlandi.' };
  res.redirect('/profile');
});

router.post('/profile/password', auth.requireRole('doctor', 'admin'), (req, res) => {
  const { current = '', password = '', confirm = '' } = req.body || {};
  if (!auth.verifyPassword(current, req.user.password_hash)) {
    req.session.flash = { type: 'error', text: 'Joriy parol noto\'g\'ri.' };
  } else if (String(password).length < 6) {
    req.session.flash = { type: 'error', text: 'Yangi parol kamida 6 belgidan iborat bo\'lsin.' };
  } else if (password !== confirm) {
    req.session.flash = { type: 'error', text: 'Yangi parollar mos kelmadi.' };
  } else {
    h.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(password), req.user.id);
    h.audit(req.user.id, 'password.change', 'user', req.user.id, null);
    req.session.flash = { type: 'success', text: 'Parol yangilandi.' };
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
    req.session.flash = { type: 'success', text: 'Rasm(lar) yuklandi.' };
    res.redirect('/profile');
  });

module.exports = router;
