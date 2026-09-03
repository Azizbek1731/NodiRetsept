'use strict';
const express = require('express');
const auth = require('../lib/auth');
const db = require('../lib/db');
const { h } = db;
const rxLib = require('../lib/prescriptions');
const qr = require('../lib/qr');
const ids = require('../lib/ids');
const fmt = require('../lib/format');

const router = express.Router();
router.use(auth.requireAuth);

const ok = (res, data = {}) => res.json({ ok: true, ...data });
const bad = (res, error, code = 400) => res.status(code).json({ ok: false, error });
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/* ── Bemorlar ─────────────────────────────────────────────── */

router.get('/patients/search', (req, res) => {
  const q = str(req.query.q);
  const scope = req.query.scope === 'all' || req.user.role === 'admin' ? 'all' : 'mine';
  const params = [];
  let where = '1=1';
  if (q) {
    where += ' AND (p.full_name LIKE ? OR p.phone LIKE ? OR p.code LIKE ? OR CAST(p.birth_year AS TEXT) LIKE ?)';
    params.push(`%${q}%`, `%${q.replace(/\D/g, '')}%`, `%${q}%`, `%${q}%`);
  }
  if (scope === 'mine') {
    where += ` AND (p.created_by = ? OR EXISTS (SELECT 1 FROM prescriptions r WHERE r.patient_id = p.id AND r.doctor_id = ?))`;
    params.push(req.user.id, req.user.id);
  }
  const rows = h.all(
    `SELECT p.*, (SELECT COUNT(*) FROM prescriptions r WHERE r.patient_id = p.id) AS rx_count,
            (SELECT MAX(visit_date) FROM prescriptions r WHERE r.patient_id = p.id) AS last_visit
     FROM patients p WHERE ${where}
     ORDER BY (last_visit IS NULL), last_visit DESC, p.full_name LIMIT 25`, ...params);
  ok(res, {
    patients: rows.map((p) => ({
      ...p, age: fmt.age(p.birth_year), phone_fmt: fmt.phoneFmt(p.phone),
    })),
  });
});

router.post('/patients', (req, res) => {
  const b = req.body || {};
  const full_name = str(b.full_name);
  if (full_name.length < 3) return bad(res, req.t('err.patientName'));
  const year = b.birth_year ? Number(b.birth_year) : null;
  const cy = new Date().getFullYear();
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > cy)) {
    return bad(res, req.t('err.birthYear', { year: cy }));
  }
  const dup = h.get('SELECT id FROM patients WHERE full_name = ? COLLATE NOCASE AND IFNULL(birth_year,0) = IFNULL(?,0)',
    full_name, year);
  if (dup && !b.force) {
    return res.status(409).json({
      ok: false, duplicate: true, patient_id: dup.id,
      error: req.t('err.patientDuplicate'),
    });
  }
  const now = new Date().toISOString();
  const info = h.run(
    `INSERT INTO patients (full_name, birth_year, gender, phone, address, note, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    full_name, year, str(b.gender) || null, str(b.phone) || null,
    str(b.address) || null, str(b.note) || null, req.user.id, now, now);
  const id = Number(info.lastInsertRowid);
  h.run('UPDATE patients SET code = ? WHERE id = ?', ids.patientCode(id), id);
  h.audit(req.user.id, 'patient.create', 'patient', id, { full_name });
  const patient = h.get('SELECT * FROM patients WHERE id = ?', id);
  ok(res, { patient: { ...patient, age: fmt.age(patient.birth_year), rx_count: 0 } });
});

router.put('/patients/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = h.get('SELECT * FROM patients WHERE id = ?', id);
  if (!p) return bad(res, req.t('err.patientNotFound'), 404);
  const b = req.body || {};
  const full_name = str(b.full_name) || p.full_name;
  const year = b.birth_year === '' ? null : (b.birth_year != null ? Number(b.birth_year) : p.birth_year);
  h.run(`UPDATE patients SET full_name=?, birth_year=?, gender=?, phone=?, address=?, note=?, updated_at=? WHERE id=?`,
    full_name, year, str(b.gender) || null, str(b.phone) || null,
    str(b.address) || null, str(b.note) || null, new Date().toISOString(), id);
  h.audit(req.user.id, 'patient.update', 'patient', id, null);
  ok(res, { patient: h.get('SELECT * FROM patients WHERE id = ?', id) });
});

/* ── Dori ma'lumotnomasi ──────────────────────────────────── */

router.get('/drugs', (req, res) => {
  const q = str(req.query.q);
  const rows = q
    ? h.all(`SELECT * FROM drugs WHERE name LIKE ? ORDER BY (name LIKE ?) DESC, name LIMIT 12`,
        `%${q}%`, `${q}%`)
    : h.all('SELECT * FROM drugs ORDER BY name LIMIT 12');
  ok(res, { drugs: rows });
});

/* ── Retseptlar ───────────────────────────────────────────── */

function canTouch(user, rx) {
  return user.role === 'admin' || rx.doctor_id === user.id;
}

function readPayload(body, user) {
  const b = body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  return {
    doctor_id: user.role === 'admin' && b.doctor_id ? Number(b.doctor_id) : user.id,
    patient_id: Number(b.patient_id),
    visit_date: /^\d{4}-\d{2}-\d{2}$/.test(str(b.visit_date)) ? str(b.visit_date) : fmt.toISODate(),
    complaints: str(b.complaints),
    diagnosis: str(b.diagnosis),
    icd10: str(b.icd10).toUpperCase(),
    physiotherapy: str(b.physiotherapy),
    recommendations: str(b.recommendations),
    next_visit: /^\d{4}-\d{2}-\d{2}$/.test(str(b.next_visit)) ? str(b.next_visit) : null,
    items: items.map((it) => ({
      drug_name: str(it.drug_name), brand_name: str(it.brand_name), form: str(it.form),
      strength: str(it.strength), quantity: str(it.quantity), route: str(it.route),
      dose: str(it.dose), frequency: str(it.frequency), duration: str(it.duration),
      instructions: str(it.instructions),
    })).filter((it) => it.drug_name),
  };
}

function validate(data, t) {
  if (!data.patient_id) return t('err.selectPatient');
  if (!h.get('SELECT 1 FROM patients WHERE id = ?', data.patient_id)) return t('err.patientNotFound');
  if (!data.diagnosis) return t('err.enterDiagnosis');
  if (!data.items.length && !data.physiotherapy) return t('err.needDrugOrPhysio');
  const cy = new Date().getFullYear();
  const y = Number(data.visit_date.slice(0, 4));
  if (y < cy - 5 || y > cy + 1) return t('err.badDate');
  return null;
}

router.post('/prescriptions', auth.requireStaff, async (req, res, next) => {
  try {
    const data = readPayload(req.body, req.user);
    const err = validate(data, req.t);
    if (err) return bad(res, err);
    const created = rxLib.create(data);
    h.audit(req.user.id, 'rx.create', 'prescription', created.public_id, { patient_id: data.patient_id });
    const url = qr.prescriptionUrl(created.public_id);
    ok(res, {
      id: created.id,
      public_id: created.public_id,
      pretty_id: ids.prettyId(created.public_id),
      url,
      qr: await qr.toDataUrl(url, { width: 320 }),
      view_path: `/r/${created.public_id}`,
      pdf_path: `/r/${created.public_id}/pdf`,
    });
  } catch (e) { next(e); }
});

router.get('/prescriptions/:id', auth.requireStaff, (req, res) => {
  const rx = rxLib.getById(Number(req.params.id));
  if (!rx) return bad(res, req.t('err.rxNotFound'), 404);
  if (!canTouch(req.user, rx)) return bad(res, req.t('err.noAccess'), 403);
  ok(res, {
    prescription: {
      id: rx.id, public_id: rx.public_id, pretty_id: rx.pretty_id, patient_id: rx.patient_id,
      patient: { id: rx.patient.id, full_name: rx.patient.full_name, birth_year: rx.patient.birth_year,
                 gender: rx.patient.gender, phone: rx.patient.phone, code: rx.patient.code },
      visit_date: rx.visit_date, complaints: rx.complaints, diagnosis: rx.diagnosis, icd10: rx.icd10,
      physiotherapy: rx.physiotherapy, recommendations: rx.recommendations, next_visit: rx.next_visit,
      status: rx.status, items: rx.items,
    },
  });
});

router.put('/prescriptions/:id', auth.requireStaff, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = rxLib.getById(id);
    if (!existing) return bad(res, req.t('err.rxNotFound'), 404);
    if (!canTouch(req.user, existing)) return bad(res, req.t('err.noAccess'), 403);
    const data = readPayload(req.body, req.user);
    const err = validate(data, req.t);
    if (err) return bad(res, err);
    rxLib.update(id, data);
    h.audit(req.user.id, 'rx.update', 'prescription', existing.public_id, null);
    ok(res, {
      id, public_id: existing.public_id, pretty_id: existing.pretty_id,
      view_path: `/r/${existing.public_id}`, pdf_path: `/r/${existing.public_id}/pdf`,
      url: qr.prescriptionUrl(existing.public_id),
      qr: await qr.toDataUrl(qr.prescriptionUrl(existing.public_id), { width: 320 }),
    });
  } catch (e) { next(e); }
});

router.post('/prescriptions/:id/status', auth.requireStaff, (req, res) => {
  const id = Number(req.params.id);
  const rx = rxLib.getById(id);
  if (!rx) return bad(res, req.t('err.rxNotFound'), 404);
  if (!canTouch(req.user, rx)) return bad(res, req.t('err.noAccess'), 403);
  const status = req.body && req.body.status === 'active' ? 'active' : 'cancelled';
  h.run('UPDATE prescriptions SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), id);
  h.audit(req.user.id, 'rx.status', 'prescription', rx.public_id, { status });
  ok(res, { status });
});

module.exports = router;
