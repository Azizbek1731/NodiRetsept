#!/usr/bin/env node
/**
 * Bazadagi mavjud pechat va imzo rasmlarining oq fonini shaffofga aylantiradi.
 *
 * Shifokorlar rasmlarni telefonda suratga oladi — JPEG da shaffoflik yo'q,
 * shuning uchun pechatning oq to'rtburchagi ostidagi imzoni butunlay yopib
 * qo'yadi. Bu skript eski fayllarni bir marta qayta ishlaydi; yangi yuklamalar
 * upload.processInk() orqali avtomatik tozalanadi.
 *
 * Ishlatish:  node tools/clean-ink.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const h = require('../src/lib/db').h;
const { removeBackground } = require('../src/lib/image');

const dry = process.argv.includes('--dry');
const abs = (rel) => path.join(config.paths.data, rel);

function clean(rel) {
  if (!rel) return null;
  const src = abs(rel);
  if (!fs.existsSync(src)) return { skip: `fayl yo'q: ${rel}` };
  const out = src.replace(/\.[^.]+$/, '') + '-clean.png';
  const before = fs.statSync(src).size;
  const res = removeBackground(src, out);
  if (!res.changed) {
    fs.existsSync(out) && fs.unlinkSync(out);
    return { skip: 'foni yorug\' emas, tegilmadi' };
  }
  const relOut = path.relative(config.paths.data, out).split(path.sep).join('/');
  if (dry) { fs.unlinkSync(out); return { would: relOut, before, after: 0, ...res }; }
  return { rel: relOut, before, after: fs.statSync(out).size, old: src, ...res };
}

/**
 * Eski retseptlarning snapshotida ham yo'l saqlanadi (tarixiy aniqlik uchun).
 * Fayl nomi o'zgargani sababli ularni ham yangilaymiz, aks holda eski
 * retseptlarda pechat umuman ko'rinmay qoladi.
 */
function retargetSnapshots(doctorId, field, oldRel, newRel) {
  const rows = h.all('SELECT id, doctor_snapshot FROM prescriptions WHERE doctor_id = ?', doctorId);
  let n = 0;
  for (const r of rows) {
    let snap;
    try { snap = JSON.parse(r.doctor_snapshot || '{}'); } catch { continue; }
    if (snap[field] !== oldRel) continue;
    snap[field] = newRel;
    h.run('UPDATE prescriptions SET doctor_snapshot = ? WHERE id = ?', JSON.stringify(snap), r.id);
    n += 1;
  }
  return n;
}

const rows = h.all(
  'SELECT id, full_name, stamp_path, signature_path FROM users WHERE stamp_path IS NOT NULL OR signature_path IS NOT NULL'
);
if (!rows.length) { console.log('Tozalanadigan rasm topilmadi.'); process.exit(0); }

for (const u of rows) {
  console.log(`\n#${u.id} ${u.full_name}`);
  for (const field of ['stamp_path', 'signature_path']) {
    const rel = u[field];
    if (!rel) continue;
    const label = field === 'stamp_path' ? 'pechat ' : 'imzo   ';
    let r;
    try { r = clean(rel); } catch (e) { console.log(`  ${label} XATO: ${e.message}`); continue; }
    if (!r) continue;
    if (r.skip) { console.log(`  ${label} o'tkazildi (${r.skip})`); continue; }
    if (r.would) { console.log(`  ${label} ${rel} -> ${r.would} (${r.width}x${r.height})`); continue; }
    h.run(`UPDATE users SET ${field} = ? WHERE id = ?`, r.rel, u.id);
    const touched = retargetSnapshots(u.id, field, rel, r.rel);
    try { fs.unlinkSync(r.old); } catch { /* asl fayl qolsa ham mayli */ }
    const kb = (n) => `${Math.round(n / 1024)} KB`;
    console.log(`  ${label} ${rel} -> ${r.rel}  ${r.width}x${r.height}, ${kb(r.before)} -> ${kb(r.after)}`
      + (touched ? `, ${touched} ta eski retsept yangilandi` : ''));
  }
}
console.log(dry ? '\n(sinov rejimi — baza o\'zgartirilmadi)' : '\nTayyor.');
