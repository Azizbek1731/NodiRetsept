'use strict';
const db = require('./db');
const { h } = db;
const auth = require('./auth');
const config = require('../config');
const rxLib = require('./prescriptions');
const ids = require('./ids');
const fmt = require('./format');
const drugList = require('./drugs.seed');

/** Server ishga tushganda kerakli minimal ma'lumotlar. */
function bootstrap() {
  rxLib.globalTemplate();

  const admin = h.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!admin) {
    h.run(
      `INSERT INTO users (role, username, password_hash, full_name, is_active, created_at)
       VALUES ('admin', ?, ?, ?, 1, ?)`,
      config.admin.username, auth.hashPassword(config.admin.password),
      config.admin.name, new Date().toISOString()
    );
    console.log(`  ✓ Admin yaratildi — login: ${config.admin.username} / parol: ${config.admin.password}`);
  }

  const drugCount = h.get('SELECT COUNT(*) AS n FROM drugs').n;
  if (drugCount === 0) {
    const stmt = db.prepare('INSERT OR IGNORE INTO drugs (name, form, strength, atc) VALUES (?,?,?,?)');
    db.transaction(() => drugList.forEach((d) => stmt.run(d[0], d[1], d[2], d[3] || null)))();
    console.log(`  ✓ Dori ma'lumotnomasi yuklandi (${drugList.length} ta)`);
  }
}

/* ── Demo ma'lumotlari (npm run seed) ─────────────────────── */

const DOCTORS = [
  { username: 'nodira', password: 'shifokor123', full_name: 'Karimova Nodira Baxtiyorovna', specialty: 'Nevropatolog', phone: '998901234567', license_number: 'A-118924', room: '204-xona' },
  { username: 'sardor', password: 'shifokor123', full_name: 'Yusupov Sardor Alisherovich', specialty: 'Kardiolog', phone: '998935558877', license_number: 'A-227431', room: '112-xona' },
];

const PATIENTS = [
  ['Rahimov Jasur Baxtiyorovich', 1988, 'Erkak', '998901112233'],
  ['Ismoilova Dilnoza Akmalovna', 1995, 'Ayol', '998945556677'],
  ['To\'xtayev Sanjar Umidovich', 1974, 'Erkak', '998977778899'],
  ['Yo\'ldosheva Malika Rustamovna', 2001, 'Ayol', '998901234455'],
  ['Qodirov Bekzod Anvarovich', 1960, 'Erkak', '998933332211'],
  ['Ergasheva Zilola Shuxratovna', 1983, 'Ayol', '998911119988'],
  ['Nazarov Otabek Farhodovich', 1992, 'Erkak', '998998887766'],
  ['Sultonova Gulnora Erkinovna', 1968, 'Ayol', '998944445566'],
];

const CASES = [
  { dx: 'O\'tkir respirator virusli infeksiya', icd: 'J06.9', physio: 'Bug\' ingalyatsiyasi — kuniga 2 mahal, 5 kun.',
    items: [['Paracetamolum', 'tab.', '500 mg', '20', '1 tabletkadan', 'ichga', 'kuniga 3 mahal', '5 kun', 'ovqatdan keyin'],
            ['Ambroxolum', 'sir.', '30 mg/5 ml', '1', '10 ml', 'ichga', 'kuniga 3 mahal', '7 kun', '']] },
  { dx: 'Arterial gipertenziya, II daraja', icd: 'I10', physio: 'Elektroson — 10 seans.',
    items: [['Lisinoprilum', 'tab.', '10 mg', '30', '1 tabletkadan', 'ichga', 'kuniga 1 mahal ertalab', '1 oy', 'AB nazorati bilan'],
            ['Indapamidum', 'tab.', '2,5 mg', '30', '1 tabletkadan', 'ichga', 'kuniga 1 mahal', '1 oy', '']] },
  { dx: 'Bel-dumg\'aza radikulopatiyasi', icd: 'M54.1', physio: 'Magnitoterapiya — 10 seans; massaj — 8 seans.',
    items: [['Meloxicamum', 'tab.', '15 mg', '10', '1 tabletkadan', 'ichga', 'kuniga 1 mahal', '10 kun', 'ovqatdan keyin'],
            ['Tolperisonum', 'tab.', '150 mg', '30', '1 tabletkadan', 'ichga', 'kuniga 2 mahal', '14 kun', ''],
            ['Pyridoxini hydrochloridum', 'sol. pro inj.', '50 mg/ml', '10', '1 ml', 'mushak orasiga', 'kunora', '10 kun', '']] },
  { dx: 'O\'tkir gastrit', icd: 'K29.1', physio: '',
    items: [['Omeprazolum', 'caps.', '20 mg', '28', '1 kapsuladan', 'ichga', 'kuniga 2 mahal', '14 kun', 'ovqatdan 30 daqiqa oldin'],
            ['Drotaverini hydrochloridum', 'tab.', '40 mg', '20', '1 tabletkadan', 'ichga', 'og\'riq paytida', '7 kun', '']] },
  { dx: 'Temir tanqisligi anemiyasi, o\'rta og\'irlikda', icd: 'D50.9', physio: '',
    items: [['Ferrosi sulfas', 'tab.', '325 mg', '60', '1 tabletkadan', 'ichga', 'kuniga 2 mahal', '2 oy', 'C vitamini bilan'],
            ['Acidum folicum', 'tab.', '5 mg', '30', '1 tabletkadan', 'ichga', 'kuniga 1 mahal', '1 oy', '']] },
  { dx: 'O\'tkir bronxit', icd: 'J20.9', physio: 'UVCh — 5 seans.',
    items: [['Azithromycinum', 'tab.', '500 mg', '3', '1 tabletkadan', 'ichga', 'kuniga 1 mahal', '3 kun', 'ovqatdan 1 soat oldin'],
            ['Acetylcysteinum', 'gran.', '600 mg', '10', '1 paketdan', 'ichga', 'kuniga 1 mahal', '10 kun', 'suvda eritib']] },
];

function demo() {
  bootstrap();
  const now = new Date().toISOString();

  const doctorIds = DOCTORS.map((d) => {
    const ex = h.get('SELECT id FROM users WHERE username = ?', d.username);
    if (ex) return ex.id;
    const info = h.run(
      `INSERT INTO users (role, username, password_hash, full_name, phone, specialty, license_number, clinic_name, room, is_active, created_at)
       VALUES ('doctor',?,?,?,?,?,?,?,?,1,?)`,
      d.username, auth.hashPassword(d.password), d.full_name, d.phone, d.specialty,
      d.license_number, 'NodiRetsept klinikasi', d.room, now
    );
    console.log(`  ✓ Shifokor: ${d.username} / ${d.password} — ${d.full_name}`);
    return Number(info.lastInsertRowid);
  });

  const patientIds = PATIENTS.map(([name, year, gender, phone], i) => {
    const ex = h.get('SELECT id FROM patients WHERE full_name = ?', name);
    if (ex) return ex.id;
    const info = h.run(
      `INSERT INTO patients (full_name, birth_year, gender, phone, created_by, created_at)
       VALUES (?,?,?,?,?,?)`,
      name, year, gender, phone, doctorIds[i % doctorIds.length], now
    );
    const id = Number(info.lastInsertRowid);
    h.run('UPDATE patients SET code = ? WHERE id = ?', ids.patientCode(id), id);
    return id;
  });

  const already = h.get('SELECT COUNT(*) AS n FROM prescriptions').n;
  if (already > 0) { console.log(`  · Retseptlar allaqachon mavjud (${already} ta) — qo'shilmadi`); return; }

  let made = 0;
  for (let i = 0; i < 34; i++) {
    const c = CASES[i % CASES.length];
    const dayOffset = Math.floor(Math.pow(Math.random(), 1.7) * 55); // yaqin kunlarda ko'proq
    const visit = fmt.toISODate(fmt.addDays(new Date(), -dayOffset));
    rxLib.create({
      doctor_id: doctorIds[i % doctorIds.length],
      patient_id: patientIds[i % patientIds.length],
      visit_date: visit,
      complaints: 'Bemor umumiy holsizlik va bezovtalikdan shikoyat qiladi.',
      diagnosis: c.dx,
      icd10: c.icd,
      physiotherapy: c.physio,
      recommendations: 'Parhez, yetarli suyuqlik iste\'moli, 10 kundan so\'ng qayta ko\'rik.',
      next_visit: fmt.toISODate(fmt.addDays(fmt.parseISODate(visit), 10)),
      items: c.items.map(([drug, form, strength, qty, dose, route, freq, dur, instr]) => ({
        drug_name: drug, form, strength, quantity: qty, dose, route,
        frequency: freq, duration: dur, instructions: instr,
      })),
    });
    made++;
  }
  console.log(`  ✓ ${made} ta demo retsept yaratildi`);
}

if (require.main === module) {
  console.log('NodiRetsept — demo ma\'lumotlar yuklanmoqda…');
  demo();
  console.log('Tayyor.');
}

module.exports = { bootstrap, demo };
