'use strict';

/* =========================================================
   Focus Board — to-do priority plane + reminders
   All data is stored in localStorage under STORE_KEY.
   Theme words live in themes.js (THEMES).
   ========================================================= */

const STORE_KEY = 'focusboard.v1';
const VIEW_KEY = 'focusboard.view';
const DIFFICULTY = ['', 'Trivial', 'Easy', 'Medium', 'Hard', 'Very hard'];
const REPEAT = { none: 'Does not repeat', daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' };
const ICON = {
  edit: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = v => Math.round(v * 10) / 10;
const pad = n => String(n).padStart(2, '0');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- State ---------------- */

function defaultState() {
  return {
    tasks: [],
    reminders: [],
    settings: {
      importanceWeight: 55,
      easeBias: 10,
      theme: 'paper',
      mode: 'auto',
      showLines: true,
      customLines: {},  // artistId -> text, one line per row
      onlyCustom: {},   // artistId -> bool
      bgFade: {},       // themeId -> { page, plane } in %
    },
  };
}

function normalize(s) {
  const d = defaultState();
  const settings = { ...d.settings, ...(s?.settings || {}) };
  settings.theme = THEME_ALIASES[settings.theme] || settings.theme;
  if (!THEMES[settings.theme]) settings.theme = 'paper';
  return {
    tasks: Array.isArray(s?.tasks) ? s.tasks : [],
    reminders: Array.isArray(s?.reminders) ? s.reminders : [],
    settings,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch { /* fall through to a fresh state */ }
  return defaultState();
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('Couldn’t save. Browser storage is unavailable.');
  }
}

const getTask = id => state.tasks.find(t => t.id === id);
const getRem = id => state.reminders.find(r => r.id === id);
const theme = () => THEMES[state.settings.theme] || THEMES.paper;
const artist = () => ARTISTS[theme().artist];

/* ---------------- Scoring ---------------- */

const isPlaced = t => t.urgency != null && t.importance != null;

/* ----- Due-date drift -----
   From the moment a due date is set until the start of the due day, the task's
   urgency drifts from where you placed it (t.urgency) to 10.
     progress   = elapsed / (due − set)                         0 → 1
     multiplier = 0.5 + importance / 10                         0.5× … 1.5×
     pull       = multiplier ≥ 1 ? min(1, progress × multiplier)   maxes out early
                                 : progress ^ (1 / multiplier)     starts slow, lands on the due date
     urgency    = placed + (10 − placed) × pull
   e.g. importance 10, due in 3 weeks → maxes out after 2 weeks. */
const dueStart = t => (t.due ? new Date(`${t.due}T00:00`).getTime() : null);
const dueMultiplier = importance => 0.5 + importance / 10;

function duePull(t, now = Date.now()) {
  if (!t.due || !isPlaced(t)) return 0;
  const end = dueStart(t);
  if (now >= end) return 1;
  const start = Math.min(t.dueSetAt ?? now, end);
  const progress = clamp((now - start) / (end - start), 0, 1);
  const m = dueMultiplier(t.importance);
  return m >= 1 ? Math.min(1, progress * m) : progress ** (1 / m);
}

// Urgency shown on the plane and used for scoring
const urgencyOf = t => round1(t.urgency + (10 - t.urgency) * duePull(t));

// Inverse, for dragging a drifted chip: which placed urgency shows up at `shown`?
function placedUrgencyFor(t, shown) {
  const p = duePull(t);
  return p >= 0.999 ? t.urgency : round1(clamp((shown - 10 * p) / (1 - p), 0, 10));
}

function dueInfo(t) {
  if (!t.due) return null;
  const days = Math.round((dueStart(t) - startOfDay(Date.now())) / 864e5);
  if (days < 0) return { short: 'late', long: `${-days}d overdue`, cls: 'late' };
  if (days === 0) return { short: 'today', long: 'Due today', cls: 'soon' };
  if (days === 1) return { short: '1d', long: 'Due tomorrow', cls: 'soon' };
  return { short: `${days}d`, long: `Due in ${days} days`, cls: days <= 3 ? 'soon' : '' };
}

// score = weighted average of importance & urgency (0–100)
//       + difficulty adjustment (easy tasks up / hard tasks down, or the reverse)
function scoreParts(t) {
  const wI = state.settings.importanceWeight / 100;
  const base = (wI * t.importance + (1 - wI) * urgencyOf(t)) * 10;
  const ease = state.settings.easeBias * (3 - t.difficulty) / 2;
  return { base, ease, total: base + ease };
}

function quadrant(t) {
  const hiI = t.importance >= 5, hiU = urgencyOf(t) >= 5;
  return hiI && hiU ? 'do' : hiI ? 'schedule' : hiU ? 'quick' : 'later';
}
const qLabel = q => theme().quadrants[q];

function ranked() {
  return state.tasks
    .filter(t => !t.done && isPlaced(t))
    .map(t => ({ t, s: scoreParts(t) }))
    .sort((a, b) => b.s.total - a.s.total || a.t.createdAt - b.t.createdAt);
}

function scoreExplain(t) {
  const { base, ease, total } = scoreParts(t);
  const wI = state.settings.importanceWeight;
  const sign = ease >= 0 ? '+' : '−';
  const u = urgencyOf(t);
  const drift = u !== t.urgency ? ` (placed at ${t.urgency}, pulled up by the due date)` : '';
  return `Score ${Math.round(total)} = importance ${t.importance} × ${wI}% + urgency ${u}${drift} × ${100 - wI}% (→ ${Math.round(base)}) ${sign} ${Math.abs(round1(ease))} for difficulty “${DIFFICULTY[t.difficulty]}”`;
}

const dueTag = (t, cls = 'due-tag') => {
  const d = dueInfo(t);
  return d ? `<span class="${cls} ${d.cls}" title="Due ${esc(new Date(dueStart(t)).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))}">${cls === 'due-tag' ? d.short : d.long}</span>` : '';
};

/* ---------------- Small render helpers ---------------- */

const meter = d =>
  `<span class="meter d${d}" title="Difficulty: ${DIFFICULTY[d]}">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= d ? 'on' : ''}"></i>`).join('')}</span>`;

function fillRepeatSelect(sel, value = 'none') {
  sel.innerHTML = Object.entries(REPEAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  sel.value = value;
}

// Difficulty picker: five rising bars + a name
function initDiffPick(el, onChange) {
  el.innerHTML = `<span class="bars" role="radiogroup" aria-label="Difficulty">${[1, 2, 3, 4, 5].map(n =>
    `<button type="button" role="radio" data-v="${n}" aria-label="${n}, ${DIFFICULTY[n]}" title="${DIFFICULTY[n]}"></button>`).join('')}</span><span class="name"></span>`;
  const bars = $('.bars', el);
  bars.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setDiff(el, Number(b.dataset.v));
    onChange?.();
  });
  bars.addEventListener('mouseover', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = Number(b.dataset.v);
    el.classList.remove('d1', 'd2', 'd3', 'd4', 'd5');
    el.classList.add(`d${v}`);
    $$('button', bars).forEach(x => x.classList.toggle('hov', Number(x.dataset.v) <= v));
    $('.name', el).textContent = DIFFICULTY[v];
  });
  bars.addEventListener('mouseleave', () => {
    $$('button', bars).forEach(x => x.classList.remove('hov'));
    setDiff(el, getDiff(el));
  });
  bars.addEventListener('keydown', e => {
    const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    setDiff(el, clamp(getDiff(el) + delta, 1, 5));
    $(`button[data-v="${getDiff(el)}"]`, bars).focus();
    onChange?.();
  });
  setDiff(el, getDiff(el));
}
function setDiff(el, v) {
  el.dataset.value = v;
  el.classList.remove('d1', 'd2', 'd3', 'd4', 'd5');
  el.classList.add(`d${v}`);
  $$('.bars button', el).forEach(b => {
    const n = Number(b.dataset.v);
    b.classList.toggle('on', n <= v);
    b.setAttribute('aria-checked', String(n === v));
    b.tabIndex = n === v ? 0 : -1;
  });
  $('.name', el).textContent = DIFFICULTY[v];
}
const getDiff = el => Number(el.dataset.value) || 3;

/* ---------------- Views ---------------- */

function setView(v) {
  $$('.nav-link').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $('#view-tasks').hidden = v !== 'tasks';
  $('#view-reminders').hidden = v !== 'reminders';
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* not critical */ }
}
const currentView = () => ($('#view-tasks').hidden ? 'reminders' : 'tasks');

/* =========================================================
   THEMES + MASTHEAD
   ========================================================= */

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const resolvedMode = () => (state.settings.mode === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : state.settings.mode);

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = state.settings.theme;
  root.dataset.mode = resolvedMode();
  $('#theme-name').textContent = theme().short;
  $('#open-themes').title = theme().name;
  $$('.quad [data-q]').forEach(el => { el.textContent = qLabel(el.dataset.q); });
  document.body.classList.toggle('no-lines', !state.settings.showLines);
  lineOffset = 0;
  if (!$('#theme-panel').hidden) renderThemePanel();
  renderBackgrounds();
  renderAll();
}
darkQuery.addEventListener('change', () => { if (state.settings.mode === 'auto') applyTheme(); });

function renderThemePanel() {
  const mode = resolvedMode();
  $('#theme-grid').innerHTML = Object.entries(ARTISTS).map(([artistId, a]) => `
    <section class="tp-group">
      <div class="label">${esc(a.name)}</div>
      <div class="tp-grid">${Object.entries(THEMES).filter(([, t]) => t.artist === artistId).map(([id, t]) => `
        <button type="button" class="tp-card" data-theme="${id}" data-mode="${mode}" data-pick="${id}" aria-pressed="${id === state.settings.theme}" title="${esc(t.blurb)}">
          <span class="tp-art"><b>${esc(t.short)}</b><i></i></span>
          <span class="tp-meta"><span class="tp-name">${esc(t.name)}</span>${t.year ? `<br><span class="tp-year">${t.year}</span>` : ''}</span>
        </button>`).join('')}
      </div>
    </section>`).join('');
  $$('.mode-switch button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === state.settings.mode)));
}

function togglePanel(which, open) {
  const panel = $(`#${which}-panel`);
  const btn = $(which === 'theme' ? '#open-themes' : '#open-bg');
  const show = open ?? panel.hidden;
  panel.hidden = !show;
  btn.setAttribute('aria-expanded', String(show));
  if (show) {
    togglePanel(which === 'theme' ? 'bg' : 'theme', false);
    if (which === 'theme') renderThemePanel();
    else renderBgPanel();
  }
}
const toggleThemePanel = open => togglePanel('theme', open);

$('#open-themes').addEventListener('click', e => { e.stopPropagation(); toggleThemePanel(); });
$('#open-bg').addEventListener('click', e => { e.stopPropagation(); togglePanel('bg'); });
$('#theme-grid').addEventListener('click', e => {
  const card = e.target.closest('[data-pick]');
  if (!card) return;
  state.settings.theme = card.dataset.pick;
  save();
  applyTheme();
});
$('.mode-switch').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  state.settings.mode = b.dataset.mode;
  save();
  applyTheme();
});
document.addEventListener('pointerdown', e => {
  if (!$('#theme-panel').hidden && !e.target.closest('#theme-panel, #open-themes')) togglePanel('theme', false);
  if (!$('#bg-panel').hidden && !e.target.closest('#bg-panel, #open-bg')) togglePanel('bg', false);
});

// Lines: user's own lines ("text — credit", shared per artist) + theme lines + group lines
function parseLine(s) {
  const m = s.match(/^(.*\S)\s+(?:—|–|--)\s+(.+)$/);
  return m ? { text: m[1], credit: m[2] } : { text: s, credit: '' };
}
function linePool() {
  const a = theme().artist;
  const custom = (state.settings.customLines[a] || '').split('\n').map(s => s.trim()).filter(Boolean).map(parseLine);
  if (state.settings.onlyCustom[a] && custom.length) return custom;
  return [...custom, ...theme().lines, ...artist().lines].map(l => (typeof l === 'string' ? { text: l, credit: '' } : l));
}

/* ----- Backgrounds: image files in backgrounds/<theme>/ (or backgrounds/default/) ----- */

const BG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
const BG_SLOTS = ['page', 'plane'];
let bgStamp = Date.now();
let bgFound = { page: null, plane: null };

const probeImage = src => new Promise(res => {
  const img = new Image();
  img.onload = () => res(true);
  img.onerror = () => res(false);
  img.src = src;
});

async function findBg(themeId, slot) {
  for (const dir of [themeId, 'default']) {
    const files = BG_EXTS.map(ext => `backgrounds/${dir}/${slot}.${ext}`);
    const ok = await Promise.all(files.map(f => probeImage(`${f}?v=${bgStamp}`)));
    const i = ok.indexOf(true);
    if (i >= 0) return { file: files[i], url: new URL(`${files[i]}?v=${bgStamp}`, location.href).href, shared: dir === 'default' };
  }
  return null;
}

const bgFade = () => ({ page: 75, plane: 60, ...(state.settings.bgFade[state.settings.theme] || {}) });

function applyBgFade() {
  const f = bgFade();
  document.documentElement.style.setProperty('--page-fade', `${f.page}%`);
  document.documentElement.style.setProperty('--plane-fade', String(f.plane / 100));
}

async function renderBackgrounds() {
  const id = state.settings.theme;
  const [page, planeImg] = await Promise.all(BG_SLOTS.map(slot => findBg(id, slot)));
  if (id !== state.settings.theme) return; // theme changed while probing
  bgFound = { page, plane: planeImg };
  const root = document.documentElement;
  root.style.setProperty('--page-img', page ? `url("${page.url}")` : 'none');
  root.style.setProperty('--plane-img', planeImg ? `url("${planeImg.url}")` : 'none');
  document.body.classList.toggle('has-page-bg', !!page);
  plane.classList.toggle('has-bg', !!planeImg);
  applyBgFade();
  if (!$('#bg-panel').hidden) renderBgPanel();
}

function themeFolder(id = state.settings.theme) {
  const path = decodeURIComponent(new URL(`backgrounds/${id}/`, location.href).pathname);
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, '\\') : path;
}

function renderBgPanel() {
  const id = state.settings.theme;
  $('#bg-theme').textContent = theme().name;
  const f = bgFade();
  for (const slot of BG_SLOTS) {
    const el = $(`.bg-slot[data-slot="${slot}"]`);
    const hit = bgFound[slot];
    const thumb = $('.bg-thumb', el);
    thumb.style.backgroundImage = hit ? `url("${hit.url}")` : '';
    thumb.textContent = hit ? '' : 'None';
    $('.bg-file', el).textContent = hit
      ? `${hit.file}${hit.shared ? '  (shared default)' : ''}`
      : `add backgrounds/${id}/${slot}.jpg`;
    const range = $('input[type="range"]', el);
    range.value = f[slot];
    range.disabled = !hit;
    $('output', el).textContent = `${f[slot]}%`;
  }
  $('#bg-help').innerHTML = `Put images in this theme’s folder named <code>page</code> and <code>plane</code> (jpg, png, webp or gif).
    Images in <code>backgrounds/default/</code> apply to every theme that doesn’t have its own.
    New files are picked up when you come back to this window, or press Reload.`;
  $('#bg-folder').value = themeFolder(id);
}

$$('.bg-slot input[type="range"]').forEach(range => range.addEventListener('input', () => {
  const slot = range.closest('.bg-slot').dataset.slot;
  const id = state.settings.theme;
  state.settings.bgFade[id] = { ...bgFade(), [slot]: Number(range.value) };
  save();
  applyBgFade();
  $('output', range.closest('.bg-slot')).textContent = `${range.value}%`;
}));
$('#bg-reload').addEventListener('click', () => { bgStamp = Date.now(); renderBackgrounds(); });
$('#bg-copy').addEventListener('click', async () => {
  const input = $('#bg-folder');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  toast('Folder path copied. Paste it into File Explorer’s address bar.');
});
// Pick up newly added image files when the window regains focus
window.addEventListener('focus', () => { bgStamp = Date.now(); renderBackgrounds(); });
// Dropping a file anywhere would navigate the app away — ignore it
['dragover', 'drop'].forEach(type => document.addEventListener(type, e => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
}));
let lineOffset = 0;
function renderLine() {
  const pool = linePool();
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60e3) / 864e5);
  const line = pool[(day + lineOffset) % pool.length];
  $('#mh-line').textContent = line.text;
  $('#mh-credit').textContent = line.credit;
}
$('#shuffle-line').addEventListener('click', () => {
  lineOffset++;
  renderLine();
  // restart the entrance animation
  const q = $('#mh-line');
  q.style.animation = 'none';
  void q.offsetWidth;
  q.style.animation = '';
});

function renderMasthead() {
  const now = new Date();
  $('#mh-day').textContent = now.toLocaleDateString([], { weekday: 'long' });
  const onBoard = state.tasks.filter(t => !t.done && isPlaced(t)).length;
  const toPlace = state.tasks.filter(t => !t.done && !isPlaced(t)).length;
  const active = state.reminders.filter(r => !r.done);
  const overdue = active.filter(r => r.due <= Date.now()).length;
  const next = active.filter(r => r.due > Date.now()).sort((a, b) => a.due - b.due)[0];
  const parts = [
    esc(now.toLocaleDateString([], { day: 'numeric', month: 'long' })),
    `${onBoard} on the board`,
  ];
  if (toPlace) parts.push(`${toPlace} to place`);
  if (overdue) parts.push(`<b>${overdue} overdue</b>`);
  if (next) parts.push(`<button type="button" data-go="reminders">Next: ${esc(next.title)}, ${esc(fmtWhen(next.due).replace(/^Today, /, ''))}</button>`);
  $('#mh-sub').innerHTML = parts.join(' · ');
  renderLine();
}
$('#mh-sub').addEventListener('click', e => { if (e.target.closest('[data-go]')) setView('reminders'); });

/* =========================================================
   TASKS
   ========================================================= */

const plane = $('#plane');
const chipsEl = $('#chips');
const trayCard = $('#tray-card');
let armedId = null;      // task selected for click-to-place
let justDragged = false; // suppresses the click that follows a drag
let popId = null;        // chip to animate after placing

function addTask(title, difficulty, urgency = null, importance = null, due = null) {
  const t = {
    id: uid(), title: title.trim(), notes: '',
    difficulty: Number(difficulty) || 3,
    urgency, importance,
    due: due || null, dueSetAt: due ? Date.now() : null,
    done: false, createdAt: Date.now(), doneAt: null,
  };
  state.tasks.push(t);
  save();
  return t;
}

function renderTasks() {
  const list = ranked();

  chipsEl.innerHTML = list.map(({ t, s }, i) => {
    const rank = i + 1;
    const u = urgencyOf(t);
    // Faint trail from where the task was placed to where its due date has pulled it
    const trail = u - t.urgency > 0.05
      ? `<span class="drift" data-for="${t.id}" style="left:${t.urgency * 10}%;bottom:${t.importance * 10}%;width:${(u - t.urgency) * 10}%"></span>`
      : '';
    const due = dueInfo(t);
    return `${trail}<button type="button" class="chip d${t.difficulty}${rank === 1 ? ' first' : ''}${t.id === popId ? ' pop' : ''}" data-id="${t.id}"
      style="left:${u * 10}%;bottom:${t.importance * 10}%;--ax:${u / 10};--ay:${t.importance / 10};z-index:${1000 - rank}"
      title="${esc(t.title)}${due ? ` · ${esc(due.long)}` : ''}\n${esc(scoreExplain(t))}"
      aria-label="${esc(t.title)}. Rank ${rank}, score ${Math.round(s.total)}. Urgency ${u}, importance ${t.importance}, difficulty ${DIFFICULTY[t.difficulty]}${due ? `, ${esc(due.long)}` : ''}. Arrow keys move it, Enter edits.">
      <span class="rank">${pad(rank)}</span><span class="t">${esc(t.title)}</span>${dueTag(t)}</button>`;
  }).join('');
  popId = null;
  $('#plane-empty').hidden = list.length > 0 || !$('#quick-add').hidden;

  // Up next
  const next = $('#next-card');
  if (list.length) {
    const { t, s } = list[0];
    const q = quadrant(t);
    next.className = 'next';
    next.dataset.id = t.id;
    next.innerHTML = `
      <div class="label">Up next</div>
      <h2 class="next-title">${esc(t.title)}</h2>
      <div class="next-meta"><span class="${q === 'do' ? 'q-do' : ''}">${esc(qLabel(q))}</span>${meter(t.difficulty)}<span>${DIFFICULTY[t.difficulty]}</span>${dueTag(t, 'due-text')}<span class="score" title="${esc(scoreExplain(t))}">${Math.round(s.total)}</span></div>
      <div class="next-actions">
        <button type="button" class="btn accent" data-act="done">Mark done</button>
        <button type="button" class="btn" data-act="edit">Open</button>
      </div>`;
  } else {
    next.className = 'next empty-state';
    delete next.dataset.id;
    next.innerHTML = `<div class="label">Up next</div><p>Put a task on the plane and your top priority shows up here.</p>`;
  }

  // Queue (everything after #1)
  const rest = list.slice(1);
  $('#queue-block').hidden = rest.length === 0;
  $('#queue-count').textContent = rest.length || '';
  $('#ranked').innerHTML = rest.map(({ t, s }, i) => {
    const q = quadrant(t);
    return `
    <li class="rank-row" data-id="${t.id}" title="${esc(scoreExplain(t))}">
      <input type="checkbox" class="check" aria-label="Mark “${esc(t.title)}” done">
      <span class="num">${pad(i + 2)}</span>
      <div class="rr-main">
        <div class="rr-title">${esc(t.title)}</div>
        <div class="rr-meta"><span class="${q === 'do' ? 'q-do' : ''}">${esc(qLabel(q))}</span>${meter(t.difficulty)}${dueTag(t, 'due-text')}</div>
      </div>
      <span class="rr-score">${Math.round(s.total)}</span>
    </li>`;
  }).join('');

  // To place
  const unplaced = state.tasks.filter(t => !t.done && !isPlaced(t)).sort((a, b) => b.createdAt - a.createdAt);
  if (armedId && !unplaced.some(t => t.id === armedId)) armedId = null;
  $('#tray').innerHTML = unplaced.map(t => `
    <li class="tray-item ${t.id === armedId ? 'armed' : ''}" data-id="${t.id}">
      <button type="button" class="tray-grab" title="Drag onto the plane, or click then click a spot">
        ${meter(t.difficulty)}<span class="t">${esc(t.title)}</span>${dueTag(t)}
      </button>
      <button type="button" class="mini" data-act="edit" aria-label="Edit ${esc(t.title)}">${ICON.edit}</button>
    </li>`).join('');
  $('#tray-count').textContent = unplaced.length || '';
  $('#tray-empty').hidden = unplaced.length > 0;

  // Done
  const done = state.tasks.filter(t => t.done).sort((a, b) => b.doneAt - a.doneAt);
  $('#done-count').textContent = done.length;
  $('#done-panel').hidden = done.length === 0;
  $('#done-list').innerHTML = done.map(t => `
    <li data-id="${t.id}">
      <input type="checkbox" class="check" checked aria-label="Mark “${esc(t.title)}” not done">
      <span class="t">${esc(t.title)}</span>
      <button type="button" class="icon-btn sm" data-act="delete" aria-label="Delete">${ICON.trash}</button>
    </li>`).join('');

  updateArmUI();
  renderMasthead();
}

function updateArmUI() {
  plane.classList.toggle('armed', !!armedId);
  const hint = $('#plane-hint');
  const t = armedId && getTask(armedId);
  hint.classList.toggle('armed', !!t);
  hint.textContent = t
    ? `Click a spot to place “${t.title}” · Esc to cancel`
    : 'Drag to move · click empty space to add a task there';
}

function planeCoords(clientX, clientY) {
  const r = plane.getBoundingClientRect();
  return {
    u: round1(clamp((clientX - r.left) / r.width * 10, 0, 10)),
    i: round1(clamp((r.bottom - clientY) / r.height * 10, 0, 10)),
  };
}

const isOver = (el, e) => {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};

function setDone(t, done) {
  t.done = done;
  t.doneAt = done ? Date.now() : null;
  save();
  renderTasks();
  if (done) {
    toast(`${esc(pick(artist().done))}<small>${esc(t.title)}</small>`, [{ label: 'Undo', run: () => setDone(t, false) }], { html: true, cls: 'cheer' });
  }
}

function deleteTask(id) {
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  const [t] = state.tasks.splice(idx, 1);
  save();
  renderTasks();
  toast(`Deleted “${t.title}”`, [{ label: 'Undo', run: () => { state.tasks.splice(idx, 0, t); save(); renderTasks(); } }]);
}

// `u` is where the chip should appear; with a due date, the stored (placed)
// urgency is worked back from it so the chip lands exactly where it was dropped.
function placeTask(t, u, i) {
  t.importance = i;
  t.urgency ??= u;
  t.urgency = placedUrgencyFor(t, u);
  if (armedId === t.id) armedId = null;
  popId = t.id;
  save();
  renderTasks();
}

/* ----- Drag & drop (pointer events: works for mouse, pen and touch) ----- */

let drag = null;
let coordTip = null;

function showCoordTip(e, u, i) {
  if (!coordTip) {
    coordTip = document.createElement('div');
    coordTip.className = 'coord-tip';
    document.body.appendChild(coordTip);
  }
  coordTip.textContent = `U ${u.toFixed(1)} · I ${i.toFixed(1)}`;
  coordTip.style.left = `${e.clientX + 14}px`;
  coordTip.style.top = `${e.clientY + 16}px`;
}
function hideCoordTip() {
  coordTip?.remove();
  coordTip = null;
}

function beginDrag(e, kind, el, id) {
  if (e.button !== 0) return;
  drag = { kind, el, id, x0: e.clientX, y0: e.clientY, moved: false };
}

plane.addEventListener('pointerdown', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  e.preventDefault();
  chip.focus({ preventScroll: true });
  beginDrag(e, 'chip', chip, chip.dataset.id);
});

$('#tray').addEventListener('pointerdown', e => {
  const grab = e.target.closest('.tray-grab');
  if (!grab) return;
  e.preventDefault();
  beginDrag(e, 'tray', grab.parentElement, grab.parentElement.dataset.id);
});

document.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    drag.moved = true;
    document.body.classList.add('dragging');
    closeQuickAdd();
    if (drag.kind === 'chip') {
      drag.el.classList.add('lifting');
      chipsEl.querySelector(`.drift[data-for="${drag.id}"]`)?.remove();
    } else {
      const t = getTask(drag.id);
      drag.ghost = document.createElement('div');
      drag.ghost.className = `chip drag-ghost d${t.difficulty}`;
      drag.ghost.innerHTML = `<span class="rank">··</span><span class="t">${esc(t.title)}</span>`;
      document.body.appendChild(drag.ghost);
    }
  }

  const overPlane = isOver(plane, e);
  if (drag.kind === 'chip') {
    const overTray = isOver(trayCard, e);
    trayCard.classList.toggle('drop-target', overTray);
    const { u, i } = planeCoords(e.clientX, e.clientY);
    drag.el.style.left = `${u * 10}%`;
    drag.el.style.bottom = `${i * 10}%`;
    drag.el.style.setProperty('--ax', u / 10);
    drag.el.style.setProperty('--ay', i / 10);
    if (!overTray) showCoordTip(e, u, i);
    else hideCoordTip();
  } else {
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;
    plane.classList.toggle('drop-target', overPlane);
    if (overPlane) {
      const { u, i } = planeCoords(e.clientX, e.clientY);
      showCoordTip(e, u, i);
    } else {
      hideCoordTip();
    }
  }
});

function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('dragging');
  plane.classList.remove('drop-target');
  trayCard.classList.remove('drop-target');
  d.ghost?.remove();
  hideCoordTip();
  if (!d.moved) return; // plain click — handled by click listeners

  justDragged = true;
  setTimeout(() => { justDragged = false; }, 0);
  const t = getTask(d.id);
  if (!t || cancelled) return renderTasks();

  if (d.kind === 'chip') {
    if (isOver(trayCard, e)) {
      t.urgency = t.importance = null;
      save();
      renderTasks();
    } else {
      const { u, i } = planeCoords(e.clientX, e.clientY);
      placeTask(t, u, i);
    }
  } else if (isOver(plane, e)) {
    const { u, i } = planeCoords(e.clientX, e.clientY);
    placeTask(t, u, i);
  } else {
    renderTasks();
  }
}
document.addEventListener('pointerup', e => endDrag(e, false));
document.addEventListener('pointercancel', e => endDrag(e, true));

/* ----- Clicks on plane / chips / tray / lists ----- */

plane.addEventListener('click', e => {
  if (justDragged) return;
  if (e.target.closest('#quick-add')) return;
  const chip = e.target.closest('.chip');
  if (chip) return openTask(chip.dataset.id);

  const { u, i } = planeCoords(e.clientX, e.clientY);
  if (armedId) {
    const t = getTask(armedId);
    armedId = null;
    if (t) placeTask(t, u, i);
    else renderTasks();
    return;
  }
  openQuickAdd(u, i);
});

plane.addEventListener('keydown', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const step = e.shiftKey ? 1 : 0.5;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const m = moves[e.key];
  if (!m) return;
  e.preventDefault();
  const t = getTask(chip.dataset.id);
  const shown = round1(clamp(urgencyOf(t) + m[0], 0, 10));
  t.importance = round1(clamp(t.importance + m[1], 0, 10));
  t.urgency = placedUrgencyFor(t, shown);
  save();
  renderTasks();
  chipsEl.querySelector(`[data-id="${t.id}"]`)?.focus();
});

$('#tray').addEventListener('click', e => {
  if (justDragged) return;
  const item = e.target.closest('.tray-item');
  if (!item) return;
  if (e.target.closest('[data-act="edit"]')) return openTask(item.dataset.id);
  armedId = armedId === item.dataset.id ? null : item.dataset.id;
  renderTasks();
});

// Hovering a row highlights its chip, and vice versa
function linkHover(container, selector, otherSelectorFor) {
  container.addEventListener('mouseover', e => {
    const el = e.target.closest(selector);
    $$('.hl').forEach(x => x.classList.remove('hl'));
    if (el?.dataset.id) $$(otherSelectorFor(el.dataset.id)).forEach(x => x.classList.add('hl'));
  });
  container.addEventListener('mouseleave', () => $$('.hl').forEach(x => x.classList.remove('hl')));
}
linkHover($('#ranked'), '.rank-row', id => `.chip[data-id="${id}"]`);
linkHover($('#next-card'), '.next', id => `.chip[data-id="${id}"]`);
linkHover(chipsEl, '.chip', id => `.rank-row[data-id="${id}"]`);

$('#next-card').addEventListener('click', e => {
  const id = $('#next-card').dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!id || !act) return;
  if (act === 'done') setDone(getTask(id), true);
  if (act === 'edit') openTask(id);
});

$('#ranked').addEventListener('click', e => {
  const row = e.target.closest('.rank-row');
  if (!row) return;
  const t = getTask(row.dataset.id);
  if (e.target.matches('.check')) return setDone(t, e.target.checked);
  openTask(t.id);
});

$('#done-list').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  if (e.target.closest('[data-act="delete"]')) return deleteTask(li.dataset.id);
  if (e.target.matches('.check')) setDone(getTask(li.dataset.id), false);
});

$('#clear-done').addEventListener('click', () => {
  const removed = state.tasks.filter(t => t.done);
  state.tasks = state.tasks.filter(t => !t.done);
  save();
  renderTasks();
  toast(`Cleared ${removed.length} done task${removed.length === 1 ? '' : 's'}`, [
    { label: 'Undo', run: () => { state.tasks.push(...removed); save(); renderTasks(); } },
  ]);
});

$('#add-task').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#add-task-title').value.trim();
  if (!title) return;
  const t = addTask(title, getDiff($('#add-task-diff')), null, null, $('#add-task-due').value);
  armedId = t.id; // ready to click-to-place right away
  $('#add-task-title').value = '';
  $('#add-task-due').value = '';
  markEmptyDates();
  renderTasks();
});

// Empty date fields show a dimmed mm/dd/yyyy (CSS can't tell an empty date input apart)
function markEmptyDates() {
  $$('input[type="date"]').forEach(el => el.classList.toggle('is-empty', !el.value));
}
document.addEventListener('input', e => { if (e.target.type === 'date') markEmptyDates(); });
markEmptyDates();

/* ----- Quick add popover (click empty spot on plane) ----- */

const quickAdd = $('#quick-add');
let quickPos = null;

function openQuickAdd(u, i) {
  quickPos = { u, i };
  quickAdd.style.left = `${u * 10}%`;
  quickAdd.style.bottom = `${i * 10}%`;
  quickAdd.classList.toggle('flip-x', u > 6.2);
  quickAdd.classList.toggle('flip-y', i < 2.5);
  quickAdd.hidden = false;
  $('#plane-empty').hidden = true;
  $('#qa-title').value = '';
  $('#qa-title').focus();
}

function closeQuickAdd() {
  if (quickAdd.hidden) return;
  quickAdd.hidden = true;
  quickPos = null;
  $('#plane-empty').hidden = ranked().length > 0;
}

quickAdd.addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#qa-title').value.trim();
  if (!title || !quickPos) return;
  const t = addTask(title, getDiff($('#qa-diff')), quickPos.u, quickPos.i);
  popId = t.id;
  closeQuickAdd();
  renderTasks();
});

document.addEventListener('pointerdown', e => {
  if (!quickAdd.hidden && !e.target.closest('#quick-add') && !isOver(plane, e)) closeQuickAdd();
});

/* ----- Task editor dialog ----- */

const taskDialog = $('#task-dialog');
let editingTaskId = null;

function readTaskForm() {
  const placed = $('#te-placed').checked;
  const t = getTask(editingTaskId);
  const due = $('#te-due').value || null;
  return {
    title: $('#te-title').value.trim(),
    notes: $('#te-notes').value,
    difficulty: getDiff($('#te-diff')),
    urgency: placed ? Number($('#te-urg').value) : null,
    importance: placed ? Number($('#te-imp').value) : null,
    due,
    // The drift clock starts when the due date is set or changed
    dueSetAt: !due ? null : due === t?.due ? t.dueSetAt ?? Date.now() : Date.now(),
  };
}

function refreshTaskForm() {
  const v = readTaskForm();
  const placed = v.urgency != null;
  const shown = placed ? urgencyOf(v) : null;
  $('#te-sliders').classList.toggle('disabled', !placed);
  $('#te-urg-out').textContent = placed && shown !== v.urgency ? `${v.urgency} → ${shown} (due date)` : $('#te-urg').value;
  $('#te-imp-out').textContent = $('#te-imp').value;
  $('#te-due-clear').hidden = !v.due;
  const d = dueInfo(v);
  $('#te-due-out').textContent = !d ? ''
    : placed ? `${d.long} · ${dueMultiplier(v.importance).toFixed(1)}× pull`
    : d.long;
  $('#te-score').innerHTML = !placed
    ? 'Not ranked until it’s on the plane'
    : `<b>${Math.round(scoreParts(v).total)}</b> · ${esc(qLabel(quadrant(v)))}`;
}

function openTask(id) {
  const t = getTask(id);
  if (!t) return;
  editingTaskId = id;
  closeQuickAdd();
  $('#te-title').value = t.title;
  $('#te-notes').value = t.notes || '';
  setDiff($('#te-diff'), t.difficulty);
  $('#te-placed').checked = isPlaced(t);
  $('#te-urg').value = t.urgency ?? 5;
  $('#te-imp').value = t.importance ?? 5;
  $('#te-due').value = t.due || '';
  markEmptyDates();
  refreshTaskForm();
  taskDialog.showModal();
}

$('#task-edit').addEventListener('input', refreshTaskForm);
$('#te-due-clear').addEventListener('click', () => { $('#te-due').value = ''; markEmptyDates(); refreshTaskForm(); });
$('#task-edit').addEventListener('submit', e => {
  e.preventDefault();
  const t = getTask(editingTaskId);
  const v = readTaskForm();
  if (t && v.title) {
    Object.assign(t, v);
    if (isPlaced(t) && armedId === t.id) armedId = null;
    save();
    renderTasks();
  }
  taskDialog.close();
});
$('#te-delete').addEventListener('click', () => {
  taskDialog.close();
  deleteTask(editingTaskId);
});

/* =========================================================
   REMINDERS
   ========================================================= */

const toLocalInput = ts => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = v => (v ? new Date(v).getTime() : NaN);
const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
const atTime = (ts, h, m = 0) => { const d = new Date(ts); d.setHours(h, m, 0, 0); return d.getTime(); };

function nextHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
}

function presetTime(kind) {
  const now = Date.now();
  switch (kind) {
    case '1h': return Math.ceil((now + 3600e3) / 300e3) * 300e3; // round up to 5 min
    case 'tonight': { const t = atTime(now, 20); return t > now ? t : addDays(t, 1); }
    case 'tomorrow': return atTime(addDays(now, 1), 9);
    case 'monday': {
      const d = new Date(atTime(now, 9));
      do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 1);
      return d.getTime();
    }
  }
  return nextHour();
}

function nextOccurrence(ts, repeat) {
  const d = new Date(ts);
  switch (repeat) {
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekdays': do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      break;
    }
    default: return null;
  }
  return d.getTime();
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function clockParts(ts) {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(new Date(ts));
  return {
    main: parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').trim(),
    period: parts.find(p => p.type === 'dayPeriod')?.value || '',
  };
}

function fmtWhen(ts) {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const time = fmtTime(ts);
  if (day === today) return `Today, ${time}`;
  if (day === addDays(today, 1)) return `Tomorrow, ${time}`;
  if (day === addDays(today, -1)) return `Yesterday, ${time}`;
  const d = new Date(ts);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return `${d.toLocaleDateString([], opts)}, ${time}`;
}
const fmtShortDate = ts => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
function rel(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60e3) return diff < 0 ? 'just now' : 'in under a minute';
  if (abs < 3600e3) return rtf.format(Math.round(diff / 60e3), 'minute');
  if (abs < 86400e3) return rtf.format(Math.round(diff / 3600e3), 'hour');
  return rtf.format(Math.round(diff / 86400e3), 'day');
}

function addReminder(title, due, repeat) {
  state.reminders.push({
    id: uid(), title: title.trim(), notes: '', due, repeat,
    done: false, notified: due <= Date.now(), createdAt: Date.now(), doneAt: null,
  });
  save();
}

function completeReminder(r) {
  const next = nextOccurrence(r.due, r.repeat);
  if (next != null) {
    let n = next;
    while (n <= Date.now()) n = nextOccurrence(n, r.repeat);
    const prev = { due: r.due, notified: r.notified };
    r.due = n;
    r.notified = false;
    save();
    renderReminders();
    toast(`Next “${r.title}”: ${fmtWhen(n)}`, [{ label: 'Undo', run: () => { Object.assign(r, prev); save(); renderReminders(); } }]);
  } else {
    r.done = true;
    r.doneAt = Date.now();
    save();
    renderReminders();
    toast(`${esc(pick(artist().done))}<small>${esc(r.title)}</small>`, [
      { label: 'Undo', run: () => { r.done = false; r.doneAt = null; save(); renderReminders(); } },
    ], { html: true, cls: 'cheer' });
  }
}

function snooze(r, kind) {
  const now = Date.now();
  r.due = kind === '10m' ? now + 10 * 60e3
    : kind === '1h' ? now + 3600e3
    : atTime(addDays(now, 1), 9);
  r.notified = false;
  save();
  renderReminders();
  toast(`Snoozed until ${fmtWhen(r.due)}`);
}

function deleteReminder(id) {
  const idx = state.reminders.findIndex(r => r.id === id);
  if (idx < 0) return;
  const [r] = state.reminders.splice(idx, 1);
  save();
  renderReminders();
  toast(`Deleted “${r.title}”`, [{ label: 'Undo', run: () => { state.reminders.splice(idx, 0, r); save(); renderReminders(); } }]);
}

function remRowHTML(r, group) {
  const overdue = group === 'overdue';
  const withDate = overdue || group === 'later';
  const c = clockParts(r.due);
  const time = withDate
    ? `${fmtShortDate(r.due)}<small>${c.main} ${c.period}</small>`
    : `${c.main}<small>${c.period}</small>`;
  const meta = [
    Math.abs(r.due - Date.now()) < 86400e3 || overdue ? `<span class="rel">${rel(r.due)}</span>` : '',
    r.repeat !== 'none' ? `<span>↻ ${REPEAT[r.repeat]}</span>` : '',
  ].join('');
  return `
  <li class="rem ${overdue ? 'is-overdue' : ''}" data-id="${r.id}">
    <span class="rem-time">${time}</span>
    <button type="button" class="check" data-act="done" aria-label="Complete “${esc(r.title)}”"></button>
    <button type="button" class="rem-main" data-act="edit">
      <span class="rem-title">${esc(r.title)}</span>
      ${meta ? `<span class="rem-meta">${meta}</span>` : ''}
      ${r.notes ? `<span class="rem-notes">${esc(r.notes)}</span>` : ''}
    </button>
    <div class="rem-actions">
      ${overdue ? `
        <button type="button" class="snooze" data-snooze="10m">+10m</button>
        <button type="button" class="snooze" data-snooze="1h">+1h</button>
        <button type="button" class="snooze" data-snooze="tomorrow">Tmrw</button>` : ''}
      <button type="button" class="icon-btn sm" data-act="delete" aria-label="Delete">${ICON.trash}</button>
    </div>
  </li>`;
}

function renderReminders() {
  const now = Date.now();
  const today = startOfDay(now);
  const active = state.reminders.filter(r => !r.done).sort((a, b) => a.due - b.due);

  // Group: Overdue → one group per day for the coming week → Later
  const groups = new Map();
  for (const r of active) {
    const day = startOfDay(r.due);
    const key = r.due <= now ? 'overdue' : day < addDays(today, 7) ? `d${day}` : 'later';
    if (!groups.has(key)) groups.set(key, { key, day, items: [] });
    groups.get(key).items.push(r);
  }
  const head = g => {
    if (g.key === 'overdue') return ['Overdue', `${g.items.length} waiting`];
    if (g.key === 'later') return ['Later', 'Beyond this week'];
    const name = g.day === today ? 'Today'
      : g.day === addDays(today, 1) ? 'Tomorrow'
      : new Date(g.day).toLocaleDateString([], { weekday: 'long' });
    return [name, new Date(g.day).toLocaleDateString([], { weekday: g.day <= addDays(today, 1) ? 'short' : undefined, day: 'numeric', month: 'short' })];
  };

  $('#rem-groups').innerHTML = [...groups.values()].map(g => {
    const [name, sub] = head(g);
    const group = g.key.startsWith('d') ? 'day' : g.key;
    return `
    <section class="day ${g.key === 'overdue' ? 'overdue' : ''}">
      <header class="day-head"><div class="day-name">${esc(name)}</div><div class="day-date">${esc(sub)}</div></header>
      <ol class="day-list">${g.items.map(r => remRowHTML(r, group)).join('')}</ol>
    </section>`;
  }).join('');
  $('#rem-empty').hidden = active.length > 0;

  const done = state.reminders.filter(r => r.done).sort((a, b) => b.doneAt - a.doneAt);
  $('#rem-done-panel').hidden = done.length === 0;
  $('#rem-done-count').textContent = done.length;
  $('#rem-done-list').innerHTML = done.slice(0, 50).map(r => `
    <li data-id="${r.id}">
      <button type="button" class="check on" data-act="undo" aria-label="Mark “${esc(r.title)}” not done"></button>
      <span class="t">${esc(r.title)}</span>
      <small>${fmtWhen(r.due)}</small>
      <button type="button" class="icon-btn sm" data-act="delete" aria-label="Delete">${ICON.trash}</button>
    </li>`).join('');

  updateBadge();
  renderMasthead();
}

function updateBadge() {
  const n = state.reminders.filter(r => !r.done && r.due <= Date.now()).length;
  const badge = $('#rem-badge');
  badge.hidden = n === 0;
  badge.textContent = n;
  document.title = n ? `(${n}) Focus Board` : 'Focus Board';
}

$('#rem-groups').addEventListener('click', e => {
  const li = e.target.closest('.rem');
  if (!li) return;
  const r = getRem(li.dataset.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  const sn = e.target.closest('[data-snooze]')?.dataset.snooze;
  if (sn) return snooze(r, sn);
  if (act === 'done') return completeReminder(r);
  if (act === 'delete') return deleteReminder(r.id);
  if (act === 'edit') return openReminder(r.id);
});

$('#rem-done-list').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'delete') return deleteReminder(li.dataset.id);
  if (act === 'undo') {
    const r = getRem(li.dataset.id);
    r.done = false;
    r.doneAt = null;
    r.notified = r.due <= Date.now();
    save();
    renderReminders();
  }
});

$('#clear-rem-done').addEventListener('click', () => {
  const removed = state.reminders.filter(r => r.done);
  state.reminders = state.reminders.filter(r => !r.done);
  save();
  renderReminders();
  toast(`Cleared ${removed.length} completed`, [
    { label: 'Undo', run: () => { state.reminders.push(...removed); save(); renderReminders(); } },
  ]);
});

$('#add-rem').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#add-rem-title').value.trim();
  const due = fromLocalInput($('#add-rem-due').value);
  if (!title || Number.isNaN(due)) return;
  addReminder(title, due, $('#add-rem-repeat').value);
  $('#add-rem-title').value = '';
  $('#add-rem-due').value = toLocalInput(nextHour());
  $('#add-rem-repeat').value = 'none';
  renderReminders();
  $('#add-rem-title').focus();
});

$('#presets').addEventListener('click', e => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  $('#add-rem-due').value = toLocalInput(presetTime(b.dataset.preset));
  $('#add-rem-title').focus();
});

/* ----- Reminder editor ----- */

const remDialog = $('#rem-dialog');
let editingRemId = null;

function openReminder(id) {
  const r = getRem(id);
  if (!r) return;
  editingRemId = id;
  $('#re-title').value = r.title;
  $('#re-notes').value = r.notes || '';
  $('#re-due').value = toLocalInput(r.due);
  $('#re-repeat').value = r.repeat;
  remDialog.showModal();
}

$('#rem-edit').addEventListener('submit', e => {
  e.preventDefault();
  const r = getRem(editingRemId);
  const due = fromLocalInput($('#re-due').value);
  const title = $('#re-title').value.trim();
  if (r && title && !Number.isNaN(due)) {
    if (due !== r.due) r.notified = due <= Date.now();
    Object.assign(r, { title, notes: $('#re-notes').value, due, repeat: $('#re-repeat').value });
    save();
    renderReminders();
  }
  remDialog.close();
});
$('#re-delete').addEventListener('click', () => {
  remDialog.close();
  deleteReminder(editingRemId);
});

$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

/* ----- Alerts: in-app toast + chime + desktop notification ----- */

let audioCtx = null;
function chime() {
  try {
    audioCtx ||= new AudioContext();
    const t = audioCtx.currentTime;
    [[880, 0], [1318.5, 0.16]].forEach(([freq, delay]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(0.18, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + delay);
      o.stop(t + delay + 0.65);
    });
  } catch { /* audio not available */ }
}
// Browsers only allow audio after a user gesture; unlock on first interaction.
document.addEventListener('pointerdown', () => {
  try { audioCtx ||= new AudioContext(); audioCtx.resume(); } catch { /* ignore */ }
}, { once: true });

function alertReminders(list) {
  chime();
  list.slice(0, 3).forEach(r => {
    toast(`<b>${esc(r.title)}</b>${esc(fmtWhen(r.due))}`, [
      { label: 'Done', run: () => completeReminder(r) },
      { label: 'Snooze 10m', run: () => snooze(r, '10m') },
    ], { sticky: true, alert: true, html: true });
  });
  if (list.length > 3) toast(`+${list.length - 3} more reminders due`, [{ label: 'Show', run: () => setView('reminders') }], { sticky: true });

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = list.length === 1
        ? new Notification(list[0].title, { body: fmtWhen(list[0].due) + (list[0].notes ? `\n${list[0].notes}` : ''), tag: list[0].id, requireInteraction: true })
        : new Notification(`${list.length} reminders due`, { body: list.map(r => `• ${r.title}`).join('\n'), requireInteraction: true });
      n.onclick = () => { window.focus(); setView('reminders'); n.close(); };
    } catch { /* notifications unsupported here */ }
  }
}

function tick() {
  const now = Date.now();
  const due = state.reminders.filter(r => !r.done && !r.notified && r.due <= now);
  if (due.length) {
    due.forEach(r => { r.notified = true; });
    save();
    alertReminders(due);
  }
  // Due dates keep pulling tasks right; redraw the plane (never mid-drag)
  if (!drag && state.tasks.some(t => t.due && !t.done)) {
    const focusedId = document.activeElement?.closest?.('.chip')?.dataset.id;
    renderTasks();
    if (focusedId) chipsEl.querySelector(`[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }
  // Don't rebuild the list under someone who is tabbing through it
  if ($('#view-reminders').contains(document.activeElement) && !due.length) {
    updateBadge();
    renderMasthead();
  } else {
    renderReminders();
  }
}

/* =========================================================
   TOASTS
   ========================================================= */

function toast(msg, actions = [], { sticky = false, alert = false, html = false, cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = `toast${alert ? ' alert' : ''}${cls ? ` ${cls}` : ''}`;
  el.setAttribute('role', alert ? 'alert' : 'status');
  el.innerHTML = `<div class="msg">${html ? msg : esc(msg)}</div>`;
  const close = () => el.remove();
  actions.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = a.label;
    b.addEventListener('click', () => { close(); a.run(); });
    el.appendChild(b);
  });
  const x = document.createElement('button');
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '✕';
  x.addEventListener('click', close);
  el.appendChild(x);
  $('#toasts').appendChild(el);
  if (!sticky) setTimeout(close, 6000);
}

/* =========================================================
   SETTINGS
   ========================================================= */

const settingsDialog = $('#settings-dialog');

function renderSettings() {
  const s = state.settings;
  const wI = s.importanceWeight;
  $('#set-weight').value = wI;
  $('#set-bias').value = s.easeBias;
  $('#set-weight-out').textContent = `Importance ${wI}% · Urgency ${100 - wI}%`;
  const b = s.easeBias;
  $('#set-bias-out').textContent = b === 0
    ? 'Difficulty is ignored.'
    : b > 0 ? `Trivial tasks get +${b}, very hard tasks −${b}.`
    : `Very hard tasks get +${-b}, trivial tasks −${-b}.`;
  $('#set-formula').textContent =
    `score = ${(wI / 100).toFixed(2)}×importance×10 + ${(1 - wI / 100).toFixed(2)}×urgency×10 ${b >= 0 ? '+' : '−'} ${Math.abs(b)}×(3 − difficulty)/2`;

  const a = theme().artist;
  $('#set-show-lines').checked = s.showLines;
  $('#set-lines-theme').textContent = artist().name;
  $('#set-custom-lines').value = s.customLines[a] || '';
  $('#set-only-custom').checked = !!s.onlyCustom[a];

  const status = $('#notif-status');
  const btn = $('#notif-enable');
  if (!('Notification' in window)) {
    status.textContent = 'This browser can’t show desktop notifications. You’ll still get an in-app alert and chime while Focus Board is open.';
    btn.hidden = true;
  } else if (Notification.permission === 'granted') {
    status.textContent = 'Desktop notifications are on. They appear while Focus Board is open (it can be minimized).';
    btn.hidden = true;
  } else if (Notification.permission === 'denied') {
    status.textContent = 'Notifications are blocked for this page. Allow them from the site-info icon in the address bar. In-app alerts still work.';
    btn.hidden = true;
  } else {
    status.textContent = 'Get a Windows notification when a reminder is due (while the app is open or minimized).';
    btn.hidden = false;
  }
}

$('#open-settings').addEventListener('click', () => { renderSettings(); settingsDialog.showModal(); });
$('#set-weight').addEventListener('input', e => { state.settings.importanceWeight = Number(e.target.value); save(); renderSettings(); renderTasks(); });
$('#set-bias').addEventListener('input', e => { state.settings.easeBias = Number(e.target.value); save(); renderSettings(); renderTasks(); });
$('#set-show-lines').addEventListener('change', e => {
  state.settings.showLines = e.target.checked;
  save();
  document.body.classList.toggle('no-lines', !state.settings.showLines);
});
$('#set-custom-lines').addEventListener('input', e => {
  state.settings.customLines[theme().artist] = e.target.value;
  save();
  lineOffset = 0;
  renderLine();
});
$('#set-only-custom').addEventListener('change', e => {
  state.settings.onlyCustom[theme().artist] = e.target.checked;
  save();
  lineOffset = 0;
  renderLine();
});
$('#notif-enable').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  renderSettings();
});

$('#export-data').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `focus-board-backup-${toLocalInput(Date.now()).slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#import-data').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = normalize(JSON.parse(await file.text()));
    if (!confirm(`Replace current data with ${data.tasks.length} tasks and ${data.reminders.length} reminders from “${file.name}”?`)) return;
    state = data;
    save();
    applyTheme();
    renderSettings();
    toast('Backup imported');
  } catch {
    toast('That file isn’t a valid Focus Board backup.');
  }
});

/* =========================================================
   GLOBAL
   ========================================================= */

$$('.nav-link').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') {
    closeQuickAdd();
    togglePanel('theme', false);
    togglePanel('bg', false);
    if (armedId) { armedId = null; renderTasks(); }
    return;
  }
  if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'n') {
    e.preventDefault();
    $(currentView() === 'tasks' ? '#add-task-title' : '#add-rem-title').focus();
  }
});

// Keep multiple open windows in sync
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY) return;
  state = load();
  applyTheme();
});

function renderAll() {
  renderTasks();
  renderReminders();
}

/* ----- Init ----- */
initDiffPick($('#add-task-diff'));
initDiffPick($('#qa-diff'));
initDiffPick($('#te-diff'), refreshTaskForm);
fillRepeatSelect($('#add-rem-repeat'));
fillRepeatSelect($('#re-repeat'));
$('#add-rem-due').value = toLocalInput(nextHour());
try { setView(localStorage.getItem(VIEW_KEY) || 'tasks'); } catch { setView('tasks'); }
applyTheme();
tick();
setInterval(tick, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
