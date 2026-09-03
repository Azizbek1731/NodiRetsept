'use strict';
const db = require('./db');
const { h } = db;
const ids = require('./ids');
const fmt = require('./format');

const DEFAULT_TEMPLATE = {
  clinic_name: 'NodiRetsept klinikasi',
  clinic_subtitle: 'Ko\'p tarmoqli tibbiyot markazi',
  address: '',
  phone: '',
  email: '',
  website: '',
  logo_path: null,
  accent_color: '#0e7c86',
  header_note: '',
  footer_note: 'Ushbu retsept elektron shaklda rasmiylashtirilgan va QR kod orqali tekshiriladi.',
  show_logo: 1, show_complaints: 1, show_icd: 1, show_physio: 1,
  show_recommendations: 1, show_stamp: 1, show_signature: 1, show_qr: 1,
};

/** Global blanka (doctor_id IS NULL). Bo'lmasa — yaratamiz. */
function globalTemplate() {
  let t = h.get('SELECT * FROM blank_templates WHERE doctor_id IS NULL');
  if (!t) {
    const cols = Object.keys(DEFAULT_TEMPLATE);
    h.run(
      `INSERT INTO blank_templates (doctor_id, ${cols.join(',')}, updated_at)
       VALUES (NULL, ${cols.map(() => '?').join(',')}, ?)`,
      ...cols.map((c) => DEFAULT_TEMPLATE[c]), new Date().toISOString()
    );
    t = h.get('SELECT * FROM blank_templates WHERE doctor_id IS NULL');
  }
  return t;
}

/** Shifokorning shaxsiy blankasi (bo'lsa) global blanka ustiga qo'yiladi. */
function effectiveTemplate(doctorId) {
  const base = { ...DEFAULT_TEMPLATE, ...globalTemplate() };
  if (!doctorId) return base;
  const own = h.get('SELECT * FROM blank_templates WHERE doctor_id = ?', doctorId);
  if (!own) return base;
  const merged = { ...base };
  for (const [k, v] of Object.entries(own)) {
    if (k === 'id' || k === 'doctor_id') continue;
    if (v === null || v === undefined || v === '') continue;
    merged[k] = v;
  }
  // 0/1 bayroqlar shaxsiy blankada aniq belgilangan bo'lsa, ular ustun turadi.
  for (const k of Object.keys(own)) {
    if (k.startsWith('show_') && own[k] !== null && own[k] !== undefined) merged[k] = own[k];
  }
  merged.id = own.id;
  merged.doctor_id = doctorId;
  merged.is_custom = true;
  return merged;
}

function itemsOf(prescriptionId) {
  return h.all('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id', prescriptionId);
}

/**
 * Retsept yozilgan paytdagi ma'lumotlar (snapshot) ustun turadi — tarixiy aniqlik shu bilan saqlanadi.
 * Ammo snapshotda bo'sh qolgan maydonlar joriy yozuvdan olinadi: masalan pechat retsept
 * yozilgandan keyin yuklangan bo'lsa ham blankada ko'rinadi.
 */
function mergeSnapshot(current, snap) {
  const out = { ...current };
  for (const [k, v] of Object.entries(snap || {})) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

/** Retseptni bemor + shifokor + dorilar + blanka bilan to'ldiradi. */
function hydrate(rx) {
  if (!rx) return null;
  const patient = h.get('SELECT * FROM patients WHERE id = ?', rx.patient_id) || {};
  const doctor = h.get('SELECT * FROM users WHERE id = ?', rx.doctor_id) || {};
  return {
    ...rx,
    pretty_id: ids.prettyId(rx.public_id),
    items: itemsOf(rx.id),
    patient: { ...mergeSnapshot(patient, safeJson(rx.patient_snapshot)), id: patient.id ?? rx.patient_id },
    doctor: { ...mergeSnapshot(doctor, safeJson(rx.doctor_snapshot)), id: doctor.id ?? rx.doctor_id },
    template: effectiveTemplate(rx.doctor_id),
    url: null, // marshrutlarda to'ldiriladi
  };
}

function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

function getByPublicId(publicId) {
  const id = ids.normalizeId(publicId);
  if (!id) return null;
  return hydrate(h.get('SELECT * FROM prescriptions WHERE public_id = ? COLLATE NOCASE', id));
}

function getById(id) {
  return hydrate(h.get('SELECT * FROM prescriptions WHERE id = ?', id));
}

/** Dorining xalqaro ko'rinishdagi "Rp." satrlari */
function rxLines(item) {
  const head = [item.drug_name, item.strength].filter(Boolean).join(' ');
  const dtd = [];
  if (item.quantity) dtd.push(`D.t.d. N. ${String(item.quantity).replace(/^N\.?\s*/i, '')}`);
  if (item.form) dtd.push(`in ${item.form}`);
  const sig = [];
  if (item.dose) sig.push(item.dose);
  if (item.route) sig.push(item.route);
  if (item.frequency) sig.push(item.frequency);
  if (item.duration) sig.push(item.duration);
  if (item.instructions) sig.push(item.instructions);
  return {
    head: head + (item.brand_name ? ` (${item.brand_name})` : ''),
    dtd: dtd.join(' '),
    sig: sig.join(', '),
  };
}

const nn = (v) => (v === undefined || v === null || v === '' ? null : String(v).trim());
const ni = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

function snapshotPatient(p) {
  return JSON.stringify({
    full_name: p.full_name, birth_year: p.birth_year, gender: p.gender,
    phone: p.phone, address: p.address, code: p.code,
  });
}
function snapshotDoctor(d) {
  return JSON.stringify({
    full_name: d.full_name, phone: d.phone, specialty: d.specialty,
    license_number: d.license_number, clinic_name: d.clinic_name,
    stamp_path: d.stamp_path, signature_path: d.signature_path,
  });
}

const idExists = (id) => !!h.get('SELECT 1 FROM prescriptions WHERE public_id = ?', id);

/** Yangi retsept yaratish (dorilar bilan bitta tranzaksiyada) */
const create = db.transaction((data) => {
  const now = new Date().toISOString();
  const publicId = ids.newPrescriptionId(idExists);
  const patient = h.get('SELECT * FROM patients WHERE id = ?', data.patient_id);
  const doctor = h.get('SELECT * FROM users WHERE id = ?', data.doctor_id);
  if (!patient) throw new Error('Bemor topilmadi');
  if (!doctor) throw new Error('Shifokor topilmadi');

  const info = h.run(
    `INSERT INTO prescriptions
      (public_id, doctor_id, patient_id, visit_date, complaints, diagnosis, icd10,
       physiotherapy, recommendations, next_visit, status, patient_snapshot, doctor_snapshot, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)`,
    publicId, data.doctor_id, data.patient_id, data.visit_date || fmt.toISODate(),
    nn(data.complaints), nn(data.diagnosis), nn(data.icd10), nn(data.physiotherapy),
    nn(data.recommendations), nn(data.next_visit),
    snapshotPatient(patient), snapshotDoctor(doctor), now, now
  );
  saveItems(info.lastInsertRowid, data.items || []);
  return { id: Number(info.lastInsertRowid), public_id: publicId };
});

/** Mavjud retseptni tahrirlash */
const update = db.transaction((id, data) => {
  const now = new Date().toISOString();
  h.run(
    `UPDATE prescriptions SET visit_date=?, complaints=?, diagnosis=?, icd10=?,
       physiotherapy=?, recommendations=?, next_visit=?, updated_at=? WHERE id=?`,
    data.visit_date || fmt.toISODate(), nn(data.complaints), nn(data.diagnosis), nn(data.icd10),
    nn(data.physiotherapy), nn(data.recommendations), nn(data.next_visit), now, id
  );
  if (data.patient_id) {
    const patient = h.get('SELECT * FROM patients WHERE id = ?', data.patient_id);
    if (patient) {
      h.run('UPDATE prescriptions SET patient_id=?, patient_snapshot=? WHERE id=?',
        data.patient_id, snapshotPatient(patient), id);
    }
  }
  if (Array.isArray(data.items)) {
    h.run('DELETE FROM prescription_items WHERE prescription_id = ?', id);
    saveItems(id, data.items);
  }
  return { id };
});

function saveItems(rxId, items) {
  const stmt = db.prepare(
    `INSERT INTO prescription_items
      (prescription_id, sort_order, drug_name, brand_name, form, strength, quantity, route, dose, frequency, duration, instructions)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  let order = 0;
  for (const it of items) {
    const name = nn(it.drug_name);
    if (!name) continue;
    stmt.run(rxId, order++, name, nn(it.brand_name), nn(it.form), nn(it.strength),
      nn(it.quantity), nn(it.route), nn(it.dose), nn(it.frequency), nn(it.duration), nn(it.instructions));
  }
}

/** Retseptlar ro'yxati (filtrlar bilan) */
function list({ doctorId = null, patientId = null, q = '', from = null, to = null, status = null,
                limit = 25, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (doctorId) { where.push('p.doctor_id = ?'); params.push(doctorId); }
  if (patientId) { where.push('p.patient_id = ?'); params.push(patientId); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (from) { where.push('p.visit_date >= ?'); params.push(from); }
  if (to) { where.push('p.visit_date <= ?'); params.push(to); }
  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    where.push('(p.public_id LIKE ? OR pt.full_name LIKE ? OR p.diagnosis LIKE ?)');
    params.push(term.replace(/[\s-]/g, '%'), term, term);
  }
  const sql = `
    SELECT p.*, pt.full_name AS patient_name, pt.birth_year, pt.code AS patient_code,
           u.full_name AS doctor_name, u.specialty AS doctor_specialty,
           (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = p.id) AS item_count
    FROM prescriptions p
    JOIN patients pt ON pt.id = p.patient_id
    JOIN users u ON u.id = p.doctor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.visit_date DESC, p.id DESC
    LIMIT ? OFFSET ?`;
  const rows = h.all(sql, ...params, limit, offset).map((r) => ({ ...r, pretty_id: ids.prettyId(r.public_id) }));
  const total = h.get(`SELECT COUNT(*) AS n FROM prescriptions p
     JOIN patients pt ON pt.id = p.patient_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params).n;
  return { rows, total };
}

/** Kunlik / haftalik / oylik hisobotlar */
function stats(doctorId = null) {
  const cond = doctorId ? 'AND doctor_id = ?' : '';
  const p = doctorId ? [doctorId] : [];
  const today = fmt.toISODate();
  const d = new Date();
  const weekStart = fmt.toISODate(fmt.addDays(d, -((d.getDay() + 6) % 7)));      // dushanba
  const prevWeekStart = fmt.toISODate(fmt.addDays(fmt.parseISODate(weekStart), -7));
  const monthStart = fmt.toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const prevMonthStart = fmt.toISODate(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const yesterday = fmt.toISODate(fmt.addDays(d, -1));

  const count = (from, to) =>
    h.get(`SELECT COUNT(*) AS n FROM prescriptions WHERE status='active' AND visit_date >= ? AND visit_date <= ? ${cond}`,
      from, to, ...p).n;

  const daily = count(today, today);
  const weekly = count(weekStart, today);
  const monthly = count(monthStart, today);

  // 14 kunlik grafik
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const day = fmt.toISODate(fmt.addDays(d, -i));
    series.push({ date: day, label: fmt.dmy(day).slice(0, 5), value: count(day, day) });
  }
  // 6 oylik grafik
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const mStart = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const mEnd = new Date(d.getFullYear(), d.getMonth() - i + 1, 0);
    months.push({
      label: fmt.MONTHS_UZ[mStart.getMonth()].slice(0, 3),
      value: count(fmt.toISODate(mStart), fmt.toISODate(mEnd)),
    });
  }

  const patientsCond = doctorId ? 'WHERE created_by = ?' : '';
  const totalPatients = h.get(`SELECT COUNT(*) AS n FROM patients ${patientsCond}`, ...p).n;
  const newPatientsMonth = h.get(
    `SELECT COUNT(*) AS n FROM patients WHERE date(created_at) >= ? ${doctorId ? 'AND created_by = ?' : ''}`,
    monthStart, ...p).n;
  const totalRx = h.get(`SELECT COUNT(*) AS n FROM prescriptions WHERE status='active' ${doctorId ? 'AND doctor_id = ?' : ''}`, ...p).n;

  const topDiagnoses = h.all(
    `SELECT diagnosis, COUNT(*) AS n FROM prescriptions
     WHERE status='active' AND diagnosis IS NOT NULL AND diagnosis <> '' AND visit_date >= ? ${cond}
     GROUP BY lower(diagnosis) ORDER BY n DESC LIMIT 5`, monthStart, ...p);

  const topDrugs = h.all(
    `SELECT i.drug_name, COUNT(*) AS n FROM prescription_items i
     JOIN prescriptions p2 ON p2.id = i.prescription_id
     WHERE p2.status='active' AND p2.visit_date >= ? ${doctorId ? 'AND p2.doctor_id = ?' : ''}
     GROUP BY lower(i.drug_name) ORDER BY n DESC LIMIT 5`, monthStart, ...p);

  const views = h.get(
    `SELECT COALESCE(SUM(view_count),0) AS n FROM prescriptions WHERE 1=1 ${cond}`, ...p).n;

  const diff = (cur, prev) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));

  return {
    daily, weekly, monthly, totalRx, totalPatients, newPatientsMonth, views,
    dailyPrev: count(yesterday, yesterday),
    weeklyPrev: count(prevWeekStart, fmt.toISODate(fmt.addDays(fmt.parseISODate(weekStart), -1))),
    monthlyPrev: count(prevMonthStart, fmt.toISODate(new Date(d.getFullYear(), d.getMonth(), 0))),
    get dailyDiff() { return diff(this.daily, this.dailyPrev); },
    get weeklyDiff() { return diff(this.weekly, this.weeklyPrev); },
    get monthlyDiff() { return diff(this.monthly, this.monthlyPrev); },
    series, months, topDiagnoses, topDrugs,
    periods: { today, weekStart, monthStart },
  };
}

module.exports = {
  DEFAULT_TEMPLATE, globalTemplate, effectiveTemplate, hydrate, getByPublicId, getById,
  create, update, list, stats, rxLines, itemsOf, snapshotDoctor, snapshotPatient, mergeSnapshot,
};
