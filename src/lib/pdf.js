'use strict';
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../config');
const fmt = require('./format');
const qr = require('./qr');
const { rxLines } = require('./prescriptions');

const FONTS = path.join(config.root, 'assets', 'fonts');
const F = {
  regular: path.join(FONTS, 'DejaVuSans.ttf'),
  bold: path.join(FONTS, 'DejaVuSans-Bold.ttf'),
  italic: path.join(FONTS, 'DejaVuSans-Oblique.ttf'),
  serifBold: path.join(FONTS, 'DejaVuSerif-Bold.ttf'),
};

const INK = '#16232b';
const MUTED = '#6b7f8a';
const LINE = '#d9e3e8';
const SOFT = '#f5f9fa';
const M = 40;                       // chekka bo'shliq
const PAGE = { w: 595.28, h: 841.89 };
const CW = PAGE.w - M * 2;          // matn kengligi

function hex(c, fallback = '#0e7c86') {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : fallback;
}
function imgPath(p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(config.paths.data, p.replace(/^\/+/, ''));
  return fs.existsSync(abs) ? abs : null;
}
function truthy(v) { return v === 1 || v === '1' || v === true; }

/**
 * Retsept PDF hujjatini yaratadi va Buffer qaytaradi.
 * Blanka xalqaro retsept qoidalariga muvofiq: Rp. — Inscriptio — D.t.d. — Signatura.
 */
async function buildPrescriptionPdf(rx) {
  const t = rx.template || {};
  const accent = hex(t.accent_color);
  const qrFile = truthy(t.show_qr)
    ? await qr.toBuffer(qr.prescriptionUrl(rx.public_id), { width: 320 }).catch(() => null)
    : null;
  const logo = truthy(t.show_logo) ? imgPath(t.logo_path) : null;
  const stamp = truthy(t.show_stamp) ? imgPath(rx.doctor.stamp_path) : null;
  const sign = truthy(t.show_signature) ? imgPath(rx.doctor.signature_path) : null;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M, bottom: 64, left: M, right: M },
    bufferPages: true,
    info: {
      Title: `Retsept ${rx.pretty_id}`,
      Author: rx.doctor.full_name || 'NodiRetsept',
      Subject: 'Tibbiy retsept / Medical prescription',
      Creator: 'NodiRetsept',
    },
  });
  doc.registerFont('body', F.regular);
  doc.registerFont('bold', F.bold);
  doc.registerFont('italic', F.italic);
  doc.registerFont('serif', F.serifBold);

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  // Keyingi sahifalar uchun ixcham sarlavha
  doc.on('pageAdded', () => {
    doc.rect(0, 0, PAGE.w, 4).fill(accent);
    doc.font('bold').fontSize(9).fillColor(MUTED)
      .text(`${t.clinic_name || ''} — Retsept ${rx.pretty_id} (davomi)`, M, 18, { width: CW });
    doc.moveTo(M, 34).lineTo(PAGE.w - M, 34).lineWidth(0.5).stroke(LINE);
    doc.y = 46;
    doc.fillColor(INK);
  });

  drawHeader(doc, rx, { accent, logo, qrFile });
  drawTitleBar(doc, rx, accent);
  drawPatient(doc, rx, accent);
  if (truthy(t.show_complaints) && rx.complaints) {
    block(doc, 'SHIKOYATLAR', rx.complaints, accent);
  }
  drawDiagnosis(doc, rx, accent);
  drawRx(doc, rx, accent);
  if (truthy(t.show_physio) && rx.physiotherapy) {
    block(doc, 'FIZIOTERAPIYA VA MUOLAJALAR', rx.physiotherapy, accent);
  }
  if (truthy(t.show_recommendations) && (rx.recommendations || rx.next_visit)) {
    const text = [rx.recommendations, rx.next_visit ? `Keyingi qabul sanasi: ${fmt.dmy(rx.next_visit)}` : '']
      .filter(Boolean).join('\n');
    block(doc, 'TAVSIYALAR', text, accent);
  }
  drawDoctor(doc, rx, { accent, stamp, sign });
  drawFooters(doc, rx, accent);

  doc.end();
  return done;
}

/* ── Bo'limlar ──────────────────────────────────────────── */

function drawHeader(doc, rx, { accent, logo, qrFile }) {
  const t = rx.template;
  doc.rect(0, 0, PAGE.w, 6).fill(accent);

  let x = M;
  const top = 24;
  if (logo) {
    try { doc.image(logo, x, top, { fit: [52, 52], align: 'center', valign: 'center' }); x += 64; }
    catch { /* rasm buzuq bo'lsa — o'tkazib yuboramiz */ }
  }
  const rightBlock = qrFile ? 96 : 150;
  const w = PAGE.w - M - rightBlock - x;

  doc.fillColor(INK).font('bold').fontSize(15)
    .text(t.clinic_name || 'Klinika', x, top, { width: w, lineGap: 1 });
  if (t.clinic_subtitle) {
    doc.font('body').fontSize(8.5).fillColor(MUTED).text(t.clinic_subtitle, x, doc.y + 1, { width: w });
  }
  const contacts = [t.address, fmt.phoneFmt(t.phone), t.email, t.website].filter(Boolean).join('  ·  ');
  if (contacts) {
    doc.font('body').fontSize(7.5).fillColor(MUTED).text(contacts, x, doc.y + 2, { width: w });
  }

  if (qrFile) {
    const qx = PAGE.w - M - 74;
    try { doc.image(qrFile, qx, top - 4, { fit: [74, 74] }); } catch { /* — */ }
    doc.font('bold').fontSize(7.5).fillColor(INK)
      .text(rx.pretty_id, qx - 12, top + 72, { width: 98, align: 'center' });
    doc.font('body').fontSize(6).fillColor(MUTED)
      .text('QR ni skanerlang', qx - 12, doc.y, { width: 98, align: 'center' });
  }
  doc.y = Math.max(doc.y, top + 78);
  doc.moveTo(M, doc.y + 6).lineTo(PAGE.w - M, doc.y + 6).lineWidth(1).stroke(accent);
  doc.y += 16;
}

function drawTitleBar(doc, rx, accent) {
  const y = doc.y;
  const hgt = 34;
  doc.roundedRect(M, y, CW, hgt, 6).fill(SOFT);
  doc.fillColor(accent).font('serif').fontSize(14).text('RETSEPT', M + 14, y + 9);
  doc.font('body').fontSize(8).fillColor(MUTED).text('Rx / Prescription', M + 100, y + 13);

  const dateStr = `Sana: ${fmt.dmy(rx.visit_date)}`;
  doc.font('bold').fontSize(10).fillColor(INK)
    .text(dateStr, PAGE.w - M - 220, y + 8, { width: 206, align: 'right' });
  doc.font('body').fontSize(7.5).fillColor(MUTED)
    .text(`ID: ${rx.pretty_id}`, PAGE.w - M - 220, y + 21, { width: 206, align: 'right' });
  doc.y = y + hgt + 12;
}

function drawPatient(doc, rx, accent) {
  const p = rx.patient || {};
  const yrs = fmt.age(p.birth_year);
  // F.I.Sh. — butun kenglikda (uzun ismlar qisqarmasligi uchun), qolganlari 2 ustunda
  const full = [['F.I.Sh.', p.full_name || '—']];
  const pairs = [
    ['Tug\'ilgan yili', p.birth_year ? `${p.birth_year}${yrs != null ? ` (${yrs} yosh)` : ''}` : '—'],
    ['Jinsi', p.gender || '—'],
    ['Telefon', fmt.phoneFmt(p.phone) || '—'],
    ['Bemor kodi', p.code || '—'],
  ];
  if (p.address) full.push(['Manzil', p.address]);

  const rowH = 17;
  const h = 22 + rowH * (1 + Math.ceil(pairs.length / 2)) + (p.address ? rowH : 0) + 5;
  const y = doc.y;
  doc.roundedRect(M, y, CW, h, 6).lineWidth(0.8).stroke(LINE);
  doc.font('bold').fontSize(7.5).fillColor(accent).text('BEMOR MA\'LUMOTLARI', M + 12, y + 8);

  const colW = (CW - 24) / 2;
  let ry = y + 22;
  pair(doc, M + 12, ry, CW - 24, full[0][0], full[0][1]);
  ry += rowH;
  for (let i = 0; i < pairs.length; i += 2) {
    pair(doc, M + 12, ry, colW - 8, pairs[i][0], pairs[i][1]);
    if (pairs[i + 1]) pair(doc, M + 12 + colW, ry, colW - 8, pairs[i + 1][0], pairs[i + 1][1]);
    ry += rowH;
  }
  if (p.address) pair(doc, M + 12, ry, CW - 24, 'Manzil', p.address);

  doc.y = y + h + 10;
}

function pair(doc, x, y, w, label, value) {
  doc.font('body').fontSize(7.5).fillColor(MUTED).text(label, x, y + 2, { width: 72 });
  doc.font('bold').fontSize(9).fillColor(INK)
    .text(String(value), x + 76, y, { width: w - 76, ellipsis: true, height: 14 });
}

function drawDiagnosis(doc, rx, accent) {
  if (!rx.diagnosis && !rx.icd10) return;
  const t = rx.template;
  const showIcd = truthy(t.show_icd) && rx.icd10;
  const text = rx.diagnosis || '—';
  doc.font('bold').fontSize(7.5).fillColor(accent).text('DASTLABKI TASHXIS', M, doc.y);
  doc.moveDown(0.25);
  const y = doc.y;
  const w = showIcd ? CW - 96 : CW;
  doc.font('bold').fontSize(10.5).fillColor(INK).text(text, M, y, { width: w, lineGap: 2 });
  if (showIcd) {
    const cw = 88;
    doc.roundedRect(PAGE.w - M - cw, y - 2, cw, 18, 9).fill(SOFT);
    doc.font('bold').fontSize(8).fillColor(accent)
      .text(`МКБ-10: ${rx.icd10}`, PAGE.w - M - cw, y + 3, { width: cw, align: 'center' });
  }
  doc.y = Math.max(doc.y, y + 16) + 10;
  doc.fillColor(INK);
}

function block(doc, title, text, accent) {
  ensure(doc, 46);
  doc.font('bold').fontSize(7.5).fillColor(accent).text(title, M, doc.y);
  doc.moveDown(0.25);
  doc.font('body').fontSize(9.5).fillColor(INK).text(String(text), M, doc.y, { width: CW, lineGap: 2.5 });
  doc.y += 10;
}

function drawRx(doc, rx, accent) {
  ensure(doc, 80);
  const y = doc.y;
  doc.font('serif').fontSize(22).fillColor(accent).text('Rp.', M, y);
  doc.font('body').fontSize(7.5).fillColor(MUTED)
    .text('Dori vositalari — xalqaro nomlanish (INN)', M + 46, y + 11);
  doc.moveTo(M, y + 26).lineTo(PAGE.w - M, y + 26).lineWidth(0.8).stroke(LINE);
  doc.y = y + 34;

  if (!rx.items || !rx.items.length) {
    doc.font('italic').fontSize(9.5).fillColor(MUTED)
      .text('Dori vositasi tayinlanmagan.', M + 8, doc.y, { width: CW - 8 });
    doc.y += 14;
    doc.fillColor(INK);
    return;
  }

  rx.items.forEach((item, i) => {
    const l = rxLines(item);
    ensure(doc, 56);
    const top = doc.y;
    const numW = 22;
    doc.font('bold').fontSize(9.5).fillColor(accent).text(`${i + 1}.`, M, top + 1, { width: numW });
    const x = M + numW;
    const w = CW - numW;

    doc.font('bold').fontSize(10.5).fillColor(INK).text(l.head, x, top, { width: w, lineGap: 1.5 });
    if (l.dtd) {
      doc.font('body').fontSize(9.5).fillColor(INK).text(l.dtd, x, doc.y + 1, { width: w });
    }
    if (l.sig) {
      const sy = doc.y + 2;
      doc.font('bold').fontSize(9.5).fillColor(accent).text('S.', x, sy, { width: 16, continued: false });
      doc.font('body').fontSize(9.5).fillColor(INK)
        .text(l.sig, x + 18, sy, { width: w - 18, lineGap: 2 });
    }
    doc.y += 9;
    if (i < rx.items.length - 1) {
      doc.moveTo(M + numW, doc.y - 4).lineTo(PAGE.w - M, doc.y - 4).lineWidth(0.4).dash(2, { space: 2 }).stroke(LINE);
      doc.undash();
    }
  });
  doc.y += 4;
  doc.fillColor(INK);
}

function drawDoctor(doc, rx, { accent, stamp, sign }) {
  ensure(doc, 130);
  const d = rx.doctor || {};
  // Imzo-muhr bloki blankaning pastki qismida turishi kerak — joy yetsa pastga tushiramiz.
  const anchor = PAGE.h - 70 - 112;
  const y = Math.max(doc.y + 6, doc.y > anchor ? doc.y + 6 : anchor);
  doc.moveTo(M, y).lineTo(PAGE.w - M, y).lineWidth(0.8).stroke(LINE);

  const leftW = CW * 0.52;
  doc.font('bold').fontSize(7.5).fillColor(accent).text('SHIFOKOR', M, y + 12);
  doc.font('bold').fontSize(11).fillColor(INK).text(d.full_name || '—', M, y + 24, { width: leftW });
  let ly = doc.y + 2;
  if (d.specialty) { doc.font('body').fontSize(9).fillColor(MUTED).text(d.specialty, M, ly, { width: leftW }); ly = doc.y + 1; }
  if (d.phone) { doc.font('body').fontSize(9).fillColor(INK).text(`Tel: ${fmt.phoneFmt(d.phone)}`, M, ly, { width: leftW }); ly = doc.y + 1; }
  if (d.license_number) {
    doc.font('body').fontSize(8).fillColor(MUTED).text(`Litsenziya / diplom: ${d.license_number}`, M, ly, { width: leftW });
    ly = doc.y;
  }

  // O'ng tomon: imzo va muhr
  const rx0 = M + leftW + 12;
  const rw = PAGE.w - M - rx0;
  if (sign) {
    try { doc.image(sign, rx0, y + 20, { fit: [rw * 0.55, 40], align: 'center' }); } catch { /* — */ }
  }
  doc.moveTo(rx0, y + 66).lineTo(rx0 + rw * 0.55, y + 66).lineWidth(0.6).stroke(LINE);
  doc.font('body').fontSize(7.5).fillColor(MUTED).text('Imzo', rx0, y + 69, { width: rw * 0.55, align: 'center' });

  const sx = rx0 + rw * 0.58;
  const sw = rw - (rw * 0.58);
  if (stamp) {
    try { doc.image(stamp, sx, y + 12, { fit: [Math.min(sw, 86), 76], align: 'center', valign: 'center' }); }
    catch { /* — */ }
  } else {
    doc.circle(sx + Math.min(sw, 86) / 2, y + 50, 34).lineWidth(0.8).dash(3, { space: 2 }).stroke(LINE);
    doc.undash();
    doc.font('body').fontSize(8).fillColor(LINE)
      .text('M.O\'.', sx, y + 46, { width: Math.min(sw, 86), align: 'center' });
  }
  doc.y = Math.max(ly, y + 88) + 6;
  doc.fillColor(INK);
}

function drawFooters(doc, rx, accent) {
  const range = doc.bufferedPageRange();
  const note = rx.template.footer_note || '';
  const url = qr.prescriptionUrl(rx.public_id);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // PDFKit pastki chegaradan oshgan matnni yangi sahifaga tashlaydi — vaqtincha o'chiramiz.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.h - 52;
    doc.moveTo(M, y).lineTo(PAGE.w - M, y).lineWidth(0.5).stroke(LINE);
    doc.font('body').fontSize(6.8).fillColor(MUTED)
      .text(note, M, y + 6, { width: CW - 110 });
    doc.font('body').fontSize(6.8).fillColor(MUTED)
      .text(`Tekshirish: ${url}`, M, y + 16, { width: CW - 110 });
    doc.font('body').fontSize(6.8).fillColor(MUTED).text(
      `${fmt.dateTime(new Date().toISOString())}  ·  ${i + 1}/${range.count}`,
      PAGE.w - M - 110, y + 6, { width: 110, align: 'right' }
    );
    doc.font('bold').fontSize(6.8).fillColor(accent)
      .text('NodiRetsept', PAGE.w - M - 110, y + 16, { width: 110, align: 'right' });
    doc.page.margins.bottom = savedBottom;
  }
  doc.flushPages();
}

function ensure(doc, needed) {
  if (doc.y + needed > PAGE.h - 70) doc.addPage();
}

function fileName(rx) {
  const name = String(rx.patient?.full_name || 'bemor').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);
  return `Retsept_${rx.pretty_id}_${name}.pdf`;
}

module.exports = { buildPrescriptionPdf, fileName };
