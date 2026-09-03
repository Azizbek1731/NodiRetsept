'use strict';
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

for (const dir of [config.paths.data, config.paths.uploads, config.paths.stamps, config.paths.logos]) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(config.paths.db);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY,
  role                 TEXT NOT NULL CHECK (role IN ('admin','doctor')),
  username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  specialty            TEXT,
  license_number       TEXT,
  clinic_name          TEXT,
  room                 TEXT,
  stamp_path           TEXT,
  signature_path       TEXT,
  avatar_path          TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  last_login_at        TEXT
);

CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY,
  code         TEXT UNIQUE,
  full_name    TEXT NOT NULL,
  birth_year   INTEGER,
  gender       TEXT,
  phone        TEXT,
  address      TEXT,
  note         TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name);
CREATE INDEX IF NOT EXISTS idx_patients_creator ON patients(created_by);

CREATE TABLE IF NOT EXISTS prescriptions (
  id               INTEGER PRIMARY KEY,
  public_id        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  doctor_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  visit_date       TEXT NOT NULL,
  complaints       TEXT,
  diagnosis        TEXT,
  icd10            TEXT,
  physiotherapy    TEXT,
  recommendations  TEXT,
  next_visit       TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  patient_snapshot TEXT,
  doctor_snapshot  TEXT,
  view_count       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_rx_doctor ON prescriptions(doctor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_date ON prescriptions(visit_date);

CREATE TABLE IF NOT EXISTS prescription_items (
  id               INTEGER PRIMARY KEY,
  prescription_id  INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  drug_name        TEXT NOT NULL,
  brand_name       TEXT,
  form             TEXT,
  strength         TEXT,
  quantity         TEXT,
  route            TEXT,
  dose             TEXT,
  frequency        TEXT,
  duration         TEXT,
  instructions     TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_rx ON prescription_items(prescription_id, sort_order);

CREATE TABLE IF NOT EXISTS blank_templates (
  id                    INTEGER PRIMARY KEY,
  doctor_id             INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  clinic_name           TEXT,
  clinic_subtitle       TEXT,
  address               TEXT,
  phone                 TEXT,
  email                 TEXT,
  website               TEXT,
  logo_path             TEXT,
  accent_color          TEXT DEFAULT '#0e7c86',
  header_note           TEXT,
  footer_note           TEXT,
  show_logo             INTEGER NOT NULL DEFAULT 1,
  show_complaints       INTEGER NOT NULL DEFAULT 1,
  show_icd              INTEGER NOT NULL DEFAULT 1,
  show_physio           INTEGER NOT NULL DEFAULT 1,
  show_recommendations  INTEGER NOT NULL DEFAULT 1,
  show_stamp            INTEGER NOT NULL DEFAULT 1,
  show_signature        INTEGER NOT NULL DEFAULT 1,
  show_qr               INTEGER NOT NULL DEFAULT 1,
  updated_at            TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS drugs (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  form      TEXT,
  strength  TEXT,
  atc       TEXT,
  UNIQUE(name, form, strength)
);
CREATE INDEX IF NOT EXISTS idx_drugs_name ON drugs(name);

CREATE TABLE IF NOT EXISTS telegram_users (
  id           INTEGER PRIMARY KEY,
  chat_id      TEXT NOT NULL UNIQUE,
  phone        TEXT,
  first_name   TEXT,
  username     TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS access_log (
  id              INTEGER PRIMARY KEY,
  prescription_id INTEGER REFERENCES prescriptions(id) ON DELETE CASCADE,
  channel         TEXT,
  meta            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_rx ON access_log(prescription_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  expires INTEGER NOT NULL,
  data    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
`);

/** Tashqi kod uchun qulay yordamchilar */
const helpers = {
  get(sql, ...params) { return db.prepare(sql).get(...params); },
  all(sql, ...params) { return db.prepare(sql).all(...params); },
  run(sql, ...params) { return db.prepare(sql).run(...params); },
  setting(key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  },
  setSetting(key, value) {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value == null ? null : String(value));
  },
  audit(userId, action, entity, entityId, meta) {
    db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,meta,created_at) VALUES(?,?,?,?,?,?)')
      .run(userId || null, action, entity || null, entityId == null ? null : String(entityId),
           meta ? JSON.stringify(meta) : null, new Date().toISOString());
  },
};

module.exports = Object.assign(db, { helpers });
module.exports.db = db;
module.exports.h = helpers;
