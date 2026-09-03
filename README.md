# NodiRetsept

Shifokor yozgan retseptni bemorga **QR kod**, **ID raqam** yoki **Telegram bot** orqali onlayn
yetkazadigan tizim. Shifokor kabineti, administrator paneli, PDF blanka va SQLite bazasi bilan —
qo'shimcha server yoki tashqi xizmatlarsiz ishlaydi.

---

## 1. Tez ishga tushirish

```bash
npm install
npm run seed        # namunaviy ma'lumotlar (ixtiyoriy)
npm start
```

O'zgartirish kiritgandan so'ng tekshirish uchun:

```bash
npm test
```

So'ng brauzerda oching: **http://localhost:4000**

### Standart hisoblar

| Rol | Login | Parol |
|---|---|---|
| Administrator | `admin` | `admin123` |
| Shifokor (demo) | `nodira` | `shifokor123` |
| Shifokor (demo) | `sardor` | `shifokor123` |

> **Birinchi ish:** administrator sifatida kirib, `Profil → Parolni o'zgartirish` orqali
> admin parolini almashtiring va `.env` dagi `SESSION_SECRET` ni tasodifiy uzun matnga o'zgartiring.

Demo ma'lumotlarsiz toza boshlash uchun `npm run seed` ni ishlatmang. Bazani noldan boshlash
kerak bo'lsa `data/nodiretsept.db*` fayllarini o'chirib, `npm start` ni qayta ishga tushiring.

---

## 2. Tizim qanday ishlaydi

```
Shifokor                          Bemor
   │                                │
   ├─ Retsept yozadi ──────────────►│
   │  (bemor, tashxis, Rp., fizio)  │
   │                                │
   ├─ Tizim ID va QR beradi         │
   │  NR-XXXX-XXXX                  │
   │                                ├─ QR ni skanerlaydi   →  sayt ochiladi
   │                                ├─ ID ni saytga kiritadi →  sayt ochiladi
   │                                └─ ID ni botga yuboradi  →  PDF keladi
```

### Shifokor kabineti

* **Boshqaruv paneli** — kunlik / haftalik / oylik hisobotlar, 14 kunlik va 6 oylik grafiklar,
  ko'p uchragan tashxis va dorilar, bugungi qabul ro'yxati, katta **«Retsept yozish»** tugmasi.
* **Bemorlar** — qidiruv, «mening bemorlarim» / «barcha bemorlar», har bir bemor kartasi va
  retseptlar tarixi. Har bir qatorda to'g'ridan-to'g'ri retsept yozish tugmasi bor.
* **Retseptlar** — ID, bemor, tashxis va sana bo'yicha filtr; ko'rish, PDF, tahrirlash, bekor qilish.
* **Profil** — shaxsiy ma'lumotlar (blankada chiqadi), pechat va imzo, parol.

### Retsept yozish oynasi

Istalgan sahifadagi **«Retsept yozish»** tugmasi suzuvchi oynani ochadi:

1. **Bemor** — qidiruv maydoniga yozasiz; ro'yxatda bo'lmasa o'sha yerdagi
   **«+ Yangi bemor qo'shish»** orqali F.I.Sh. va tug'ilgan yilini kiritib saqlaysiz.
2. **Blanka** — kelgan sanasi avtomatik qo'yiladi (o'zgartirsa bo'ladi), shikoyatlar,
   dastlabki tashxis va МКБ-10 kodi.
3. **Rp.** — dori vositalari. Nomni yozganda xalqaro nomlar (INN) ma'lumotnomasidan
   takliflar chiqadi va doza/shakl avtomatik to'ldiriladi. Har bir dori ostida
   retsept satri jonli ko'rinadi.
4. **Fizioterapiya va tavsiyalar** — tayyor variantlar tugmalari bilan.
5. **Shifokor** — hisobingizdan olinadi, pechat holati ko'rsatiladi.

Saqlagach oynada **ID, QR kod va havola** chiqadi — ularni bemorga berasiz.
Tahrirlashda ID va QR **o'zgarmaydi**, ya'ni oldin berilgan QR ishlayveradi.

### Administrator paneli

* **Boshqaruv paneli** — umumiy statistika, shifokorlar faoliyati, so'nggi harakatlar.
* **Shifokorlar** — hisob yaratish (login/parol), ma'lumotlarni tahrirlash, faollashtirish/o'chirish,
  parolni almashtirish.
* **Pechat va imzo** — har bir shifokor uchun alohida yuklanadi (PNG yoki JPG, 3 MB gacha).
* **Blanka** — umumiy blanka (klinika nomi, manzil, telefon, logotip, rang, ko'rinadigan bo'limlar)
  va **har bir shifokor uchun alohida blanka**. Shaxsiy blankada bo'sh qoldirilgan maydonlar
  umumiy blankadan olinadi.
* **Bemorlar / Retseptlar** — barcha yozuvlar bo'yicha qidiruv va filtr.
* **Telegram bot** — bot holati, ro'yxatdan o'tgan foydalanuvchilar, yuborilgan retseptlar.
* **Sozlamalar** — konfiguratsiya, zaxira nusxa yo'llari, harakatlar tarixi (audit).

### Bemor uchun

* **Sayt bosh sahifasi** — ID ni kiritish (`NR-XXXX-XXXX`).
* **`/scan`** — telefon kamerasi bilan QR skanerlash (HTTPS yoki localhost talab qilinadi).
* **Retsept sahifasi** — blanka ko'rinishida ochiladi, PDF yuklab olish va chop etish tugmalari bilan.

---

## 3. Telegram bot

`.env` faylida token ko'rsatilgan bo'lsa, bot server bilan birga avtomatik ishga tushadi.

Bemor uchun tartib:

1. `/start` — bot telefon raqamini so'raydi (tugma orqali yuboriladi).
2. **🔍 Retseptni izlash** tugmasi.
3. Retsept ID sini yuboradi (katta-kichik harf va chiziqchalar muhim emas).
4. Bot **PDF faylni** va retsept qisqacha mazmunini yuboradi.

Qo'shimcha imkoniyatlar:

* **🧾 Mening retseptlarim** — bemorning telefon raqamiga biriktirilgan retseptlar ro'yxati
  (bemor kartasida telefon to'ldirilgan bo'lishi kerak).
* Chuqur havola: `https://t.me/<bot>?start=NR-XXXXXXXX` — retseptni darhol ochadi.

Botni serverdan alohida ishga tushirish: `npm run bot`.

---

## 4. Konfiguratsiya (`.env`)

| O'zgaruvchi | Vazifasi |
|---|---|
| `PORT` | Server porti (standart `4000`) |
| `PUBLIC_URL` | **Saytning tashqi manzili — QR kodlar shu manzilga yo'naltiriladi** |
| `SESSION_SECRET` | Sessiya kalitlari uchun maxfiy matn |
| `TELEGRAM_BOT_TOKEN` | @BotFather bergan token |
| `TELEGRAM_ENABLED` | `true` / `false` — botni yoqish |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Birinchi ishga tushishda yaratiladigan admin |

> ⚠️ **Eng muhim sozlama — `PUBLIC_URL`.** Serverga joylashtirganda uni haqiqiy domenga
> (masalan `https://retsept.klinika.uz`) o'zgartiring. Aks holda QR kodlar `localhost` ga
> ishora qiladi va bemor telefonida ochilmaydi. QR kodlar har safar shu manzildan
> qaytadan yaratiladi, ya'ni domenni o'zgartirish uchun qo'shimcha amal talab qilinmaydi.

---

## 5. Serverga joylashtirish

```bash
# 1) Fayllarni serverga ko'chiring va bog'liqliklarni o'rnating
npm ci --omit=dev

# 2) .env ni sozlang (PUBLIC_URL, SESSION_SECRET, TELEGRAM_BOT_TOKEN)

# 3) Doimiy ishlashi uchun (misol: systemd)
sudo tee /etc/systemd/system/nodiretsept.service > /dev/null <<'EOF'
[Unit]
Description=NodiRetsept
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nodiretsept
ExecStart=/usr/bin/node src/server.js
Restart=always
User=www-data
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now nodiretsept
```

Oldiga Nginx (yoki Caddy) qo'yib **HTTPS** ni yoqing — QR skaner brauzerda faqat HTTPS da ishlaydi:

```nginx
server {
    server_name retsept.klinika.uz;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    client_max_body_size 5m;
}
```

### Zaxira nusxa

Butun tizim ikkita joyda saqlanadi:

* `data/nodiretsept.db` (+ `.db-wal`, `.db-shm`) — barcha ma'lumotlar;
* `data/uploads/` — pechat, imzo va logotiplar.

Shu ikkalasini nusxalash yetarli.

---

## 6. Loyiha tuzilishi

```
src/
  server.js              Express ilovasi va ishga tushirish
  config.js              .env dan sozlamalar
  lib/
    db.js                SQLite sxemasi va ulanish
    auth.js              parol, sessiya, ruxsatlar
    session-store.js     sessiyalarni SQLite da saqlash
    prescriptions.js     retsept mantiqi, blanka, hisobotlar
    pdf.js               PDF blanka (PDFKit + DejaVu shriftlari)
    qr.js                QR kod
    upload.js            pechat/imzo/logotip yuklash
    ids.js               NR-XXXX-XXXX identifikatorlari
    format.js            sana, telefon, ism formatlari
    icons.js             SVG ikonkalar
    seed.js              admin, dori ma'lumotnomasi, demo ma'lumotlar
  i18n/                  tarjimalar: uz.json · uz-Cyrl.json · ru.json · en.json
  routes/                auth · public · api · doctor · admin
tools/
  smoke.js               har bir sahifani har bir tilda ochib tekshiradi (npm test)
  sync-cyrl.js           uz.json dan kirillcha kalitlarni hosil qiladi
  telegram/bot.js        Telegram bot (grammY)
views/                   EJS shablonlari
public/css, public/js    dizayn tizimi va klient mantiq
assets/fonts/            DejaVu shriftlari (PDF uchun, kirill+lotin)
data/                    baza va yuklangan fayllar (pechat, imzo, logotip)
```

---

## 7. Retsept blankasi standarti

Blanka xalqaro amaliyotga (WHO — *Guide to Good Prescribing*) mos tartibda tuzilgan:

| Bo'lim | Mazmuni |
|---|---|
| Sarlavha | Klinika nomi, manzili, telefoni, logotipi, QR kod va retsept ID si |
| Sana | Kelgan sanasi (avtomatik, tahrirlanadi) |
| Bemor | F.I.Sh., tug'ilgan yili va yoshi, jinsi, telefoni, bemor kodi |
| Tashxis | Dastlabki tashxis + МКБ-10 (ICD-10) kodi |
| **Rp.** | Dori — xalqaro nomlanish (INN), dozasi, shakli |
| | `D.t.d. N.` — beriladigan miqdori |
| | `S.` (Signatura) — bir martalik doza, yuborish yo'li, chastotasi, davomiyligi, ko'rsatma |
| Fizioterapiya | Muolajalar va seanslar soni |
| Tavsiyalar | Rejim, parhez, keyingi qabul sanasi |
| Shifokor | F.I.Sh., mutaxassisligi, telefoni, litsenziya raqami, imzo va pechat |
| Pastki qism | Tekshirish havolasi, yaratilgan vaqti, sahifa raqami |

---

## 8. Tillar

Tizim to'rt tilda ishlaydi:

| Til | Kod | Izoh |
|---|---|---|
| O'zbekcha (lotin) | `uz` | standart til |
| Ўзбекча (кирилл) | `uz-Cyrl` | |
| Русский | `ru` | |
| English | `en` | tibbiy atamalar ICD-10, INN bo'yicha |

Til **URL ni o'zgartirmaydi** — tanlov cookie da saqlanadi. Bu ataylab shunday qilingan:
retsept havolalari (`/r/NR-XXXX`) QR kodlarga yozilib bemorlarga tarqatilgan, URL ga til
prefiksi qo'shilsa ular ishlamay qolardi.

Til qanday tanlanadi (tartib bo'yicha):

1. `?lang=ru` so'rov parametri yoki `/lang/ru` havolasi — sozlamalar panelidan
2. `nr_lang` cookie — bir marta tanlangach bir yil saqlanadi
3. Brauzerning `Accept-Language` sarlavhasi
4. Standart — o'zbekcha (lotin)

Tarjima qamrovi:

* **Sayt** — barcha sahifalar, shifokor kabineti, admin paneli, xato xabarlari
* **Retsept blankasi va PDF** — sarlavhalar bemor tanlagan tilda chiqadi. `МКБ-10` inglizchada
  `ICD-10` bo'ladi, sana formati ham tilga moslashadi
* **Telegram bot** — Telegram profilidagi tilni avtomatik aniqlaydi, `🌐 Til` tugmasi yoki
  `/lang` buyrug'i bilan o'zgartiriladi
* **Retsept muharriri** — yuborish yo'li, qabul chastotasi, davomiyligi kabi tayyor variantlar
  ham tarjima qilingan (farmatsevtik lotin qisqartmalari — `tab.`, `caps.`, `D.t.d.` — o'zgarmaydi)

> Shifokor kiritgan **tibbiy mazmun** (tashxis, dori nomi, ko'rsatmalar) tarjima qilinmaydi —
> u qaysi tilda yozilgan bo'lsa, blankada ham shundayligicha qoladi. Bu ataylab: retsept
> huquqiy hujjat, uning mazmuni avtomatik o'zgartirilmasligi kerak.

Tarjimalar `src/i18n/<til>.json` fayllarida. Yangi matn qo'shish uchun uchala faylga
(`uz`, `ru`, `en`) kalit qo'shing, so'ng kirillchasini avtomatik hosil qiling:

```bash
node tools/sync-cyrl.js
```

Bu buyruq faqat **yangi** kalitlarni transliteratsiya qiladi — mavjud kirillcha matnlarga
tegmaydi, ya'ni qo'lda kiritilgan tuzatishlar saqlanib qoladi.

## 9. Ko'rinish sozlamalari

Har bir foydalanuvchi o'zi uchun sozlaydi — tanlov **shu qurilmada** saqlanadi
(`localStorage`), server tomonida hech narsa o'zgarmaydi.

| Sozlama | Variantlar |
|---|---|
| **Mavzu** | Yorug' · Tungi · Avtomatik (qurilma sozlamasiga qarab) |
| **Matn o'lchami** | Oddiy · Katta · Juda katta |
| **Til** | O'zbekcha · Ўзбекча · Русский · English |

Qayerda:

* **Shifokor va admin** — `Profil → Ko'rinish va til` bo'limida
* **Bemorlar** — sayt sarlavhasidagi ⚙ tugmasi ostida (ularda profil yo'q)
* **Kirish sahifasi** — forma ostida

**Kattalashtirilgan rejim** ko'rish qobiliyati past foydalanuvchilar uchun: matn 15–35 %
kattalashadi, ochiq kulrang ranglar kuchaytiriladi, fokus ramkasi qalinlashadi va
jadval kataklari kengayadi. Barcha o'lchamlar `rem` da bo'lgani uchun interfeys
mutanosib kattalashadi — hech narsa buzilmaydi.

**Retsept blankasi** tungi rejimda ham **oq qog'oz** bo'lib qoladi. Bu ataylab: pechat,
imzo va logotip oq fon uchun tayyorlangan, PDF va chop etilgan nusxa ham shunday chiqadi.

## 10. Brend va logotip

Logotip — **N** harfi va QR skaner belgisidan iborat: harf brend nomini, QR belgisi esa
tizimning asosiy g'oyasini (retseptni skanerlab olish) bildiradi.

| Rang | Kod | Qayerda |
|---|---|---|
| Asosiy | `#0e7c86` | tugmalar, sarlavhalar, «Rp.» |
| Yorug' | `#1cb0bd` | gradient boshlanishi |
| To'q | `#075158` | gradient tugashi, yon panel |

Tayyor fayllar `public/img/` papkasida:

| Fayl | O'lchami | Ishlatilishi |
|---|---|---|
| `logo-mark.svg` | vektor | sayt sarlavhasi, blanka, favicon |
| `logo-square.svg` | vektor | to'liq to'ldirilgan kvadrat (profil rasmlari) |
| `icon-16/32/48/180/192/512.png` | px | favicon, telefon ekraniga qo'shish |
| `telegram-bot.png` | 512×512 | Telegram bot profil rasmi |
| `social-profile.jpg` | 1080×1080 | Instagram / Facebook / Telegram kanal avatari |
| `og-image.jpg` | 1200×630 | havola ulashilganda ko'rinadigan rasm |
| `social-cover.jpg` | 1500×500 | X (Twitter) / Facebook muqovasi |

Blankada logotip **avtomatik chiqadi**: klinika o'z logotipini yuklamagan bo'lsa NodiRetsept
belgisi turadi, yuklagan bo'lsa — o'ziniki (`Admin → Retsept blankasi → Logotip`).

Telegram bot rasmini o'rnatish: @BotFather → `/setuserpic` → botni tanlang → `telegram-bot.png` ni yuboring.

## 11. Xavfsizlik

* Parollar `bcrypt` bilan xeshlanadi, sessiyalar bazada saqlanadi (server qayta ishga tushsa yo'qolmaydi).
* Retsept ID si tasodifiy 8 belgidan iborat (30 ta belgili alifbo ≈ 6·10¹¹ variant), chalkash
  belgilar (`0`, `1`, `I`, `O`, `L`, `U`) ishlatilmaydi.
* Ommaviy qidiruv va bot uchun so'rovlar soni cheklangan (brutforce'ga qarshi).
* Shifokor faqat o'z retseptlarini tahrirlay oladi, administrator — barchasini ko'radi.
* Barcha muhim amallar `audit_log` jadvaliga yoziladi (`Sozlamalar` bo'limida ko'rinadi).

> Eslatma: retsept sahifasi ID ni bilgan har kimga ochiq (bemor uni oson ochishi uchun).
> Bu — tizimning ataylab tanlangan xususiyati; ID ni faqat bemorga bering.
