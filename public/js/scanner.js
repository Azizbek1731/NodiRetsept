/* NodiRetsept — QR skaner (jsQR) */
(function () {
  'use strict';
  const video = document.getElementById('scanVideo');
  const placeholder = document.getElementById('scanPlaceholder');
  const frame = document.getElementById('scanFrame');
  const hint = document.getElementById('scanHint');
  const startBtn = document.getElementById('scanStart');
  const stopBtn = document.getElementById('scanStop');
  if (!video || typeof jsQR === 'undefined') return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let raf = null;
  let done = false;

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return window.toast(window.T('scanUnsupported'), 'error');
    }
    startBtn.classList.add('loading');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      placeholder.classList.add('hide');
      video.classList.remove('hide');
      frame.classList.remove('hide');
      hint.classList.remove('hide');
      startBtn.classList.add('hide');
      stopBtn.classList.remove('hide');
      done = false;
      tick();
    } catch (e) {
      const msg = window.T(e && e.name === 'NotAllowedError' ? 'scanDenied' : 'scanOpen');
      window.toast(msg, 'error');
    } finally { startBtn.classList.remove('loading'); }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.classList.add('hide');
    frame.classList.add('hide');
    hint.classList.add('hide');
    placeholder.classList.remove('hide');
    startBtn.classList.remove('hide');
    stopBtn.classList.add('hide');
  }

  function tick() {
    if (done) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        // Faqat markazdagi kvadratni tahlil qilamiz — tezroq va aniqroq
        const side = Math.floor(Math.min(w, h) * 0.72);
        const sx = Math.floor((w - side) / 2), sy = Math.floor((h - side) / 2);
        canvas.width = side; canvas.height = side;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side);
        const img = ctx.getImageData(0, 0, side, side);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) return handle(code.data);
      }
    }
    raf = requestAnimationFrame(tick);
  }

  function handle(text) {
    done = true;
    hint.textContent = window.T('scanFound');
    if (navigator.vibrate) navigator.vibrate(80);
    let target = null;
    try {
      const u = new URL(text, location.origin);
      if (/\/(r|q)\/[A-Za-z0-9-]+/.test(u.pathname)) target = u.pathname + u.search;
    } catch (e) { /* URL emas */ }
    if (!target) {
      const m = String(text).toUpperCase().match(/NR[-\s]?[A-Z0-9]{8}/);
      if (m) target = '/search?id=' + encodeURIComponent(m[0]);
    }
    stop();
    if (target) location.href = target;
    else {
      done = false;
      window.toast(window.T('scanNotOurs'), 'error');
      setTimeout(start, 600);
    }
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
