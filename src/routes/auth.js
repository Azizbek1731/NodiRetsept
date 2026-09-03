'use strict';
const express = require('express');
const auth = require('../lib/auth');
const db = require('../lib/db');
const { h } = db;

module.exports = function authRoutes(loginLimiter) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
    res.render('login', {
      title: req.t('auth.title'),
      bodyClass: 'auth-page',
      next: typeof req.query.next === 'string' ? req.query.next : '',
      error: null,
      username: '',
    });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const { username = '', password = '', next: nextUrl = '' } = req.body || {};
    const fail = (msg) => res.status(401).render('login', {
      title: req.t('auth.title'), bodyClass: 'auth-page',
      next: nextUrl, error: msg, username,
    });

    const user = auth.findUserByUsername(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      return fail(req.t('auth.wrong'));
    }
    if (!user.is_active) return fail(req.t('auth.disabled'));

    req.session.regenerate((err) => {
      if (err) return fail(req.t('auth.sessionError'));
      req.session.userId = user.id;
      h.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), user.id);
      h.audit(user.id, 'login', 'user', user.id, null);
      const safeNext = typeof nextUrl === 'string' && nextUrl.startsWith('/') && !nextUrl.startsWith('//')
        ? nextUrl : null;
      res.redirect(safeNext || (user.role === 'admin' ? '/admin' : '/dashboard'));
    });
  });

  router.post('/logout', (req, res) => {
    const uid = req.user && req.user.id;
    req.session.destroy(() => {
      if (uid) h.audit(uid, 'logout', 'user', uid, null);
      res.clearCookie('nodiretsept.sid');
      res.redirect('/login');
    });
  });

  router.get('/logout', (req, res) => {
    req.session.destroy(() => { res.clearCookie('nodiretsept.sid'); res.redirect('/login'); });
  });

  return router;
};
