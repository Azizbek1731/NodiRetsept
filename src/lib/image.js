'use strict';
/**
 * Pechat va imzo rasmlarining oq fonini shaffofga aylantiradi.
 *
 * Nega kerak: shifokorlar odatda pechatni telefonda suratga oladi yoki skanerlaydi —
 * natija JPEG bo'ladi, JPEG esa shaffoflikni umuman qo'llab-quvvatlamaydi. Shunday
 * rasm blankaga qo'yilsa, uning oq to'rtburchagi ostidagi imzoni butunlay yopib
 * qo'yadi. Bu yerda fon olib tashlanadi va natija PNG (shaffof) qilib saqlanadi.
 */
const fs = require('fs');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Faylni RGBA pikselga ochadi (JPEG yoki PNG) */
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: Buffer.from(img.data) };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: Buffer.from(png.data) };
  }
  throw Object.assign(new Error('Faqat PNG yoki JPG rasm qo\'llab-quvvatlanadi'), { expose: true, status: 400 });
}

/** Chekka piksellarning medianasi — fon rangini shundan taxmin qilamiz */
function estimateBackground({ width, height, data }) {
  const samples = [];
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return lum(data[i], data[i + 1], data[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  for (let x = 0; x < width; x += step) { samples.push(at(x, 0), at(x, height - 1)); }
  for (let y = 0; y < height; y += step) { samples.push(at(0, y), at(width - 1, y)); }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/** To'liq shaffof chekkalarni kesib tashlaydi — rasm o'z joyini to'liq egallaydi */
function trim({ width, height, data }) {
  let top = 0, left = 0, right = width - 1, bottom = height - 1;
  const opaqueRow = (y) => {
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 8) return true;
    return false;
  };
  const opaqueCol = (x) => {
    for (let y = 0; y < height; y++) if (data[(y * width + x) * 4 + 3] > 8) return true;
    return false;
  };
  while (top < bottom && !opaqueRow(top)) top++;
  while (bottom > top && !opaqueRow(bottom)) bottom--;
  while (left < right && !opaqueCol(left)) left++;
  while (right > left && !opaqueCol(right)) right--;
  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w === width && h === height) return { width, height, data };
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    data.copy(out, y * w * 4, ((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4);
  }
  return { width: w, height: h, data: out };
}

/**
 * Rasmni kerakli o'lchamgacha kichraytiradi (maydon o'rtachasi — kichraytirishda
 * eng toza natija beradi). Pechat blankada ~85 pt bo'lib chiqadi, shuning uchun
 * 600 px dan katta saqlashning ma'nosi yo'q — fayl bekorga og'irlashadi.
 */
function downscale({ width, height, data }, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  if (scale >= 1) return { width, height, data };
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(w * h * 4);
  const xr = width / w;
  const yr = height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yr);
    const y1 = Math.min(height, Math.ceil((y + 1) * yr));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xr);
      const x1 = Math.min(width, Math.ceil((x + 1) * xr));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4;
          const al = data[i + 3] / 255;
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al;
          a += data[i + 3];
          n++;
        }
      }
      const o = (y * w + x) * 4;
      const aAvg = a / n;
      const k = aAvg > 0 ? (n * 255) / a : 0;     // shaffoflikni hisobga olgan rang
      out[o] = Math.min(255, Math.round((r / n) * k));
      out[o + 1] = Math.min(255, Math.round((g / n) * k));
      out[o + 2] = Math.min(255, Math.round((b / n) * k));
      out[o + 3] = Math.round(aAvg);
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Oq (yoki och) fonni shaffofga aylantiradi va PNG qilib saqlaydi.
 * Qaytaradi: { changed, width, height } — fon olib tashlanmagan bo'lsa changed=false.
 */
function removeBackground(inputPath, outputPath, { maxSize = 480 } = {}) {
  const img = decode(fs.readFileSync(inputPath));
  const bg = estimateBackground(img);

  // Fon qorong'i bo'lsa (masalan rasm allaqachon shaffof yoki to'q dizayn),
  // tegmaymiz — aks holda tasvirni buzib qo'yishimiz mumkin.
  if (bg < 170) return { changed: false, width: img.width, height: img.height };

  const hi = Math.max(200, bg - 8);     // bundan yorug'i — to'liq shaffof
  const lo = Math.max(110, bg - 80);    // bundan to'qi — to'liq ko'rinadi
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    const L = lum(data[i], data[i + 1], data[i + 2]);
    let a;
    if (L >= hi) a = 0;
    else if (L <= lo) a = 255;
    else a = Math.round(255 * ((hi - L) / (hi - lo)));   // chekkalar yumshoq bo'lsin
    data[i + 3] = Math.round((data[i + 3] / 255) * a);   // mavjud shaffoflik saqlanadi
  }

  const trimmed = downscale(trim(img), maxSize);
  const png = new PNG({ width: trimmed.width, height: trimmed.height });
  trimmed.data.copy(png.data);
  fs.writeFileSync(outputPath, PNG.sync.write(png, { deflateLevel: 9 }));
  return { changed: true, width: trimmed.width, height: trimmed.height };
}

module.exports = { removeBackground, decode, estimateBackground, downscale };
