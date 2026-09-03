'use strict';
const QRCode = require('qrcode');
const config = require('../config');

/** Retseptning ommaviy manzili — QR kod shu yerga olib boradi. */
function prescriptionUrl(publicId) {
  return `${config.publicUrl}/r/${encodeURIComponent(publicId)}`;
}

const OPTS = {
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 512,
  color: { dark: '#0b1f2aff', light: '#ffffffff' },
};

async function toBuffer(text, opts = {}) {
  return QRCode.toBuffer(text, { ...OPTS, type: 'png', ...opts });
}

async function toDataUrl(text, opts = {}) {
  return QRCode.toDataURL(text, { ...OPTS, ...opts });
}

module.exports = { prescriptionUrl, toBuffer, toDataUrl };
