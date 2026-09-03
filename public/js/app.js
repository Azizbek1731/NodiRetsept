/* NodiRetsept — umumiy klient mantiq */
(function () {
  'use strict';

  /* ── Toast xabarlari ─────────────────────────────────── */
  const toastBox = () => document.getElementById('toasts');
  window.toast = function (text, type) {
    const box = toastBox();
    if (!box) return alert(text);
    const el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'err' : type === 'success' ? 'ok' : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 260);
    }, 3600);
  };

  /* ── API yordamchisi ─────────────────────────────────── */
  window.api = async function (url, options = {}) {
    const opts = Object.assign({ headers: {} }, options);
    opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers);
    if (opts.body && typeof opts.body === 'object') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) { /* bo'sh javob */ }
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `Xatolik (${res.status})`);
      err.data = data; err.status = res.status;
      throw err;
    }
    return data;
  };

  /* ── Yon panel (mobil) ───────────────────────────────── */
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const burger = document.getElementById('burger');
  function closeSidebar() { sidebar && sidebar.classList.remove('open'); scrim && scrim.classList.remove('open'); }
  if (burger) burger.addEventListener('click', () => {
    sidebar.classList.toggle('open'); scrim.classList.toggle('open');
  });
  if (scrim) scrim.addEventListener('click', closeSidebar);

  /* ── Modal ───────────────────────────────────────────── */
  let lastFocus = null;
  window.openModal = function (id) {
    const m = document.getElementById(id);
    if (!m) return;
    lastFocus = document.activeElement;
    m.classList.add('open');
    document.body.style.overflow = 'hidden';
    const first = m.querySelector('input:not([type=hidden]), select, textarea, button');
    setTimeout(() => first && first.focus(), 60);
  };
  window.closeModal = function (id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('open');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  };
  document.addEventListener('click', (e) => {
    const m = e.target.closest('.modal-backdrop');
    if (m && e.target === m) window.closeModal(m.id);
    const closeBtn = e.target.closest('[data-modal-close]');
    if (closeBtn) window.closeModal(closeBtn.getAttribute('data-modal-close'));
    const openBtn = e.target.closest('[data-modal-open]');
    if (openBtn) { e.preventDefault(); window.openModal(openBtn.getAttribute('data-modal-open')); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal-backdrop.open');
      if (open) window.closeModal(open.id);
      closeSidebar();
    }
  });

  /* ── Nusxa olish ─────────────────────────────────────── */
  window.copyText = async function (text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      window.toast('Nusxa olindi', 'success');
    } catch (e) { window.toast('Nusxa olishning iloji bo\'lmadi', 'error'); }
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (btn) { e.preventDefault(); window.copyText(btn.getAttribute('data-copy')); }
  });

  /* ── Tasdiqlash ──────────────────────────────────────── */
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  /* ── Matn qo'shuvchi tugmalar ────────────────────────── */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-append]');
    if (!b) return;
    e.preventDefault();
    const target = document.querySelector(b.getAttribute('data-append'));
    if (!target) return;
    const t = b.getAttribute('data-text');
    target.value = target.value.trim() ? target.value.replace(/[;\s]*$/, '') + '; ' + t : t;
    target.focus();
  });

  /* ── Retseptni bekor qilish / tiklash ────────────────── */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-rx-cancel], [data-rx-restore]');
    if (!btn) return;
    e.preventDefault();
    const cancel = btn.hasAttribute('data-rx-cancel');
    const id = btn.getAttribute(cancel ? 'data-rx-cancel' : 'data-rx-restore');
    const msg = cancel
      ? 'Retsept bekor qilinsinmi? Bemor uni ochganda «bekor qilingan» degan ogohlantirish ko\'radi.'
      : 'Retsept qayta faollashtirilsinmi?';
    if (!window.confirm(msg)) return;
    btn.classList.add('loading');
    try {
      await window.api('/api/prescriptions/' + id + '/status', {
        method: 'POST', body: { status: cancel ? 'cancelled' : 'active' },
      });
      window.toast(cancel ? 'Retsept bekor qilindi' : 'Retsept faollashtirildi', 'success');
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      window.toast(err.message, 'error');
      btn.classList.remove('loading');
    }
  });

  /* ── Filtr formalarini avtomatik yuborish ────────────── */
  document.querySelectorAll('[data-autosubmit]').forEach((el) => {
    el.addEventListener('change', () => el.form && el.form.submit());
  });

  /* ── Telefon maskasi ─────────────────────────────────── */
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.matches('input[type=tel]')) return;
    let d = el.value.replace(/\D/g, '');
    if (d.startsWith('998')) d = d.slice(3);
    d = d.slice(0, 9);
    const p = [];
    if (d.length) p.push(d.slice(0, 2));
    if (d.length > 2) p.push(d.slice(2, 5));
    if (d.length > 5) p.push(d.slice(5, 7));
    if (d.length > 7) p.push(d.slice(7, 9));
    el.value = d ? '+998 ' + p.join(' ') : '';
  });

  /* ── ID kiritish maydonini formatlash ────────────────── */
  document.querySelectorAll('[data-rx-id-input]').forEach((el) => {
    el.addEventListener('input', () => {
      let v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.startsWith('NR')) v = v.slice(2);
      v = v.slice(0, 8);
      el.value = v ? 'NR-' + (v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v) : '';
    });
  });
})();
