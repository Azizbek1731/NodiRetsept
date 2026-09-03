'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const ROOT = path.join(__dirname, '..');

function bool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return ['1', 'true', 'yes', 'on', 'ha'].includes(String(v).toLowerCase());
}

const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'nodiretsept-dev-secret',
  paths: {
    data: path.join(ROOT, 'data'),
    db: path.join(ROOT, 'data', 'nodiretsept.db'),
    uploads: path.join(ROOT, 'data', 'uploads'),
    stamps: path.join(ROOT, 'data', 'uploads', 'stamps'),
    logos: path.join(ROOT, 'data', 'uploads', 'logos'),
    public: path.join(ROOT, 'public'),
    views: path.join(ROOT, 'views'),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    enabled: bool(process.env.TELEGRAM_ENABLED, true),
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    name: process.env.ADMIN_NAME || 'Tizim Administratori',
  },
};

module.exports = config;
