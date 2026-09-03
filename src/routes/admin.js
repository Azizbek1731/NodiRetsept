'use strict';
const express = require('express');
const auth = require('../lib/auth');
const db = require('../lib/db');
const { h } = db;
const rxLib = require('../lib/prescriptions');
const fmt = require('../lib/format');
const upload = require('../lib/upload');
const config = require('../config');

const router = express.Router();
router.use(auth.requireAdmin);

const s = (v) => { const t = typeof v === 'string' ? v.trim() : ''; return t || null; };
const flash = (req, type, text) => { req.session.flash = { type, text }; };

const TEMPLATE_TEXT = ['clinic_name', 'clinic_subtitle', 'address', 'phone', 'email', 'website',
  'accent_color', 'header_note', 'footer_note'];
const TEMPLATE_FLAGS = ['show_logo', 'show_complaints', 'show_icd', 'show_physio',
  'show_recommendations', 'show_stamp', 'show_signature', 'show_qr'];

/** Blankani saqlash: doctorId = null bo'lsa global blanka. */
function saveTemplate(doctorId, body) {
  const values = {};
  for (const k of TEMPLATE_TEXT) values[k] = s(body[k]);
  if (values.accent_color && !/^#[0-9a-fA-F]{6}$/.test(values.accent_color)) values.accent_color = '#0e7c86';
  for (const k of TEMPLATE_FLAGS) values[k] = body[k] ? 1 : 0;
  values.updated_at = new Date().toISOString();

  const existing = doctorId
    ? h.get('SELECT id FROM blank_templates WHERE doctor_id = ?', doctorId)
    : h.get('SELECT id FROM blank_templates WHERE doctor_id IS NULL');

  const cols = Object.keys(values);
  if (existing) {
    h.run(`UPDATE blank_templates SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`,
      ...cols.map((c) => values[c]), existing.id);
    return existing.id;
  }
  const info = h.run(
    `INSERT INTO blank_templates (doctor_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`,
    doctorId, ...cols.map((c) => values[c]));
  return Number(info.lastInsertRowid);
}

/* ── Boshqaruv paneli ─────────────────────────────────────── */

router.get('/', (req, res) => {
  const stats = rxLib.stats();
  const doctors = h.all(`
    SELECT u.id, u.full_name, u.specialty, u.is_active, u.last_login_at, u.stamp_path,
           (SELECT COUNT(*) FROM prescriptions p WHERE p.doctor_id = u.id) AS rx_total,
           (SELECT COUNT(*) FROM prescriptions p WHERE p.doctor_id = u.id AND p.visit_date = date('now','localtime')) AS rx_today
    FROM users u WHERE u.role = 'doctor' ORDER BY rx_total DESC`);
  const recent = rxLib.list({ limit: 10 }).rows;
  const tg = {
    users: h.get('SELECT COUNT(*) AS n FROM telegram_users').n,
    enabled: config.telegram.enabled && !!config.telegram.token,
  };
  res.render('admin/dashboard', {
    title: 'Administrator paneli', bodyClass: 'app-page admin',
    stats, doctors, recent, tg,
    audits: h.all(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                   ORDER BY a.id DESC LIMIT 12`),
  });
});

/* ── Shifokorlar ──────────────────────────────────────────── */

router.get('/doctors', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = h.all(`
    SELECT u.*, (SELECT COUNT(*) FROM prescriptions p WHERE p.doctor_id = u.id) AS rx_total,
           (SELECT COUNT(*) FROM blank_templates t WHERE t.doctor_id = u.id) AS has_template
    FROM users u
    WHERE u.role = 'doctor' ${q ? 'AND (u.full_name LIKE ? OR u.username LIKE ? OR u.specialty LIKE ?)' : ''}
    ORDER BY u.is_active DESC, u.full_name`,
    ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []));
  res.render('admin/doctors', { title: 'Shifokorlar', bodyClass: 'app-page admin', doctors: rows, q });
});

router.get('/doctors/new', (req, res) => {
  res.render('admin/doctor-form', {
    title: 'Yangi shifokor', bodyClass: 'app-page admin',
    doctor: null, template: null, globalTemplate: rxLib.globalTemplate(), errors: [],
  });
});

router.post('/doctors', (req, res) => {
  const b = req.body || {};
  const errors = [];
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) errors.push('Login 3–32 ta lotin harfi, raqam yoki . _ - belgilaridan iborat bo\'lsin.');
  if (h.get('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', username)) errors.push('Bunday login band.');
  if (String(b.full_name || '').trim().length < 5) errors.push('Shifokorning to\'liq F.I.Sh. ni kiriting.');
  if (String(b.password || '').length < 6) errors.push('Parol kamida 6 belgidan iborat bo\'lsin.');
  if (errors.length) {
    return res.status(400).render('admin/doctor-form', {
      title: 'Yangi shifokor', bodyClass: 'app-page admin',
      doctor: { ...b, id: null }, template: null, globalTemplate: rxLib.globalTemplate(), errors,
    });
  }
  const info = h.run(
    `INSERT INTO users (role, username, password_hash, full_name, phone, specialty, license_number, clinic_name, room, is_active, created_at)
     VALUES ('doctor',?,?,?,?,?,?,?,?,?,?)`,
    username, auth.hashPassword(b.password), String(b.full_name).trim(), s(b.phone), s(b.specialty),
    s(b.license_number), s(b.clinic_name), s(b.room), b.is_active ? 1 : 1, new Date().toISOString());
  const id = Number(info.lastInsertRowid);
  h.audit(req.user.id, 'doctor.create', 'user', id, { username });
  flash(req, 'success', `Shifokor qo'shildi. Login: ${username}`);
  res.redirect(`/admin/doctors/${id}`);
});

router.get('/doctors/:id', (req, res, next) => {
  const doctor = h.get("SELECT * FROM users WHERE id = ? AND role = 'doctor'", Number(req.params.id));
  if (!doctor) return next();
  res.render('admin/doctor-form', {
    title: doctor.full_name, bodyClass: 'app-page admin',
    doctor,
    template: h.get('SELECT * FROM blank_templates WHERE doctor_id = ?', doctor.id),
    effective: rxLib.effectiveTemplate(doctor.id),
    globalTemplate: rxLib.globalTemplate(),
    stats: rxLib.stats(doctor.id),
    errors: [],
  });
});

router.post('/doctors/:id', (req, res, next) => {
  const id = Number(req.params.id);
  const doctor = h.get("SELECT * FROM users WHERE id = ? AND role = 'doctor'", id);
  if (!doctor) return next();
  const b = req.body || {};
  h.run(`UPDATE users SET full_name=?, phone=?, specialty=?, license_number=?, clinic_name=?, room=?, is_active=? WHERE id=?`,
    String(b.full_name || doctor.full_name).trim(), s(b.phone), s(b.specialty), s(b.license_number),
    s(b.clinic_name), s(b.room), b.is_active ? 1 : 0, id);
  h.audit(req.user.id, 'doctor.update', 'user', id, null);
  flash(req, 'success', 'Shifokor ma\'lumotlari yangilandi.');
  res.redirect(`/admin/doctors/${id}`);
});

router.post('/doctors/:id/password', (req, res, next) => {
  const id = Number(req.params.id);
  const doctor = h.get("SELECT id FROM users WHERE id = ? AND role = 'doctor'", id);
  if (!doctor) return next();
  const pwd = String((req.body || {}).password || '');
  if (pwd.length < 6) flash(req, 'error', 'Parol kamida 6 belgidan iborat bo\'lsin.');
  else {
    h.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(pwd), id);
    h.audit(req.user.id, 'doctor.password', 'user', id, null);
    flash(req, 'success', 'Yangi parol o\'rnatildi.');
  }
  res.redirect(`/admin/doctors/${id}`);
});

router.post('/doctors/:id/media',
  upload.stamps.fields([{ name: 'stamp', maxCount: 1 }, { name: 'signature', maxCount: 1 }]),
  (req, res, next) => {
    const id = Number(req.params.id);
    const doctor = h.get("SELECT * FROM users WHERE id = ? AND role = 'doctor'", id);
    if (!doctor) return next();
    const files = req.files || {};
    if (files.stamp && files.stamp[0]) {
      upload.remove(doctor.stamp_path);
      h.run('UPDATE users SET stamp_path = ? WHERE id = ?', upload.relPath(files.stamp[0]), id);
    }
    if (files.signature && files.signature[0]) {
      upload.remove(doctor.signature_path);
      h.run('UPDATE users SET signature_path = ? WHERE id = ?', upload.relPath(files.signature[0]), id);
    }
    h.audit(req.user.id, 'doctor.media', 'user', id, null);
    flash(req, 'success', 'Muhr/imzo yuklandi.');
    res.redirect(`/admin/doctors/${id}#blank`);
  });

router.post('/doctors/:id/media/delete', (req, res, next) => {
  const id = Number(req.params.id);
  const doctor = h.get("SELECT * FROM users WHERE id = ? AND role = 'doctor'", id);
  if (!doctor) return next();
  const kind = (req.body || {}).kind === 'signature' ? 'signature_path' : 'stamp_path';
  upload.remove(doctor[kind]);
  h.run(`UPDATE users SET ${kind} = NULL WHERE id = ?`, id);
  flash(req, 'success', 'Rasm o\'chirildi.');
  res.redirect(`/admin/doctors/${id}#blank`);
});

router.post('/doctors/:id/blank', (req, res, next) => {
  const id = Number(req.params.id);
  if (!h.get("SELECT 1 FROM users WHERE id = ? AND role = 'doctor'", id)) return next();
  saveTemplate(id, req.body || {});
  h.audit(req.user.id, 'blank.update', 'doctor', id, null);
  flash(req, 'success', 'Shifokorning shaxsiy blankasi saqlandi.');
  res.redirect(`/admin/doctors/${id}#blank`);
});

router.post('/doctors/:id/blank/reset', (req, res, next) => {
  const id = Number(req.params.id);
  if (!h.get("SELECT 1 FROM users WHERE id = ? AND role = 'doctor'", id)) return next();
  h.run('DELETE FROM blank_templates WHERE doctor_id = ?', id);
  flash(req, 'success', 'Shaxsiy blanka o\'chirildi — endi umumiy blanka ishlatiladi.');
  res.redirect(`/admin/doctors/${id}#blank`);
});

/* ── Umumiy blanka ────────────────────────────────────────── */

router.get('/blank', (req, res) => {
  res.render('admin/blank', {
    title: 'Retsept blankasi', bodyClass: 'app-page admin',
    template: rxLib.globalTemplate(),
    sample: rxLib.hydrate(h.get('SELECT * FROM prescriptions ORDER BY id DESC LIMIT 1')),
  });
});

router.post('/blank', (req, res) => {
  saveTemplate(null, req.body || {});
  h.audit(req.user.id, 'blank.update', 'global', null, null);
  flash(req, 'success', 'Umumiy blanka saqlandi.');
  res.redirect('/admin/blank');
});

router.post('/blank/logo', upload.logos.single('logo'), (req, res) => {
  const t = rxLib.globalTemplate();
  if (req.file) {
    upload.remove(t.logo_path);
    h.run('UPDATE blank_templates SET logo_path = ? WHERE id = ?', upload.relPath(req.file), t.id);
    flash(req, 'success', 'Logotip yuklandi.');
  } else if ((req.body || {}).remove) {
    upload.remove(t.logo_path);
    h.run('UPDATE blank_templates SET logo_path = NULL WHERE id = ?', t.id);
    flash(req, 'success', 'Logotip o\'chirildi.');
  }
  res.redirect('/admin/blank');
});

/* ── Bemorlar / retseptlar / bot ──────────────────────────── */

router.get('/patients', (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 25;
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const where = q ? 'WHERE (p.full_name LIKE ? OR p.phone LIKE ? OR p.code LIKE ?)' : '';
  const patients = h.all(`
    SELECT p.*, u.full_name AS creator,
           (SELECT COUNT(*) FROM prescriptions r WHERE r.patient_id = p.id) AS rx_count,
           (SELECT MAX(visit_date) FROM prescriptions r WHERE r.patient_id = p.id) AS last_visit
    FROM patients p LEFT JOIN users u ON u.id = p.created_by
    ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...params, perPage, (page - 1) * perPage);
  const total = h.get(`SELECT COUNT(*) AS n FROM patients p ${where}`, ...params).n;
  res.render('admin/patients', {
    title: 'Barcha bemorlar', bodyClass: 'app-page admin',
    patients, total, page, perPage, q,
  });
});

router.get('/prescriptions', (req, res) => {
  const q = String(req.query.q || '').trim();
  const doctorId = Number(req.query.doctor) || null;
  const from = String(req.query.from || '') || null;
  const to = String(req.query.to || '') || null;
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = 25;
  const { rows, total } = rxLib.list({
    doctorId, q, from, to, limit: perPage, offset: (page - 1) * perPage,
  });
  res.render('admin/prescriptions', {
    title: 'Barcha retseptlar', bodyClass: 'app-page admin',
    prescriptions: rows, total, page, perPage, q, from, to, doctorId,
    doctors: h.all("SELECT id, full_name FROM users WHERE role='doctor' ORDER BY full_name"),
  });
});

router.get('/telegram', (req, res) => {
  res.render('admin/telegram', {
    title: 'Telegram bot', bodyClass: 'app-page admin',
    enabled: config.telegram.enabled && !!config.telegram.token,
    tokenTail: config.telegram.token ? `…${config.telegram.token.slice(-6)}` : null,
    users: h.all('SELECT * FROM telegram_users ORDER BY id DESC LIMIT 100'),
    total: h.get('SELECT COUNT(*) AS n FROM telegram_users').n,
    sends: h.all(`SELECT a.*, p.public_id FROM access_log a LEFT JOIN prescriptions p ON p.id = a.prescription_id
                  WHERE a.channel = 'telegram' ORDER BY a.id DESC LIMIT 25`),
    botInfo: require('../telegram/bot').info(),
  });
});

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    title: 'Sozlamalar', bodyClass: 'app-page admin',
    config: {
      publicUrl: config.publicUrl, port: config.port, env: config.env,
      dbPath: config.paths.db, telegram: config.telegram.enabled && !!config.telegram.token,
    },
    counts: {
      doctors: h.get("SELECT COUNT(*) AS n FROM users WHERE role='doctor'").n,
      patients: h.get('SELECT COUNT(*) AS n FROM patients').n,
      prescriptions: h.get('SELECT COUNT(*) AS n FROM prescriptions').n,
      telegram: h.get('SELECT COUNT(*) AS n FROM telegram_users').n,
    },
    audits: h.all(`SELECT a.*, u.full_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                   ORDER BY a.id DESC LIMIT 60`),
  });
});

module.exports = router;
