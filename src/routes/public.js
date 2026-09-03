'use strict';
const express = require('express');
const rxLib = require('../lib/prescriptions');
const pdfLib = require('../lib/pdf');
const qr = require('../lib/qr');
const ids = require('../lib/ids');
const db = require('../lib/db');
const { h } = db;

module.exports = function publicRoutes(lookupLimiter) {
  const router = express.Router();

  // Bosh sahifa — bemorlar uchun qidiruv
  router.get('/', (req, res) => {
    if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
    res.render('public/home', {
      title: 'NodiRetsept — retseptni onlayn tekshirish',
      bodyClass: 'public-page',
      notFound: req.query.notfound ? String(req.query.q || '') : null,
    });
  });

  // ID bo'yicha qidiruv
  router.get('/search', lookupLimiter, (req, res) => {
    const raw = String(req.query.id || req.query.q || '').trim();
    const normalized = ids.normalizeId(raw);
    if (!normalized || normalized.length < 6) {
      return res.redirect(`/?notfound=1&q=${encodeURIComponent(raw)}`);
    }
    const found = h.get('SELECT public_id FROM prescriptions WHERE public_id = ? COLLATE NOCASE', normalized);
    if (!found) return res.redirect(`/?notfound=1&q=${encodeURIComponent(raw)}`);
    res.redirect(`/r/${found.public_id}`);
  });

  // QR skaner sahifasi
  router.get('/scan', (req, res) => {
    res.render('public/scan', { title: 'QR kodni skanerlash', bodyClass: 'public-page' });
  });

  // Retseptni ommaviy ko'rish
  router.get('/r/:publicId', lookupLimiter, async (req, res, next) => {
    try {
      const rx = rxLib.getByPublicId(req.params.publicId);
      if (!rx) {
        return res.status(404).render('public/not-found', {
          title: 'Retsept topilmadi', bodyClass: 'public-page',
          q: String(req.params.publicId || ''),
        });
      }
      h.run('UPDATE prescriptions SET view_count = view_count + 1 WHERE id = ?', rx.id);
      h.run('INSERT INTO access_log (prescription_id, channel, meta, created_at) VALUES (?,?,?,?)',
        rx.id, req.user ? 'staff' : 'web',
        JSON.stringify({ ua: String(req.get('user-agent') || '').slice(0, 180) }), new Date().toISOString());

      rx.url = qr.prescriptionUrl(rx.public_id);
      rx.qrDataUrl = await qr.toDataUrl(rx.url, { width: 320 });
      res.render('public/prescription', {
        title: `Retsept ${rx.pretty_id}`,
        bodyClass: 'public-page rx-page',
        rx,
        isStaff: !!req.user,
      });
    } catch (e) { next(e); }
  });

  // PDF yuklab olish
  router.get('/r/:publicId/pdf', lookupLimiter, async (req, res, next) => {
    try {
      const rx = rxLib.getByPublicId(req.params.publicId);
      if (!rx) return res.status(404).render('public/not-found', {
        title: 'Retsept topilmadi', bodyClass: 'public-page', q: String(req.params.publicId || ''),
      });
      const buf = await pdfLib.buildPrescriptionPdf(rx);
      h.run('INSERT INTO access_log (prescription_id, channel, meta, created_at) VALUES (?,?,?,?)',
        rx.id, 'pdf', null, new Date().toISOString());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `${req.query.inline ? 'inline' : 'attachment'}; filename="${pdfLib.fileName(rx)}"; filename*=UTF-8''${encodeURIComponent(pdfLib.fileName(rx))}`);
      res.setHeader('Content-Length', buf.length);
      res.end(buf);
    } catch (e) { next(e); }
  });

  // QR kod rasmi (PNG)
  router.get('/r/:publicId/qr.png', lookupLimiter, async (req, res, next) => {
    try {
      const id = ids.normalizeId(req.params.publicId);
      const found = h.get('SELECT public_id FROM prescriptions WHERE public_id = ? COLLATE NOCASE', id);
      if (!found) return res.status(404).end();
      const buf = await qr.toBuffer(qr.prescriptionUrl(found.public_id), {
        width: Math.min(1024, Math.max(128, Number(req.query.size) || 512)),
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(buf);
    } catch (e) { next(e); }
  });

  // Qisqa havola (QR kodga sig'ishi uchun) — /q/NR-XXXX
  router.get('/q/:publicId', (req, res) => res.redirect(`/r/${req.params.publicId}`));

  return router;
};
