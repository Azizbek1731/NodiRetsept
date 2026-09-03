'use strict';
const session = require('express-session');
const db = require('./db');

/** express-session uchun SQLite ombori — server qayta ishga tushsa ham sessiya saqlanadi. */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.stmts = {
      get: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
      set: db.prepare(`INSERT INTO sessions(sid, expires, data) VALUES(?,?,?)
                       ON CONFLICT(sid) DO UPDATE SET expires=excluded.expires, data=excluded.data`),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      clean: db.prepare('DELETE FROM sessions WHERE expires < ?'),
      length: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires >= ?'),
      clear: db.prepare('DELETE FROM sessions'),
    };
    // Har soatda muddati o'tgan sessiyalarni tozalab turamiz.
    this.timer = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    if (this.timer.unref) this.timer.unref();
    this.cleanup();
  }

  cleanup() { try { this.stmts.clean.run(Date.now()); } catch { /* jim */ } }

  _expiry(sess) {
    const ms = (sess && sess.cookie && sess.cookie.maxAge) || 1000 * 60 * 60 * 12;
    return Date.now() + ms;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) { this.stmts.destroy.run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try { this.stmts.set.run(sid, this._expiry(sess), JSON.stringify(sess)); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }

  touch(sid, sess, cb) {
    try { this.stmts.touch.run(this._expiry(sess), sid); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }

  destroy(sid, cb) {
    try { this.stmts.destroy.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }

  length(cb) {
    try { cb(null, this.stmts.length.get(Date.now()).n); } catch (e) { cb(e); }
  }

  clear(cb) {
    try { this.stmts.clear.run(); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

module.exports = SqliteStore;
