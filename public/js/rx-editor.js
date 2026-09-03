/* NodiRetsept — retsept yozish oynasi */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const modal = $('#rxModal');
  if (!modal) return;
  const T = window.T;
  const TITLES = {
    newTitle: $('#rxModalTitle').textContent.trim(),
    subtitle: $('#rxModalSub').textContent.trim(),
  };

  const form = $('#rxForm');
  const drugList = $('#drugList');
  const tpl = $('#drugTemplate');
  let selectedPatient = null;
  let editingId = null;

  /* ══ Oynani ochish/yopish ══ */
  function reset() {
    editingId = null;
    selectedPatient = null;
    form.reset();
    $('#rxId').value = '';
    $('#rxDate').value = new Date().toISOString().slice(0, 10);
    $('#patientId').value = '';
    $('#patientPicked').classList.add('hide');
    $('#patientSearchWrap').classList.remove('hide');
    $('#newPatientBox').classList.add('hide');
    $('#patientSearch').value = '';
    $('#patientResults').classList.remove('open');
    drugList.innerHTML = '';
    addDrugRow();
    $('#rxError').classList.add('hide');
    form.classList.remove('hide');
    $('#rxSuccess').classList.add('hide');
    $('#rxSave').classList.remove('hide');
    $('#rxAgain').classList.add('hide');
    $('#rxFootHint').classList.remove('hide');
    $('#rxModalTitle').textContent = TITLES.newTitle;
    $('#rxModalSub').textContent = TITLES.subtitle;
  }

  async function open(opts = {}) {
    reset();
    if (opts.patient) pickPatient(opts.patient);
    if (opts.editId) await loadForEdit(opts.editId);
    window.openModal('rxModal');
    if (!opts.patient && !opts.editId) setTimeout(() => $('#patientSearch').focus(), 120);
  }
  window.openRxEditor = open;

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rx-new]');
    if (btn) {
      e.preventDefault();
      const raw = btn.getAttribute('data-patient');
      open({ patient: raw ? JSON.parse(raw) : null });
    }
    const ed = e.target.closest('[data-rx-edit]');
    if (ed) { e.preventDefault(); open({ editId: ed.getAttribute('data-rx-edit') }); }
    if (e.target.closest('[data-rx-close]')) window.closeModal('rxModal');
  });

  /* ══ Bemor tanlash ══ */
  const searchInput = $('#patientSearch');
  const results = $('#patientResults');
  let searchTimer = null;
  let hlIndex = -1;

  function renderResults(list, q) {
    results.innerHTML = '';
    hlIndex = -1;
    list.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'picker-item';
      item.innerHTML =
        `<span class="avatar sm">${initials(p.full_name)}</span>
         <span class="grow"><span class="nm">${esc(p.full_name)}</span><br>
         <span class="meta">${p.birth_year ? p.birth_year + ' ' + T('yearShort') : T('notSpecified')}${p.age != null ? ' · ' + p.age + ' ' + T('yearsOld') : ''}${p.code ? ' · ' + p.code : ''}${p.rx_count ? ' · ' + p.rx_count + ' ' + T('rxCount') : ''}</span></span>`;
      item.addEventListener('click', () => pickPatient(p));
      results.appendChild(item);
    });
    const add = document.createElement('div');
    add.className = 'picker-item add';
    add.innerHTML = `<span class="avatar sm" style="background:var(--brand);color:#fff">+</span>
      <span class="grow"><span class="nm">${esc(T('newPatient'))}</span><br>
      <span class="meta">${q ? '«' + esc(q) + '»' : esc(T('notFoundInList'))} — ${esc(T('createNewCard'))}</span></span>`;
    add.addEventListener('click', () => showNewPatient(q));
    results.appendChild(add);
    results.classList.add('open');
  }

  async function doSearch(q) {
    try {
      const data = await window.api('/api/patients/search?q=' + encodeURIComponent(q || ''));
      renderResults(data.patients, q);
    } catch (e) { renderResults([], q); }
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    searchTimer = setTimeout(() => doSearch(q), 220);
  });
  searchInput.addEventListener('focus', () => { if (!results.classList.contains('open')) doSearch(searchInput.value.trim()); });
  searchInput.addEventListener('keydown', (e) => {
    const items = $$('.picker-item', results);
    if (!items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hlIndex = (hlIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('hl', i === hlIndex));
      items[hlIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (items[hlIndex] || items[0]).click();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.picker')) $$('.picker-results').forEach((r) => r.classList.remove('open'));
  });

  function pickPatient(p) {
    selectedPatient = p;
    $('#patientId').value = p.id;
    $('#ppAvatar').textContent = initials(p.full_name);
    $('#ppName').textContent = p.full_name;
    const bits = [];
    if (p.birth_year) bits.push(p.birth_year + ' ' + T('yearShort') + (p.age != null ? ` (${p.age} ${T('yearsOld')})` : ''));
    if (p.gender) bits.push(p.gender);
    if (p.code) bits.push(p.code);
    if (p.phone_fmt || p.phone) bits.push(p.phone_fmt || p.phone);
    $('#ppMeta').textContent = bits.join(' · ') || '—';
    $('#patientPicked').classList.remove('hide');
    $('#patientSearchWrap').classList.add('hide');
    $('#newPatientBox').classList.add('hide');
    results.classList.remove('open');
  }
  $('#ppChange').addEventListener('click', () => {
    $('#patientPicked').classList.add('hide');
    $('#patientSearchWrap').classList.remove('hide');
    searchInput.value = '';
    searchInput.focus();
    doSearch('');
  });

  /* ══ Yangi bemor ══ */
  function showNewPatient(q) {
    $('#newPatientBox').classList.remove('hide');
    results.classList.remove('open');
    if (q && !/^\d+$/.test(q)) $('#npName').value = q;
    setTimeout(() => $('#npName').focus(), 60);
  }
  $('#npCancel').addEventListener('click', () => $('#newPatientBox').classList.add('hide'));

  $('#npSave').addEventListener('click', async function () {
    const btn = this;
    const body = {
      full_name: $('#npName').value.trim(),
      birth_year: $('#npYear').value.trim(),
      gender: $('#npGender').value,
      phone: $('#npPhone').value.trim(),
      address: $('#npAddress').value.trim(),
    };
    if (body.full_name.length < 3) return window.toast(T('enterName'), 'error');
    if (!body.birth_year) return window.toast(T('enterYear'), 'error');
    btn.classList.add('loading');
    try {
      const data = await window.api('/api/patients', { method: 'POST', body });
      window.toast(T('patientAdded'), 'success');
      $('#newPatientBox').classList.add('hide');
      ['#npName', '#npYear', '#npPhone', '#npAddress'].forEach((s) => { $(s).value = ''; });
      pickPatient(data.patient);
    } catch (err) {
      if (err.data && err.data.duplicate) {
        if (confirm(err.message + '\n\n' + T('selectExisting'))) {
          const d = await window.api('/api/patients/search?q=' + encodeURIComponent(body.full_name));
          const found = d.patients.find((x) => x.id === err.data.patient_id);
          if (found) { $('#newPatientBox').classList.add('hide'); pickPatient(found); }
        }
      } else window.toast(err.message, 'error');
    } finally { btn.classList.remove('loading'); }
  });

  /* ══ Dorilar ══ */
  function addDrugRow(data) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    drugList.appendChild(node);
    if (data) $$('[data-f]', node).forEach((inp) => { inp.value = data[inp.getAttribute('data-f')] || ''; });
    bindDrugRow(node);
    renumber();
    updatePreview(node);
    return node;
  }
  $('#addDrug').addEventListener('click', () => {
    const row = addDrugRow();
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('[data-f="drug_name"]', row).focus();
  });

  function renumber() {
    $$('[data-drug-row]', drugList).forEach((row, i) => {
      $('.drug-num', row).textContent = i + 1;
      $('[data-drug-remove]', row).style.visibility = drugList.children.length > 1 ? 'visible' : 'hidden';
    });
  }

  function bindDrugRow(row) {
    $('[data-drug-remove]', row).addEventListener('click', () => { row.remove(); renumber(); });
    $$('[data-f]', row).forEach((inp) => inp.addEventListener('input', () => updatePreview(row)));

    // Dori nomi bo'yicha avtomatik to'ldirish
    const nameInput = $('[data-f="drug_name"]', row);
    const box = $('[data-drug-results]', row);
    let t = null;
    nameInput.addEventListener('input', () => {
      clearTimeout(t);
      const q = nameInput.value.trim();
      if (q.length < 2) { box.classList.remove('open'); return; }
      t = setTimeout(async () => {
        try {
          const d = await window.api('/api/drugs?q=' + encodeURIComponent(q));
          box.innerHTML = '';
          if (!d.drugs.length) { box.classList.remove('open'); return; }
          d.drugs.forEach((drug) => {
            const it = document.createElement('div');
            it.className = 'picker-item';
            it.innerHTML = `<span class="grow"><span class="nm">${esc(drug.name)}</span><br>
              <span class="meta">${esc(drug.strength || '')} ${esc(drug.form || '')}${drug.atc ? ' · ATC ' + drug.atc : ''}</span></span>`;
            it.addEventListener('click', () => {
              nameInput.value = drug.name;
              if (drug.strength) $('[data-f="strength"]', row).value = drug.strength;
              if (drug.form) $('[data-f="form"]', row).value = drug.form;
              box.classList.remove('open');
              updatePreview(row);
              $('[data-f="quantity"]', row).focus();
            });
            box.appendChild(it);
          });
          box.classList.add('open');
        } catch (e) { box.classList.remove('open'); }
      }, 200);
    });
    nameInput.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 180));
  }

  function rowData(row) {
    const o = {};
    $$('[data-f]', row).forEach((i) => { o[i.getAttribute('data-f')] = i.value.trim(); });
    return o;
  }

  function updatePreview(row) {
    const d = rowData(row);
    if (!d.drug_name) { $('[data-preview]', row).innerHTML = '<span class="muted">Rp.: …</span>'; return; }
    const head = [d.drug_name, d.strength].filter(Boolean).join(' ');
    const dtd = [d.quantity ? 'D.t.d. N. ' + d.quantity : '', d.form ? 'in ' + d.form : ''].filter(Boolean).join(' ');
    const sig = [d.dose, d.route, d.frequency, d.duration, d.instructions].filter(Boolean).join(', ');
    $('[data-preview]', row).innerHTML =
      `<b>Rp.:</b> ${esc(head)}${dtd ? ' &nbsp;·&nbsp; ' + esc(dtd) : ''}${sig ? '<br><b>S.</b> ' + esc(sig) : ''}`;
  }

  /* ══ Tahrirlash uchun yuklash ══ */
  async function loadForEdit(id) {
    try {
      const { prescription: p } = await window.api('/api/prescriptions/' + id);
      editingId = p.id;
      $('#rxId').value = p.id;
      $('#rxModalTitle').textContent = T('editTitle');
      $('#rxModalSub').textContent = p.pretty_id;
      pickPatient(Object.assign({}, p.patient, { age: p.patient.birth_year ? new Date().getFullYear() - p.patient.birth_year : null }));
      $('#rxDate').value = p.visit_date || '';
      $('#rxComplaints').value = p.complaints || '';
      $('#rxDiagnosis').value = p.diagnosis || '';
      $('#rxIcd').value = p.icd10 || '';
      $('#rxPhysio').value = p.physiotherapy || '';
      $('#rxRecommend').value = p.recommendations || '';
      $('#rxNext').value = p.next_visit || '';
      drugList.innerHTML = '';
      (p.items.length ? p.items : [null]).forEach((it) => addDrugRow(it));
      $('#rxSave').innerHTML = '<span>' + T('submitEdit') + '</span>';
    } catch (e) { window.toast(e.message, 'error'); }
  }

  /* ══ Saqlash ══ */
  $('#rxSave').addEventListener('click', async function () {
    const btn = this;
    const err = $('#rxError');
    err.classList.add('hide');

    const items = $$('[data-drug-row]', drugList).map(rowData).filter((d) => d.drug_name);
    const body = {
      patient_id: $('#patientId').value,
      visit_date: $('#rxDate').value,
      complaints: $('#rxComplaints').value.trim(),
      diagnosis: $('#rxDiagnosis').value.trim(),
      icd10: $('#rxIcd').value.trim(),
      physiotherapy: $('#rxPhysio').value.trim(),
      recommendations: $('#rxRecommend').value.trim(),
      next_visit: $('#rxNext').value || null,
      items,
    };
    const doctorSel = $('#rxDoctor');
    if (doctorSel) body.doctor_id = doctorSel.value;

    if (!body.patient_id) return fail(T('selectPatientFirst'));
    if (!body.visit_date) return fail(T('enterVisitDate'));
    if (!body.diagnosis) return fail(T('enterDiagnosis'));
    if (!items.length && !body.physiotherapy) return fail(T('needDrugOrPhysio'));

    btn.classList.add('loading');
    try {
      const data = editingId
        ? await window.api('/api/prescriptions/' + editingId, { method: 'PUT', body })
        : await window.api('/api/prescriptions', { method: 'POST', body });
      showSuccess(data);
    } catch (e) { fail(e.message); } finally { btn.classList.remove('loading'); }

    function fail(msg) {
      err.textContent = msg;
      err.classList.remove('hide');
      err.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.toast(msg, 'error');
    }
  });

  function showSuccess(data) {
    form.classList.add('hide');
    $('#rxSuccess').classList.remove('hide');
    $('#rxSave').classList.add('hide');
    $('#rxAgain').classList.remove('hide');
    $('#rxFootHint').classList.add('hide');
    $('#okQr').src = data.qr;
    $('#okId').textContent = data.pretty_id;
    $('#okLink').value = data.url;
    $('#okView').href = data.view_path;
    $('#okPdf').href = data.pdf_path;
    $('#okPrint').href = data.view_path + '?print=1';
    $('#rxModalTitle').textContent = editingId ? T('updatedTitle') : T('readyTitle');
    $('#rxModalSub').textContent = T('readySub');
    window.toast(T('rxSaved', { id: data.pretty_id }), 'success');
    if (typeof window.onRxSaved === 'function') window.onRxSaved(data);
  }

  $('#okCopy').addEventListener('click', () => window.copyText($('#okLink').value));
  $('#rxAgain').addEventListener('click', () => { reset(); setTimeout(() => $('#patientSearch').focus(), 80); });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && $('#rxSuccess').classList.contains('hide') === false) location.reload();
  });
  $$('[data-rx-close]').forEach((b) => b.addEventListener('click', () => {
    if (!$('#rxSuccess').classList.contains('hide')) location.reload();
  }));

  /* ══ Yordamchi ══ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
})();
