'use strict';
/** Botni serverdan alohida ishga tushirish: npm run bot */
const config = require('../config');
const bot = require('./bot');

if (!config.telegram.token) {
  console.error('TELEGRAM_BOT_TOKEN .env faylida ko\'rsatilmagan.');
  process.exit(1);
}
console.log('Telegram bot ishga tushmoqda…');
bot.start().catch((e) => { console.error('Xato:', e.message); process.exit(1); });
process.on('SIGINT', () => bot.stop().then(() => process.exit(0)));
