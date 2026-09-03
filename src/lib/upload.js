'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

// Faqat PNG va JPEG — PDF hujjatga ham xuddi shu rasmlar joylanadi.
const ALLOWED = new Set(['image/png', 'image/jpeg']);
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg' };

function makeUploader(subdir) {
  const dest = path.join(config.paths.uploads, subdir);
  fs.mkdirSync(dest, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dest),
      filename: (req, file, cb) => {
        const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${EXT[file.mimetype] || '.png'}`;
        cb(null, name);
      },
    }),
    limits: { fileSize: 3 * 1024 * 1024, files: 2 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) {
        return cb(Object.assign(new Error('Faqat PNG yoki JPG rasm yuklash mumkin (PDF blankaga ham shu rasm joylanadi).'), { status: 400, expose: true }));
      }
      cb(null, true);
    },
  });
}

/** Bazada saqlanadigan nisbiy yo'l: uploads/stamps/xxx.png */
function relPath(file) {
  if (!file) return null;
  return path.relative(config.paths.data, file.path).split(path.sep).join('/');
}

/** Eski faylni o'chirish (data papkasidan tashqariga chiqmaydi) */
function remove(rel) {
  if (!rel) return;
  const abs = path.resolve(config.paths.data, rel);
  if (!abs.startsWith(path.resolve(config.paths.uploads))) return;
  try { fs.unlinkSync(abs); } catch { /* — */ }
}

module.exports = {
  stamps: makeUploader('stamps'),
  logos: makeUploader('logos'),
  relPath, remove,
};
