'use strict';
/* =====================================================================
   Moetervlog – data collection for behavioural experiments
   ---------------------------------------------------------------------
   How this file is organised (search for the numbers):
     1. DATA        – how everything is stored on the phone
     2. HELPERS     – small tools (dates, escaping, pop-ups, long-press)
     3. SCREENS     – Projects list · ID list of a project · ID detail
     4. DIALOGS     – new project, new ID, add status, filters, menus
     5. EXPORT      – CSV files, sharing, backup / restore
     6. START       – router (which screen to show) + start-up

   Data model (all saved as one JSON object in the browser's storage):
     projects : { id, name, features:[…], filters:[…], createdAt, updatedAt }
     animals  : { id, code, origin, motherId, fatherId, collectedOn, deathOn }
                → one entry per real individual, SHARED by all projects
     members  : { projectId, animalId, group, assembledOn }
                → "this ID takes part in this project" (+ project-specific fields)
     events   : { id, projectId, animalId, feature, value, date, time, note }
                → every status you add, always with a date
   ===================================================================== */

// ---------------------------------------------------------------------
// 1. DATA
// ---------------------------------------------------------------------
const STORE_KEY = 'moetervlog-data-v1';
const SETTINGS_KEY = 'moetervlog-settings-v1';
const DEFAULT_FEATURES = ['weight', 'molt', 'egg sac', 'feeding', 'behaviour', 'death'];

let db = loadData();
let settings = loadSettings();

function emptyDb() {
  return { version: 1, projects: [], animals: [], members: [], events: [] };
}
function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d && Array.isArray(d.projects)) return Object.assign(emptyDb(), d);
  } catch (e) { console.error(e); }
  return emptyDb();
}
function loadSettings() {
  try { return Object.assign({ sep: ',', lastBackup: null }, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch (e) { return { sep: ',', lastBackup: null }; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { alert('Could not save! Storage may be full. Please make a backup.\n\n' + e.message); }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

// Lookups
const project = id => db.projects.find(p => p.id === id);
const animal = id => db.animals.find(a => a.id === id);
const animalByCode = code => db.animals.find(a => same(a.code, code));
const membership = (pid, aid) => db.members.find(m => m.projectId === pid && m.animalId === aid);
const membersOf = pid => db.members.filter(m => m.projectId === pid);
const codeOf = id => (animal(id) || {}).code || '';
const statusOf = a => (a && a.deathOn ? 'dead' : 'alive');      // every ID starts alive
const isDeathFeature = f => ['death', 'dead', 'died'].includes(String(f || '').trim().toLowerCase());
const byNewest = (a, b) => (b.date + (b.time || '') + b.createdAt).localeCompare(a.date + (a.time || '') + a.createdAt);
const eventsOf = (pid, aid) => db.events.filter(e => e.projectId === pid && e.animalId === aid).sort(byNewest);

function touch(pid) { const p = project(pid); if (p) p.updatedAt = new Date().toISOString(); }

function addFeature(p, f) {
  f = String(f || '').trim();
  if (f && !p.features.some(x => same(x, f))) p.features.push(f);
}

/** All events of one project, grouped by animal (newest first). */
function eventIndex(pid) {
  const idx = {};
  db.events.filter(e => e.projectId === pid).sort(byNewest)
    .forEach(e => (idx[e.animalId] = idx[e.animalId] || []).push(e));
  return idx;
}

/** Remove animals that belong to no project and are nobody's parent. */
function cleanupOrphans() {
  const used = new Set(db.members.map(m => m.animalId));
  db.animals.forEach(a => { if (a.motherId) used.add(a.motherId); if (a.fatherId) used.add(a.fatherId); });
  db.animals = db.animals.filter(a => used.has(a.id));
}

// ---------------------------------------------------------------------
// 2. HELPERS
// ---------------------------------------------------------------------
const $ = s => document.querySelector(s);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uniq = arr => [...new Map(arr.filter(x => String(x || '').trim()).map(x => [String(x).trim().toLowerCase(), String(x).trim()])).values()];
const sortNat = arr => arr.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
function localNow() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString(); }
const todayStr = () => localNow().slice(0, 10);
const nowTime = () => localNow().slice(11, 16);
function fmtDate(d) { return d || '–'; }
function daysSince(iso) { return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity; }

// Icons (simple line drawings)
const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  more: svg('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  share: svg('<path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'),
  filter: svg('<path d="M3 6h18M6 12h12M10 18h4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5 12l5 5L20 7"/>'),
  logo: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>'),
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/**
 * Generic pop-up window.
 *   body   : HTML of the content
 *   okText : text of the main button (null = no main button)
 *   onOk(formData, form) : called when the main button is pressed; return false to keep it open
 *   onOpen(form)         : called right after opening (to attach extra events)
 */
function modal({ title, body, okText = 'Save', danger = false, onOk, onOpen }) {
  const dlg = $('#dlg'), f = $('#dlgForm');
  f.innerHTML = `
    <h2>${esc(title)}</h2>
    <div class="dlg-body">${body}</div>
    <div class="dlg-actions">
      <button type="button" class="btn ghost" data-cancel>${okText ? 'Cancel' : 'Close'}</button>
      ${okText ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(okText)}</button>` : ''}
    </div>`;
  f.onsubmit = e => {
    e.preventDefault();
    const r = onOk ? onOk(new FormData(f), f) : true;
    if (r !== false && dlg.open) dlg.close();
  };
  f.querySelector('[data-cancel]').onclick = () => dlg.close();
  if (dlg.open) dlg.close();
  dlg.showModal();
  if (onOpen) onOpen(f);
}
function closeModal() { const d = $('#dlg'); if (d.open) d.close(); }

function confirmBox(title, text, okText, fn) {
  modal({ title, body: `<p>${text}</p>`, okText, danger: true, onOk: () => { fn(); } });
}

function menu(title, items) {
  modal({
    title, okText: null,
    body: `<div class="menu">${items.map((it, i) =>
      `<button type="button" class="menu-item ${it.danger ? 'danger' : ''}" data-mi="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('')}</div>`,
    onOpen: f => f.querySelectorAll('[data-mi]').forEach(b => b.onclick = () => { closeModal(); items[b.dataset.mi].fn(); }),
  });
}

/** Tap = onTap, hold ~0.5 s = onLong (used for multi-select). */
function onPress(el, onTap, onLong) {
  let timer = null, long = false, x = 0, y = 0;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', e => {
    long = false; x = e.clientX; y = e.clientY;
    timer = setTimeout(() => { long = true; timer = null; if (navigator.vibrate) navigator.vibrate(25); onLong(); }, 480);
  });
  el.addEventListener('pointermove', e => { if (timer && (Math.abs(e.clientX - x) > 10 || Math.abs(e.clientY - y) > 10)) stop(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, stop));
  el.addEventListener('click', e => { if (long) { e.preventDefault(); long = false; return; } onTap(); });
  el.addEventListener('contextmenu', e => e.preventDefault());
}

function setTop({ back, title, actions = [] }) {
  const top = $('#topbar');
  top.innerHTML = `
    ${back ? `<a class="tb-btn" href="${back}" aria-label="Back">${I.back}</a>` : `<span class="tb-logo">${I.logo}</span>`}
    <h1>${esc(title)}</h1>
    <div class="tb-actions">${actions.map((a, i) =>
      `<button class="tb-btn" data-i="${i}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${a.icon}</button>`).join('')}</div>`;
  top.querySelectorAll('[data-i]').forEach(b => b.onclick = () => actions[b.dataset.i].fn());
}

function datalist(id, values) {
  return `<datalist id="${id}">${values.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}
const groupsOf = pid => sortNat(uniq(membersOf(pid).map(m => m.group)));
const allCodes = () => sortNat(db.animals.map(a => a.code));
const origins = () => sortNat(uniq(db.animals.map(a => a.origin)));
const valuesFor = (pid, feature) => uniq(db.events.filter(e => e.projectId === pid && same(e.feature, feature)).sort(byNewest).map(e => e.value)).slice(0, 30);

// ---------------------------------------------------------------------
// 3. SCREENS
// ---------------------------------------------------------------------
const app = () => $('#app');

/* ----- 3a. Projects (start screen) ----- */
function renderProjects() {
  document.body.classList.remove('selecting');
  setTop({ title: 'Moetervlog', actions: [{ icon: I.more, label: 'Settings & backup', fn: settingsDialog }] });
  const list = db.projects.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const needBackup = db.events.length + db.animals.length > 0 && daysSince(settings.lastBackup) > 7;

  app().innerHTML = `
    <section class="wrap">
      ${needBackup ? `<div class="banner"><span>${settings.lastBackup ? `Last backup ${daysSince(settings.lastBackup)} days ago.` : 'No backup yet.'} Your data lives only on this device.</span><button class="btn sm primary" id="bkBtn">Back up</button></div>` : ''}
      <p class="eyebrow">Experiments</p>
      ${list.length ? `<ul class="cards">${list.map(p => {
        const ms = membersOf(p.id);
        const alive = ms.filter(m => statusOf(animal(m.animalId)) === 'alive').length;
        return `<li><a class="card" href="#/p/${p.id}">
          <span class="card-title">${esc(p.name)}</span>
          <span class="card-meta">${ms.length} IDs · ${alive} alive</span></a></li>`;
      }).join('')}</ul>`
      : `<div class="empty"><p><b>No projects yet.</b></p><p class="muted">Create your first experiment to start collecting data.</p></div>`}
    </section>
    <button class="fab" id="fab">${I.plus}<span>New project</span></button>`;
  $('#fab').onclick = newProjectDialog;
  if ($('#bkBtn')) $('#bkBtn').onclick = backupNow;
}

/* ----- 3b. ID list of one project ----- */
let ui = { pid: null, selecting: false, selected: new Set(), search: '' };

function renderProject(pid) {
  const p = project(pid);
  if (!p) return go('#/');
  if (ui.pid !== pid) ui = { pid, selecting: false, selected: new Set(), search: '' };

  setTop({
    back: '#/', title: p.name, actions: [
      { icon: I.share, label: 'Export CSV', fn: () => exportDialog(pid) },
      { icon: I.more, label: 'Project menu', fn: () => projectMenu(pid) },
    ],
  });
  app().innerHTML = `
    <section class="wrap">
      <div class="toolbar">
        <input type="search" id="search" placeholder="Search ID…" value="${esc(ui.search)}" autocomplete="off">
        <button class="btn" id="filterBtn">${I.filter}<span>Filter</span><span class="badge" id="fbadge"></span></button>
      </div>
      <div class="chips" id="chips"></div>
      <p class="summary" id="summary"></p>
      <ul class="idlist" id="list"></ul>
      <div id="emptyList"></div>
    </section>
    <div class="selbar" id="selbar"></div>
    <button class="fab" id="fab">${I.plus}<span>New ID</span></button>`;

  $('#search').oninput = e => { ui.search = e.target.value; renderList(pid); };
  $('#filterBtn').onclick = () => filterDialog(pid);
  $('#fab').onclick = () => newIdDialog(pid);
  renderList(pid);
}

/** IDs of a project after search + filters. Each item: { m: membership, a: animal, ev: events (newest first) } */
function visibleMembers(pid, { ignoreFilters = false } = {}) {
  const p = project(pid);
  const filters = ignoreFilters ? [] : (p.filters || []);
  const q = ignoreFilters ? '' : ui.search.trim().toLowerCase();
  const idx = eventIndex(pid);
  return membersOf(pid)
    .map(m => ({ m, a: animal(m.animalId), ev: idx[m.animalId] || [] }))
    .filter(x => x.a)
    .filter(x => !q || x.a.code.toLowerCase().includes(q))
    .filter(x => filters.every(f => matchFilter(x, f)))
    .sort((x, y) => x.a.code.localeCompare(y.a.code, undefined, { numeric: true }));
}

function renderList(pid) {
  const p = project(pid);
  const all = membersOf(pid);
  const rows = visibleMembers(pid);
  const alive = rows.filter(x => statusOf(x.a) === 'alive').length;
  const filters = p.filters || [];

  $('#fbadge').textContent = filters.length || '';
  $('#chips').innerHTML = filters.map((f, i) => `<button class="chip" data-rm="${i}">${esc(filterLabel(f))} <b>×</b></button>`).join('');
  $('#chips').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    p.filters.splice(+b.dataset.rm, 1); save(); renderList(pid);
  });
  $('#summary').textContent = all.length
    ? `${rows.length === all.length ? `${all.length} IDs` : `Showing ${rows.length} of ${all.length} IDs`} · ${alive} alive`
    : '';
  $('#emptyList').innerHTML = !all.length
    ? `<div class="empty"><p><b>No IDs in this project yet.</b></p><p class="muted">Tap “New ID”. Tip: hold an ID to select several at once.</p></div>`
    : (!rows.length ? `<div class="empty"><p class="muted">No ID matches the search / filters.</p></div>` : '');

  const list = $('#list');
  list.innerHTML = rows.map(({ m, a, ev }) => {
    const last = ev[0];
    const sub = [m.group ? `Group ${m.group}` : '', last ? `${last.feature}${last.value ? ': ' + last.value : ''} (${last.date})` : 'no entries'].filter(Boolean).join(' · ');
    return `<li class="idrow ${ui.selected.has(a.id) ? 'sel' : ''} ${statusOf(a)}" data-id="${a.id}">
      <span class="check">${I.check}</span>
      <span class="idmain"><span class="idcode">${esc(a.code)}</span><span class="idsub">${esc(sub)}</span></span>
      <span class="pill ${statusOf(a)}">${statusOf(a)}</span></li>`;
  }).join('');

  list.querySelectorAll('.idrow').forEach(li => {
    const id = li.dataset.id;
    onPress(li,
      () => { if (ui.selecting) toggleSel(pid, id); else go(`#/p/${pid}/a/${id}`); },
      () => { ui.selecting = true; toggleSel(pid, id); });
  });

  // Selection bar (appears after holding an ID)
  document.body.classList.toggle('selecting', ui.selecting);
  const allSel = rows.length && rows.every(x => ui.selected.has(x.a.id));
  $('#selbar').innerHTML = `
    <span class="count">${ui.selected.size} selected</span>
    <button class="btn sm" data-a="all">${allSel ? 'None' : 'All'}</button>
    <button class="btn sm" data-a="group">Group</button>
    <button class="btn sm primary" data-a="status">+ Status</button>
    <button class="btn sm ghost" data-a="x" aria-label="Stop selecting">✕</button>`;
  $('#selbar').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'x') { ui.selecting = false; ui.selected.clear(); renderList(pid); }
    if (a === 'all') { allSel ? ui.selected.clear() : rows.forEach(x => ui.selected.add(x.a.id)); renderList(pid); }
    if (a === 'status') { if (ui.selected.size) addStatusDialog(pid, [...ui.selected]); else toast('Select at least one ID'); }
    if (a === 'group') { if (ui.selected.size) setGroupDialog(pid, [...ui.selected]); else toast('Select at least one ID'); }
  });
}

function toggleSel(pid, id) {
  ui.selected.has(id) ? ui.selected.delete(id) : ui.selected.add(id);
  renderList(pid);
}

/* ----- 3c. Detail page of one ID ----- */
function renderAnimal(pid, aid) {
  const p = project(pid), a = animal(aid);
  if (!p || !a) return go(p ? `#/p/${pid}` : '#/');
  document.body.classList.remove('selecting');
  const m = membership(pid, aid);
  const ev = eventsOf(pid, aid);
  const kids = db.animals.filter(x => x.motherId === aid || x.fatherId === aid)
    .sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
  const others = db.members.filter(x => x.animalId === aid && x.projectId !== pid).map(x => project(x.projectId)).filter(Boolean);
  const link = id => id ? `<a href="#/p/${pid}/a/${id}">${esc(codeOf(id))}</a>` : '–';
  const st = statusOf(a);

  setTop({ back: `#/p/${pid}`, title: a.code, actions: [{ icon: I.more, label: 'ID menu', fn: () => animalMenu(pid, aid) }] });
  app().innerHTML = `
    <section class="wrap">
      ${!m ? `<div class="notice"><span>This ID is not part of <b>${esc(p.name)}</b>.</span><button class="btn sm primary" id="joinBtn">Add to project</button></div>` : ''}
      <div class="hero"><span class="pill ${st}">${st}${a.deathOn ? ' since ' + esc(a.deathOn) : ''}</span>${m && m.group ? `<span class="tag">Group ${esc(m.group)}</span>` : ''}</div>
      <dl class="facts">
        <dt>Group</dt><dd>${esc(m && m.group || '–')}</dd>
        <dt>Origin</dt><dd>${esc(a.origin || '–')}</dd>
        <dt>Mother</dt><dd>${link(a.motherId)}</dd>
        <dt>Father</dt><dd>${link(a.fatherId)}</dd>
        <dt>Collecting date</dt><dd>${fmtDate(a.collectedOn)}</dd>
        <dt>Assembling date</dt><dd>${fmtDate(m && m.assembledOn)}</dd>
        <dt>Death</dt><dd>${fmtDate(a.deathOn)}</dd>
      </dl>
      <button class="btn wide" id="editBtn">Edit details</button>
      ${kids.length ? `<h3>Offspring (${kids.length})</h3><div class="chips">${kids.map(k => `<a class="chip" href="#/p/${pid}/a/${k.id}">${esc(k.code)}</a>`).join('')}</div>` : ''}
      ${others.length ? `<h3>Also in</h3><div class="chips">${others.map(q => `<a class="chip" href="#/p/${q.id}/a/${aid}">${esc(q.name)}</a>`).join('')}</div>` : ''}
      <h3>Status history in this project</h3>
      ${ev.length ? `<ul class="timeline">${ev.map(e => `
        <li data-ev="${e.id}">
          <div class="tl-head"><span><span class="tl-feature">${esc(e.feature)}</span>${e.value ? ': ' + esc(e.value) : ''}</span>
          <span class="tl-date">${esc(e.date)}${e.time ? ' ' + esc(e.time) : ''}</span></div>
          ${e.note ? `<div class="tl-note">${esc(e.note)}</div>` : ''}
        </li>`).join('')}</ul>` : `<p class="muted">No entries yet.</p>`}
    </section>
    ${m ? `<button class="fab" id="fab">${I.plus}<span>Add status</span></button>` : ''}`;

  $('#editBtn').onclick = () => editAnimalDialog(pid, aid);
  if ($('#fab')) $('#fab').onclick = () => addStatusDialog(pid, [aid]);
  if ($('#joinBtn')) $('#joinBtn').onclick = () => { joinProject(pid, aid); save(); render(); };
  app().querySelectorAll('[data-ev]').forEach(li => li.onclick = () => editEventDialog(pid, li.dataset.ev));
}

// ---------------------------------------------------------------------
// 4. DIALOGS
// ---------------------------------------------------------------------

/* ----- Projects ----- */
function newProjectDialog() {
  modal({
    title: 'New project', okText: 'Create',
    body: `<label>Project name<input name="name" required autocomplete="off" placeholder="e.g. Ergandros sex ratio 2026"></label>`,
    onOk: fd => {
      const name = fd.get('name').trim();
      const now = new Date().toISOString();
      const p = { id: uid(), name, features: DEFAULT_FEATURES.slice(), filters: [], createdAt: now, updatedAt: now };
      db.projects.push(p); save(); go(`#/p/${p.id}`);
    },
  });
}

function projectMenu(pid) {
  const p = project(pid);
  menu(p.name, [
    { label: 'Add an existing ID', sub: 'An ID from another project – its shared data comes along', fn: () => addExistingDialog(pid) },
    { label: 'Status types', sub: 'Suggestions shown when adding a status', fn: () => featuresDialog(pid) },
    { label: 'Export CSV', sub: 'Share by mail, to Google Drive or download', fn: () => exportDialog(pid) },
    { label: 'Rename project', fn: () => modal({
      title: 'Rename project', body: `<label>Name<input name="name" required value="${esc(p.name)}"></label>`,
      onOk: fd => { p.name = fd.get('name').trim(); touch(pid); save(); render(); },
    }) },
    { label: 'Delete project', danger: true, fn: () => confirmBox('Delete project?',
      `“${esc(p.name)}” and all its status entries will be deleted. IDs that are also in other projects stay there. Consider exporting first.`,
      'Delete', () => {
        db.projects = db.projects.filter(x => x.id !== pid);
        db.members = db.members.filter(m => m.projectId !== pid);
        db.events = db.events.filter(e => e.projectId !== pid);
        cleanupOrphans(); save(); go('#/');
      }) },
  ]);
}

function featuresDialog(pid) {
  const p = project(pid);
  modal({
    title: 'Status types', okText: 'Add',
    body: `<p class="muted" style="margin:0">These appear as quick buttons when you add a status. You can always type a new one there, too. “death” is special: it marks the ID as dead.</p>
      <div>${p.features.map((f, i) => `<div class="frow"><span>${esc(f)}</span><button type="button" class="btn sm ghost" data-rm="${i}">Remove</button></div>`).join('')}</div>
      <label>New status type<input name="f" autocomplete="off" placeholder="e.g. web size"></label>`,
    onOpen: f => f.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
      p.features.splice(+b.dataset.rm, 1); save(); featuresDialog(pid);
    }),
    onOk: fd => {
      const v = fd.get('f').trim();
      if (!v) return true;
      addFeature(p, v); save(); featuresDialog(pid); return false;
    },
  });
}

/* ----- IDs ----- */
function joinProject(pid, aid, group = '', assembledOn = '') {
  if (!membership(pid, aid)) db.members.push({ projectId: pid, animalId: aid, group, assembledOn });
  touch(pid);
}

/** Find a parent by its ID code; if it does not exist yet, create it (as a new ID without project). */
function resolveParent(code) {
  code = String(code || '').trim();
  if (!code) return null;
  let a = animalByCode(code);
  if (!a) { a = { id: uid(), code, createdAt: new Date().toISOString() }; db.animals.push(a); }
  return a.id;
}

function idFields(pid, d = {}) {
  return `
    <label>Group<input name="group" list="dl-groups" autocomplete="off" value="${esc(d.group || '')}"></label>
    <label>Origin (site / colony / lab line)<input name="origin" list="dl-origins" autocomplete="off" value="${esc(d.origin || '')}"></label>
    <div class="row2">
      <label>Mother ID<input name="mother" list="dl-codes" autocomplete="off" value="${esc(d.mother || '')}"></label>
      <label>Father ID<input name="father" list="dl-codes" autocomplete="off" value="${esc(d.father || '')}"></label>
    </div>
    <p class="hint">Parents are their own IDs. If you type a parent ID that doesn't exist yet, it is created.</p>
    <div class="row2">
      <label>Collecting date<input type="date" name="collectedOn" value="${esc(d.collectedOn || '')}"></label>
      <label>Assembling date<input type="date" name="assembledOn" value="${esc(d.assembledOn || '')}"></label>
    </div>
    ${datalist('dl-groups', groupsOf(pid))}${datalist('dl-origins', origins())}${datalist('dl-codes', allCodes())}`;
}

/* ----- Automatic IDs -----
   4 characters from digits + capital letters, WITHOUT look-alikes
   (0/O, 1/I/L, 5/S, 2/Z, 8/B are left out → easy to read on a vial).
   25 characters → 25^4 = 390 625 possible IDs.
   Never repeats: checked against ALL IDs in ALL projects (incl. parents). */
const AUTO_CHARS = '34679ACDEFGHJKMNPQRTUVWXY';
const AUTO_LEN = 4;

function randomCode() {
  const r = new Uint32Array(AUTO_LEN);
  crypto.getRandomValues(r);
  return Array.from(r, x => AUTO_CHARS[x % AUTO_CHARS.length]).join('');
}
/** n new, unique automatic IDs */
function autoCodes(n = 1, exclude = []) {
  const taken = new Set([...db.animals.map(a => a.code.trim().toUpperCase()), ...exclude]);
  const out = [];
  let tries = 0;
  while (out.length < n && tries++ < n * 1000) {
    const c = randomCode();
    if (!taken.has(c)) { taken.add(c); out.push(c); }
  }
  return out;
}

function newIdDialog(pid) {
  let auto = autoCodes(1)[0];   // pre-filled suggestion
  modal({
    title: 'New ID', okText: 'Create',
    body: `
      <div class="row2">
        <label><span>ID <span class="req">*</span></span>
          <span class="id-input">
            <input name="code" required autocomplete="off" value="${auto}">
            <button type="button" class="btn" id="reroll" title="New automatic ID" aria-label="New automatic ID">↻</button>
          </span></label>
        <label>How many?<input name="count" type="number" min="1" max="500" value="1" inputmode="numeric"></label>
      </div>
      <p class="hint" id="codeHint"></p>
      ${idFields(pid, { collectedOn: '', assembledOn: '' })}`,
    onOpen: f => {
      const isAuto = () => { const c = f.code.value.trim(); return !c || c === auto; };
      const hint = () => {
        const code = f.code.value.trim(), n = +f.count.value || 1;
        let t = '';
        if (n > 1 && isAuto()) t = `Creates ${n} new automatic IDs (4 characters, unique).`;
        else if (isAuto()) t = 'Automatic ID – unique across all projects. Type your own ID to replace it.';
        else if (n > 1) t = `Creates ${n} IDs: ${seriesCodes(code || 'ID', n).slice(0, 3).join(', ')} …`;
        else if (code) {
          const a = animalByCode(code);
          if (a && membership(pid, a.id)) t = '⚠ This ID is already in this project.';
          else if (a) t = 'This ID exists in another project – it will be added here (origin, parents, dates and death are shared).';
        }
        f.querySelector('#codeHint').textContent = t;
      };
      f.code.oninput = hint; f.count.oninput = hint;
      f.querySelector('#reroll').onclick = () => { auto = autoCodes(1)[0]; f.code.value = auto; hint(); };
      hint();
    },
    onOk: fd => {
      const code = fd.get('code').trim();
      const n = Math.max(1, Math.min(500, +fd.get('count') || 1));
      const useAuto = !code || code === auto;
      const codes = useAuto
        ? (n > 1 ? [auto, ...autoCodes(n - 1, [auto])] : [auto])
        : (n > 1 ? seriesCodes(code, n) : [code]);
      let created = 0, linked = 0, skipped = 0;
      codes.forEach(c => {
        let a = animalByCode(c);
        if (a && membership(pid, a.id)) { skipped++; return; }
        if (a) linked++;
        else { a = { id: uid(), code: c, createdAt: new Date().toISOString() }; db.animals.push(a); created++; }
        // shared fields: only fill what is still empty for existing IDs
        a.origin = a.origin || fd.get('origin').trim();
        a.collectedOn = a.collectedOn || fd.get('collectedOn');
        if (!a.motherId) a.motherId = resolveParent(fd.get('mother'));
        if (!a.fatherId) a.fatherId = resolveParent(fd.get('father'));
        joinProject(pid, a.id, fd.get('group').trim(), fd.get('assembledOn'));
      });
      save(); render();
      toast([created && `${created} created`, linked && `${linked} added from other projects`, skipped && `${skipped} already here`].filter(Boolean).join(', '));
      if (skipped && !created && !linked) return false;
    },
  });
}

/** "F", 12 → F01 … F12 */
function seriesCodes(prefix, n) {
  const w = Math.max(2, String(n).length);
  return Array.from({ length: n }, (_, i) => prefix + String(i + 1).padStart(w, '0'));
}

function addExistingDialog(pid) {
  const candidates = db.animals.filter(a => !membership(pid, a.id));
  if (!candidates.length) return toast('There are no IDs outside this project yet');
  modal({
    title: 'Add existing ID', okText: 'Add',
    body: `<label>ID<input name="code" required list="dl-ex" autocomplete="off"></label>
      <label>Group in this project<input name="group" list="dl-groups" autocomplete="off"></label>
      ${datalist('dl-ex', sortNat(candidates.map(a => a.code)))}${datalist('dl-groups', groupsOf(pid))}`,
    onOk: fd => {
      const a = animalByCode(fd.get('code'));
      if (!a) { toast('Unknown ID'); return false; }
      joinProject(pid, a.id, fd.get('group').trim()); save(); render(); toast(`${a.code} added`);
    },
  });
}

function editAnimalDialog(pid, aid) {
  const a = animal(aid), m = membership(pid, aid) || {};
  modal({
    title: `Edit ${a.code}`,
    body: `${idFields(pid, { group: m.group, origin: a.origin, mother: codeOf(a.motherId), father: codeOf(a.fatherId), collectedOn: a.collectedOn, assembledOn: m.assembledOn })}
      <label>Death date (empty = alive)<input type="date" name="deathOn" value="${esc(a.deathOn || '')}"></label>
      <p class="hint">Group and assembling date belong to this project. Everything else is shared by all projects of this ID.</p>`,
    onOk: fd => {
      const mother = fd.get('mother').trim(), father = fd.get('father').trim();
      if (same(mother, a.code) || same(father, a.code)) { toast('An ID cannot be its own parent'); return false; }
      a.origin = fd.get('origin').trim();
      a.motherId = resolveParent(mother);
      a.fatherId = resolveParent(father);
      a.collectedOn = fd.get('collectedOn');
      a.deathOn = fd.get('deathOn');
      if (membership(pid, aid)) {
        m.group = fd.get('group').trim();
        m.assembledOn = fd.get('assembledOn');
      }
      touch(pid); cleanupOrphans(); save(); render(); toast('Saved');
    },
  });
}

function animalMenu(pid, aid) {
  const a = animal(aid);
  const inOthers = db.members.some(m => m.animalId === aid && m.projectId !== pid);
  menu(a.code, [
    { label: 'Rename ID', fn: () => modal({
      title: 'Rename ID', body: `<label>ID<input name="code" required value="${esc(a.code)}"></label>`,
      onOk: fd => {
        const c = fd.get('code').trim(); const other = animalByCode(c);
        if (other && other.id !== aid) { toast('This ID already exists'); return false; }
        a.code = c; save(); render();
      },
    }) },
    ...(membership(pid, aid) ? [{ label: 'Remove from this project', sub: inOthers ? 'Stays in its other projects' : 'Also deletes its entries in this project', danger: true,
      fn: () => confirmBox('Remove from project?', `${esc(a.code)} and its status entries in this project will be removed.`, 'Remove', () => {
        db.members = db.members.filter(m => !(m.projectId === pid && m.animalId === aid));
        db.events = db.events.filter(e => !(e.projectId === pid && e.animalId === aid));
        cleanupOrphans(); save(); go(`#/p/${pid}`);
      }) }] : []),
    { label: 'Delete ID everywhere', danger: true, sub: 'From all projects, with all entries',
      fn: () => confirmBox('Delete ID everywhere?', `${esc(a.code)} will be deleted from all projects. Parent links to it are removed.`, 'Delete', () => {
        db.animals = db.animals.filter(x => x.id !== aid);
        db.members = db.members.filter(m => m.animalId !== aid);
        db.events = db.events.filter(e => e.animalId !== aid);
        db.animals.forEach(x => { if (x.motherId === aid) x.motherId = null; if (x.fatherId === aid) x.fatherId = null; });
        save(); go(`#/p/${pid}`);
      }) },
  ]);
}

function setGroupDialog(pid, aids) {
  modal({
    title: `Set group for ${aids.length} ID${aids.length > 1 ? 's' : ''}`, okText: 'Set',
    body: `<label>Group<input name="group" list="dl-groups" autocomplete="off"></label>${datalist('dl-groups', groupsOf(pid))}`,
    onOk: fd => {
      aids.forEach(id => { const m = membership(pid, id); if (m) m.group = fd.get('group').trim(); });
      touch(pid); save(); ui.selecting = false; ui.selected.clear(); render(); toast('Group set');
    },
  });
}

/* ----- Status entries ----- */
function statusFields(pid, d) {
  const p = project(pid);
  return `
    <div class="chips" id="quick">${p.features.map(f => `<button type="button" class="chip" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</div>
    <label>Status / feature <span class="req">*</span><input name="feature" required list="dl-features" autocomplete="off" value="${esc(d.feature || '')}" placeholder="e.g. molt"></label>
    <label>Value<input name="value" list="dl-values" autocomplete="off" value="${esc(d.value || '')}" placeholder="e.g. yes · 23.4 · aggressive"></label>
    <div class="row2">
      <label>Date<input type="date" name="date" required value="${esc(d.date || todayStr())}"></label>
      <label>Time<input type="time" name="time" value="${esc(d.time == null ? nowTime() : d.time)}"></label>
    </div>
    <label>Note<textarea name="note" rows="2">${esc(d.note || '')}</textarea></label>
    <p class="hint" id="deathHint"></p>
    ${datalist('dl-features', p.features)}<datalist id="dl-values"></datalist>`;
}
function wireStatusFields(pid, f) {
  const update = () => {
    f.querySelector('#dl-values').innerHTML = valuesFor(pid, f.feature.value).map(v => `<option value="${esc(v)}">`).join('');
    f.querySelector('#deathHint').textContent = isDeathFeature(f.feature.value) ? '“death” marks the ID as dead on this date (shared by all its projects).' : '';
  };
  f.feature.oninput = update;
  f.querySelectorAll('#quick [data-f]').forEach(b => b.onclick = () => { f.feature.value = b.dataset.f; update(); f.value.focus(); });
  update();
}

function addStatusDialog(pid, aids) {
  const label = aids.length === 1 ? codeOf(aids[0]) : `${aids.length} IDs`;
  modal({
    title: `Add status · ${label}`, okText: 'Save',
    body: statusFields(pid, {}),
    onOpen: f => wireStatusFields(pid, f),
    onOk: fd => {
      const d = { feature: fd.get('feature').trim(), value: fd.get('value').trim(), date: fd.get('date'), time: fd.get('time'), note: fd.get('note').trim() };
      const p = project(pid);
      aids.forEach(aid => {
        if (isDeathFeature(d.feature)) animal(aid).deathOn = d.date;
        db.events.push(Object.assign({ id: uid(), projectId: pid, animalId: aid, createdAt: new Date().toISOString() }, d));
      });
      addFeature(p, d.feature); touch(pid); save();
      ui.selecting = false; ui.selected.clear(); render();
      toast(`Saved for ${label}`);
    },
  });
}

function editEventDialog(pid, evId) {
  const e = db.events.find(x => x.id === evId);
  if (!e) return;
  modal({
    title: 'Edit entry', okText: 'Save',
    body: statusFields(pid, e) + `<button type="button" class="btn ghost" id="delEv" style="color:var(--dead)">Delete this entry</button>`,
    onOpen: f => {
      wireStatusFields(pid, f);
      f.querySelector('#delEv').onclick = () => {
        db.events = db.events.filter(x => x.id !== evId);
        if (isDeathFeature(e.feature)) {   // was it the death entry? → alive again, unless another death entry exists
          const a = animal(e.animalId);
          const other = db.events.filter(x => x.animalId === a.id && isDeathFeature(x.feature)).sort(byNewest)[0];
          a.deathOn = other ? other.date : '';
        }
        save(); closeModal(); render(); toast('Entry deleted');
      };
    },
    onOk: fd => {
      ['feature', 'value', 'note'].forEach(k => e[k] = fd.get(k).trim());
      e.date = fd.get('date'); e.time = fd.get('time');
      if (isDeathFeature(e.feature)) animal(e.animalId).deathOn = e.date;
      addFeature(project(pid), e.feature); touch(pid); save(); render();
    },
  });
}

/* ----- Filters ----- */
const FILTER_TYPES = {
  group: 'Group is', status: 'Alive / dead', has: 'Has status', hasnot: 'Does NOT have status',
  last: 'Latest value of status is', mother: 'Mother is', father: 'Father is', origin: 'Origin contains',
};
function filterLabel(f) {
  switch (f.type) {
    case 'group': return `Group = ${f.value}`;
    case 'status': return f.value;
    case 'has': return `has ${f.feature}`;
    case 'hasnot': return `no ${f.feature}`;
    case 'last': return `${f.feature} = ${f.value}`;
    case 'mother': return `mother ${f.value}`;
    case 'father': return `father ${f.value}`;
    case 'origin': return `origin ∋ ${f.value}`;
  }
  return '?';
}
function matchFilter({ a, m, ev }, f) {
  switch (f.type) {
    case 'group': return same(m.group, f.value);
    case 'status': return statusOf(a) === f.value;
    case 'has': return ev.some(e => same(e.feature, f.feature));
    case 'hasnot': return !ev.some(e => same(e.feature, f.feature));
    case 'last': { const e = ev.find(x => same(x.feature, f.feature)); return !!e && same(e.value, f.value); }
    case 'mother': return same(codeOf(a.motherId), f.value);
    case 'father': return same(codeOf(a.fatherId), f.value);
    case 'origin': return String(a.origin || '').toLowerCase().includes(String(f.value).toLowerCase());
  }
  return true;
}

function filterDialog(pid) {
  const p = project(pid);
  p.filters = p.filters || [];
  modal({
    title: 'Filters', okText: 'Apply',
    body: `
      <p class="muted" style="margin:0">All filters must match (AND). Filters are remembered per project.</p>
      <div>${p.filters.map((f, i) => `<div class="frow"><span>${esc(filterLabel(f))}</span><button type="button" class="btn sm ghost" data-rm="${i}">Remove</button></div>`).join('') || '<p class="muted">No filters active.</p>'}</div>
      <fieldset>
        <legend>Add a filter</legend>
        <label>Type<select name="type">${Object.entries(FILTER_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label data-show="has hasnot last">Status<input name="feature" list="dl-features" autocomplete="off"></label>
        <label data-show="group last mother father origin">Value<input name="value" list="dl-fv" autocomplete="off"></label>
        <label data-show="status">Show<select name="st"><option value="alive">alive</option><option value="dead">dead</option></select></label>
      </fieldset>
      ${p.filters.length ? '<button type="button" class="btn ghost" id="clearF">Clear all filters</button>' : ''}
      ${datalist('dl-features', uniq([...p.features, ...db.events.filter(e => e.projectId === pid).map(e => e.feature)]))}<datalist id="dl-fv"></datalist>`,
    onOpen: f => {
      const sync = () => {
        const t = f.type.value;
        f.querySelectorAll('[data-show]').forEach(l => l.hidden = !l.dataset.show.split(' ').includes(t));
        const vals = t === 'group' ? groupsOf(pid)
          : (t === 'mother' || t === 'father') ? allCodes()
          : t === 'origin' ? origins()
          : t === 'last' ? valuesFor(pid, f.feature.value) : [];
        f.querySelector('#dl-fv').innerHTML = vals.map(v => `<option value="${esc(v)}">`).join('');
      };
      f.type.onchange = sync; f.feature.oninput = sync; sync();
      f.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { p.filters.splice(+b.dataset.rm, 1); save(); renderList(pid); filterDialog(pid); });
      const c = f.querySelector('#clearF');
      if (c) c.onclick = () => { p.filters = []; save(); renderList(pid); closeModal(); };
    },
    onOk: fd => {
      const t = fd.get('type'), feature = fd.get('feature').trim(), value = fd.get('value').trim();
      let nf = null;
      if (t === 'status') nf = { type: t, value: fd.get('st') };
      else if (['has', 'hasnot'].includes(t) && feature) nf = { type: t, feature };
      else if (t === 'last' && feature && value) nf = { type: t, feature, value };
      else if (['group', 'mother', 'father', 'origin'].includes(t) && value) nf = { type: t, value };
      if (nf) { p.filters.push(nf); save(); }
      renderList(pid);
    },
  });
}

/* ----- Settings ----- */
function settingsDialog() {
  modal({
    title: 'Settings & backup', okText: 'Save',
    body: `
      <label>CSV separator
        <select name="sep">
          <option value="," ${settings.sep === ',' ? 'selected' : ''}>Comma ( , ) – R, Python, Google Sheets</option>
          <option value=";" ${settings.sep === ';' ? 'selected' : ''}>Semicolon ( ; ) – German Excel</option>
        </select></label>
      <fieldset><legend>Backup</legend>
        <p class="muted" style="margin:0">All data is stored only in this browser on this device. Make regular backups – e.g. share them to your Google Drive.
        <br>Last backup: <b>${settings.lastBackup ? settings.lastBackup.slice(0, 10) : 'never'}</b></p>
        <button type="button" class="btn primary" id="bk">Back up everything (.json)</button>
        <label class="btn" style="color:var(--ink)">Restore from backup…<input type="file" id="rs" accept=".json,application/json" hidden></label>
      </fieldset>
      <p class="hint">${db.projects.length} projects · ${db.animals.length} IDs · ${db.events.length} entries</p>`,
    onOpen: f => {
      f.querySelector('#bk').onclick = backupNow;
      f.querySelector('#rs').onchange = e => restoreFrom(e.target.files[0]);
    },
    onOk: fd => { settings.sep = fd.get('sep'); saveSettings(); toast('Saved'); },
  });
}

// ---------------------------------------------------------------------
// 5. EXPORT
// ---------------------------------------------------------------------
function toCsv(rows) {
  const sep = settings.sep;
  const cell = v => {
    v = v == null ? '' : String(v);
    return (v.includes(sep) || /["\r\n]/.test(v)) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return '﻿' + rows.map(r => r.map(cell).join(sep)).join('\r\n');  // ﻿ lets Excel read umlauts
}
const colName = f => String(f).trim().toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_').replace(/^_+|_+$/g, '') || 'status';
const slug = s => String(s).trim().replace(/[^\wäöüÄÖÜß-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';

/**
 * Two CSV files per project:
 *   …_ids.csv     one row per ID (wide): base data + for every status: last value, last date, count
 *   …_entries.csv one row per status entry (long / "tidy") – best for R / statistics
 */
function buildCsvFiles(pid, onlyVisible) {
  const p = project(pid);
  const rows = visibleMembers(pid, { ignoreFilters: !onlyVisible });
  // death already has its own column (death_date), so it gets no extra columns here
  const feats = sortNat(uniq(rows.flatMap(r => r.ev.map(e => e.feature)))).filter(f => !isDeathFeature(f));

  const head = ['id', 'group', 'status', 'collecting_date', 'assembling_date', 'death_date', 'origin', 'mother', 'father', 'n_entries'];
  feats.forEach(f => { const c = colName(f); head.push(`${c}_last_value`, `${c}_last_date`, `${c}_n`); });
  const wide = [head, ...rows.map(({ a, m, ev }) => {
    const r = [a.code, m.group, statusOf(a), a.collectedOn, m.assembledOn, a.deathOn, a.origin, codeOf(a.motherId), codeOf(a.fatherId), ev.length];
    feats.forEach(f => {
      const fe = ev.filter(e => same(e.feature, f));
      r.push(fe[0] ? fe[0].value : '', fe[0] ? fe[0].date : '', fe.length);
    });
    return r;
  })];

  const long = [['id', 'group', 'date', 'time', 'status', 'value', 'note', 'entered_at']];
  rows.forEach(({ a, m, ev }) => ev.slice().reverse().forEach(e =>
    long.push([a.code, m.group, e.date, e.time, e.feature, e.value, e.note, e.createdAt])));

  const base = `${slug(p.name)}_${todayStr()}`;
  const type = 'text/csv';
  return [
    new File([toCsv(wide)], `${base}_ids.csv`, { type }),
    new File([toCsv(long)], `${base}_entries.csv`, { type }),
  ];
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Opens the phone's share sheet (Gmail, Drive, …). Falls back to download on computers. */
async function shareFiles(files, title) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  files.forEach(download);
  toast('Downloaded – attach to a mail or upload to Drive');
  return true;
}

function exportDialog(pid) {
  const p = project(pid);
  const total = membersOf(pid).length, shown = visibleMembers(pid).length;
  modal({
    title: `Export · ${p.name}`, okText: null,
    body: `
      <p class="muted" style="margin:0">Creates two CSV files:<br>
        <b>…_ids.csv</b> – one row per ID (base data + latest value of every status)<br>
        <b>…_entries.csv</b> – one row per status entry (best for R / statistics)</p>
      ${shown !== total ? `<label class="check-line"><input type="checkbox" name="only"> Only the ${shown} IDs matching search / filters (of ${total})</label>` : ''}
      <button type="button" class="btn primary" id="shareBtn">${I.share} Share (mail, Google Drive …)</button>
      <button type="button" class="btn" id="dlBtn">Download to this device</button>
      <p class="hint">Separator: “${esc(settings.sep)}” – change in Settings on the start screen.</p>`,
    onOpen: f => {
      const only = () => !!(f.only && f.only.checked);
      f.querySelector('#shareBtn').onclick = async () => { if (await shareFiles(buildCsvFiles(pid, only()), p.name)) closeModal(); };
      f.querySelector('#dlBtn').onclick = () => { buildCsvFiles(pid, only()).forEach(download); closeModal(); toast('Downloaded'); };
    },
  });
}

async function backupNow() {
  const file = new File([JSON.stringify(db, null, 1)], `moetervlog-backup_${todayStr()}.json`, { type: 'application/json' });
  if (await shareFiles([file], 'Moetervlog backup')) {
    settings.lastBackup = new Date().toISOString(); saveSettings();
    closeModal(); render();
  }
}

function restoreFrom(file) {
  if (!file) return;
  file.text().then(txt => {
    let d;
    try { d = JSON.parse(txt); } catch (e) { return toast('This is not a valid backup file'); }
    if (!d || !Array.isArray(d.projects) || !Array.isArray(d.animals)) return toast('This is not a Moetervlog backup');
    confirmBox('Restore backup?',
      `This REPLACES everything on this device with the backup (${d.projects.length} projects, ${d.animals.length} IDs, ${(d.events || []).length} entries).`,
      'Replace', () => { db = Object.assign(emptyDb(), d); save(); go('#/'); render(); toast('Backup restored'); });
  });
}

// ---------------------------------------------------------------------
// 6. START
// ---------------------------------------------------------------------
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

let lastHash = null;
function render() {
  const h = location.hash || '#/';
  if (h !== lastHash) { window.scrollTo(0, 0); lastHash = h; }
  const [, p, pid, a, aid] = h.slice(1).split('/');   // "#/p/<pid>/a/<aid>"
  if (p === 'p' && pid && a === 'a' && aid) renderAnimal(pid, aid);
  else if (p === 'p' && pid) renderProject(pid);
  else renderProjects();
}

window.addEventListener('hashchange', () => { closeModal(); render(); });
render();

// Ask the browser not to delete our data when space runs low
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
// Offline support + "install as app"
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
