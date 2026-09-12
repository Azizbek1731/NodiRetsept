'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { removeBackground } = require('./image');

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
        const msg = (req.t ? req.t('err.onlyImages') : 'Only PNG or JPG images are allowed.');
        return cb(Object.assign(new Error(msg), { status: 400, expose: true }));
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

/**
 * Pechat va imzo uchun: oq fonni shaffofga aylantirib, PNG qilib saqlaydi.
 * Shifokorlar odatda telefonda suratga oladi — JPEG da shaffoflik yo'q va
 * pechatning oq to'rtburchagi ostidagi imzoni yopib qo'yadi.
 * Fonni tozalab bo'lmasa, asl fayl o'z holicha qoladi.
 */
function processInk(file) {
  if (!file) return null;
  const out = file.path.replace(/\.[^.]+$/, '') + '-clean.png';
  try {
    const res = removeBackground(file.path, out);
    if (!res.changed) return relPath(file);
    try { fs.unlinkSync(file.path); } catch { /* asl fayl qolsa ham mayli */ }
    return path.relative(config.paths.data, out).split(path.sep).join('/');
  } catch (e) {
    try { fs.unlinkSync(out); } catch { /* yarim yozilgan fayl bo'lmasligi ham mumkin */ }
    console.error('[rasm] fonni tozalab bo\'lmadi:', e.message);
    return relPath(file);
  }
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
  relPath, remove, processInk,
};
