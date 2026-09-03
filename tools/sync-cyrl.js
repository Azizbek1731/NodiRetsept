'use strict';
/**
 * uz.json dagi yangi kalitlarni uz-Cyrl.json ga transliteratsiya qilib qo'shadi.
 * Mavjud kirillcha matnlarga tegmaydi — qo'lda kiritilgan tuzatishlar saqlanib qoladi.
 *
 * Ishlatish:  node tools/sync-cyrl.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n');

// Transliteratsiya qilinmaydigan bo'laklar: HTML teglar, {o'rinbosarlar}, texnik atamalar
const PROTECT = new RegExp([
  '<code>[\\s\\S]*?</code>', '<[^>]*>', '\\{\\w+\\}', 'https?://\\S+', '/[a-z][\\w/.-]*',
  '\\bNR-[A-Z0-9-]+', '\\bD\\.t\\.d\\.', '\\bRp\\.',
  '\\b(?:NodiRetsept|Telegram|INN|PDF|QR|ID|HTML|HTTPS|localhost|PNG|JPG|MB|WHO|Good|Prescribing|Signatura|Rx|Prescription|Chat)\\b',
  'МКБ-10', '\\.env', '\\.db', '[A-Z_]{4,}',
].join('|'), 'g');

// ⚠️ "yo'" — bu "yo" emas, "y" + "o‘" (yo'q → йўқ). Shuning uchun ro'yxat boshida turadi.
const DIGRAPHS = [
  ["YO'", 'ЙЎ'], ['YOʻ', 'ЙЎ'], ['YO‘', 'ЙЎ'], ["Yo'", 'Йў'], ['Yoʻ', 'Йў'], ['Yo‘', 'Йў'],
  ["yo'", 'йў'], ['yoʻ', 'йў'], ['yo‘', 'йў'],
  ["O'", 'Ў'], ['Oʻ', 'Ў'], ['O‘', 'Ў'], ["o'", 'ў'], ['oʻ', 'ў'], ['o‘', 'ў'],
  ["G'", 'Ғ'], ['Gʻ', 'Ғ'], ['G‘', 'Ғ'], ["g'", 'ғ'], ['gʻ', 'ғ'], ['g‘', 'ғ'],
  ['SH', 'Ш'], ['Sh', 'Ш'], ['sh', 'ш'], ['CH', 'Ч'], ['Ch', 'Ч'], ['ch', 'ч'],
  ['YO', 'Ё'], ['Yo', 'Ё'], ['yo', 'ё'], ['YU', 'Ю'], ['Yu', 'Ю'], ['yu', 'ю'],
  ['YA', 'Я'], ['Ya', 'Я'], ['ya', 'я'], ['YE', 'Е'], ['Ye', 'Е'], ['ye', 'е'],
  ['TS', 'Ц'], ['Ts', 'Ц'], ['ts', 'ц'],
];
const SINGLE = {
  a:'а', b:'б', d:'д', e:'е', f:'ф', g:'г', h:'ҳ', i:'и', j:'ж', k:'к', l:'л', m:'м', n:'н',
  o:'о', p:'п', q:'қ', r:'р', s:'с', t:'т', u:'у', v:'в', x:'х', y:'й', z:'з', c:'с',
  A:'А', B:'Б', D:'Д', E:'Е', F:'Ф', G:'Г', H:'Ҳ', I:'И', J:'Ж', K:'К', L:'Л', M:'М', N:'Н',
  O:'О', P:'П', Q:'Қ', R:'Р', S:'С', T:'Т', U:'У', V:'В', X:'Х', Y:'Й', Z:'З', C:'С',
};

function chunk(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const hit = DIGRAPHS.find(([src]) => s.startsWith(src, i));
    if (hit) { out += hit[1]; i += hit[0].length; continue; }
    const ch = s[i], prev = i ? s[i - 1] : '';
    if ("'ʼ‘’".includes(ch) && prev && /\p{L}/u.test(prev)) { out += 'ъ'; i++; continue; }
    if (ch === 'e' || ch === 'E') {
      const wordStart = i === 0 || !(/\p{L}/u.test(s[i - 1]) || "'ʼ‘’".includes(s[i - 1]));
      out += wordStart ? (ch === 'E' ? 'Э' : 'э') : (ch === 'E' ? 'Е' : 'е');
      i++; continue;
    }
    out += SINGLE[ch] !== undefined ? SINGLE[ch] : ch;
    i++;
  }
  return out;
}

function translit(s) {
  let out = '', last = 0;
  PROTECT.lastIndex = 0;
  for (let m = PROTECT.exec(s); m; m = PROTECT.exec(s)) {
    out += chunk(s.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + chunk(s.slice(last));
}

/** uz dagi kalitni cyr da bo'lmasa qo'shadi; borini o'zgartirmaydi */
let added = 0;
function merge(uz, cyr, keepLatin) {
  const out = Array.isArray(uz) ? [] : {};
  for (const [k, v] of Object.entries(uz)) {
    const existing = cyr ? cyr[k] : undefined;
    if (typeof v === 'string') {
      if (typeof existing === 'string') out[k] = existing;
      else { out[k] = keepLatin ? v : translit(v); added++; }
    } else if (Array.isArray(v)) {
      out[k] = (Array.isArray(existing) && existing.length === v.length)
        ? existing
        : (added += v.length, v.map((x) => (keepLatin || k === 'forms' ? x : translit(x))));
    } else {
      out[k] = merge(v, existing || {}, keepLatin);
    }
  }
  return out;
}

const uz = JSON.parse(fs.readFileSync(path.join(DIR, 'uz.json'), 'utf8'));
const cyrPath = path.join(DIR, 'uz-Cyrl.json');
const cyr = fs.existsSync(cyrPath) ? JSON.parse(fs.readFileSync(cyrPath, 'utf8')) : {};

const merged = merge(uz, cyr, false);
// Farmatsevtik lotin qisqartmalari va Rx sarlavhasi hech qachon transliteratsiya qilinmaydi
merged.editorOpts.forms = uz.editorOpts.forms;
merged.rx.subtitle = uz.rx.subtitle;

fs.writeFileSync(cyrPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(added ? `  ✓ ${added} ta yangi kalit transliteratsiya qilindi` : '  · yangi kalit yo\'q');
