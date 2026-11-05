// app.js — screens and navigation.
// Routes use the URL hash: #/home, #/list, #/practise/<id>, #/review, #/settings

import * as db from './db.js';
import { parseAndValidate, slotParts, fillSlots, isUnfilled, CATEGORIES } from './data.js';
import { tokenizeAnswer, hiddenSet } from './fade.js';
import { todayStr, applyRating, mastery, isDue, todaysReview, summarize, DAYS_FOR_BOX } from './review.js';

export const APP_VERSION = '0.1.0 (Phase 1)';

// ---------- App state (loaded from IndexedDB) ----------
const state = {
  content: null,      // imported file
  slots: {},          // current slot values (editable in Settings)
  progress: new Map(),// question id → progress record
  session: null,      // today's review session { ids, index, results }
  practise: null,     // current practise screen { id, step, level, rated }
  flash: null,        // one-time message for the next render
};

async function loadState() {
  state.content = (await db.kvGet('content')) || null;
  state.slots = (await db.kvGet('slots')) || state.content?.slots || {};
  state.progress = await db.getAllProgress();
}

const questions = () => state.content?.questions ?? [];
const findQuestion = (id) => questions().find((q) => q.id === id);
const findStory = (id) => state.content?.stories.find((s) => s.id === id);

// ---------- Tiny DOM helper ----------
// h('div', {class:'card'}, 'text', childNode) → <div class="card">text…</div>
// Text is always added with textContent-style nodes, so imported text can't inject HTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Text with {{Slots}} filled in; unfilled values are highlighted. */
function slotText(text) {
  return slotParts(text, state.slots).map((p) =>
    p.unfilled ? h('mark', { class: 'unfilled', title: `Slot "${p.slot}" is not filled yet` }, p.text) : p.text);
}

const CATEGORY_LABEL = { core: 'Core', motivation: 'Motivation', behavioral: 'Behavioral', todo: 'To do' };
const MASTERY_LABEL = { new: 'New', learning: 'Learning', mastered: 'Mastered' };

function masteryBadge(p) {
  const m = mastery(p);
  const text = m === 'learning' ? `Box ${p.box}` : MASTERY_LABEL[m];
  return h('span', { class: `badge m-${m}` }, text);
}
function statusBadge(q) {
  return q.status === 'original' ? null : h('span', { class: `badge s-${q.status}` }, q.status);
}
function formatDate(dateStr) {
  const today = todayStr();
  if (dateStr <= today) return 'today';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------- Router ----------
const main = () => document.getElementById('main');

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  const [, route, arg] = (location.hash || '#/home').split('/');
  let view;
  if (!state.content && route !== 'settings') view = viewWelcome();
  else if (route === 'list') view = viewList();
  else if (route === 'practise' && arg) view = viewPractiseSingle(decodeURIComponent(arg));
  else if (route === 'review') view = viewReview();
  else if (route === 'settings') view = viewSettings();
  else view = viewHome();

  main().replaceChildren(view);
  for (const a of document.querySelectorAll('.tabbar a')) {
    const active = a.dataset.route === (route || 'home') ||
      (a.dataset.route === 'list' && route === 'practise');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  state.flash = null;
}

// ---------- Welcome (first run) ----------
function viewWelcome() {
  return h('section', { class: 'stack' },
    h('h1', null, 'Interview Drill'),
    h('div', { class: 'card' },
      h('p', null, 'Learn the key points of your interview answers, then practise until they feel natural. Load your answer file to start.'),
      h('div', { class: 'stack' }, importButton('Import file'), sampleButton('Try sample data')),
      h('p', { class: 'small muted' }, 'Your data stays on this device.')),
    importMessages());
}

// ---------- Home ----------
function viewHome() {
  const qs = questions();
  const s = summarize(qs, state.progress);
  const review = todaysReview(qs, state.progress, todayStr());
  const count = review.all.length;

  return h('section', { class: 'stack' },
    h('h1', null, state.content.title),
    flashCard(),
    h('div', { class: 'card stats' },
      stat(s.mastered, 'Mastered'), stat(s.learning, 'Learning'), stat(s.new, 'New'), stat(count, 'Today', 'accent')),
    h('button', { class: 'btn primary big', onclick: () => { state.session = null; go('#/review'); }, disabled: count === 0 },
      count ? `Start today's review (${count})` : 'All done for today'),
    h('div', { class: 'grid2' },
      h('a', { class: 'btn', href: '#/list' }, 'Practise one question'),
      h('button', { class: 'btn', disabled: true, title: 'Coming in Phase 2' }, 'Mock interview'),
      h('button', { class: 'btn', disabled: true, title: 'Coming in Phase 2' }, 'Stories'),
      h('button', { class: 'btn', disabled: true, title: 'Coming in Phase 2' }, 'Questions to ask')),
    h('p', { class: 'small muted center' }, 'Mock interview, Stories and Questions to ask arrive in Phase 2.'));
}

function stat(n, label, cls) {
  return h('div', { class: `stat ${cls || ''}` }, h('span', { class: 'num' }, n), h('span', { class: 'lbl' }, label));
}

function flashCard() {
  if (!state.flash) return null;
  if (state.flash.node) return state.flash.node;
  return h('div', { class: `card note ${state.flash.kind || ''}`, role: 'status' }, state.flash.text);
}

// ---------- Question list ----------
function viewList() {
  const today = todayStr();
  const groups = CATEGORIES.map((cat) => {
    const items = questions().filter((q) => q.category === cat);
    if (!items.length) return null;
    return h('div', { class: 'stack' },
      h('h2', null, CATEGORY_LABEL[cat]),
      h('ul', { class: 'qlist' }, items.map((q) => {
        const p = state.progress.get(q.id);
        return h('li', null,
          h('a', { class: 'card qitem', href: `#/practise/${encodeURIComponent(q.id)}` },
            h('span', { class: 'qtext' }, slotText(q.question)),
            h('span', { class: 'badges' },
              statusBadge(q), masteryBadge(p), isDue(p, today) ? h('span', { class: 'badge due' }, 'due') : null)));
      })));
  });
  return h('section', { class: 'stack' }, h('h1', null, 'Questions'), groups);
}

// ---------- Practise (shared by single question and review) ----------
const STEPS = ['Recall', 'Key points', 'Fade-out', 'Rate'];

function startPractise(id) {
  const p = state.progress.get(id);
  // Default fade level follows the box: box 1 → level 0 … box 5 → level 4.
  state.practise = { id, step: 0, level: Math.min(4, (p?.box ?? 1) - 1), rated: null };
}

function viewPractiseSingle(id) {
  const q = findQuestion(id);
  if (!q) return h('section', { class: 'stack' }, h('div', { class: 'card' }, 'Question not found. ', h('a', { href: '#/list' }, 'Back to list')));
  if (state.practise?.id !== id || state.practise.mode !== 'single') { startPractise(id); state.practise.mode = 'single'; }
  return practiseView(q, null);
}

function practiseView(q, header) {
  const ps = state.practise;
  const rerender = () => render();
  const setStep = (i) => { ps.step = i; rerender(); };

  const stepper = h('nav', { class: 'stepper', 'aria-label': 'Practise steps' },
    STEPS.map((label, i) => h('button', {
      class: `step ${i === ps.step ? 'active' : ''}`, 'aria-current': i === ps.step ? 'step' : null,
      onclick: () => setStep(i),
    }, h('span', { class: 'n' }, i + 1), label)));

  let body;
  if (ps.step === 0) body = stepRecall(q, setStep);
  else if (ps.step === 1) body = stepKeyPoints(q, setStep);
  else if (ps.step === 2) body = stepFade(q, setStep, rerender);
  else body = stepRate(q, rerender);

  return h('section', { class: 'stack' },
    header || h('a', { class: 'back', href: '#/list' }, '‹ Questions'),
    stepper,
    h('div', { class: 'card question' },
      h('div', { class: 'meta' }, h('span', { class: 'badge' }, CATEGORY_LABEL[q.category]), statusBadge(q), masteryBadge(state.progress.get(q.id)),
        h('span', { class: 'small muted' }, `${q.targetSeconds} s`)),
      h('p', { class: 'qbig' }, slotText(q.question)),
      q.editNote ? h('p', { class: 'small muted' }, 'Note: ', q.editNote) : null),
    body);
}

function stepRecall(q, setStep) {
  return h('div', { class: 'card stack' },
    h('p', null, 'Try to say the key points out loud first.'),
    h('button', { class: 'btn primary big', onclick: () => setStep(1) }, 'Show key points'));
}

function stepKeyPoints(q, setStep) {
  const stories = q.storyIds.map(findStory).filter(Boolean);
  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('h2', null, 'Key points'),
      q.keyPoints.length ? h('ol', { class: 'points' }, q.keyPoints.map((k) => h('li', null, slotText(k))))
        : h('p', { class: 'muted' }, 'No key points yet.')),
    stories.map(storyCard),
    q.status === 'todo' || q.answer.length === 0
      ? h('div', { class: 'card note warn' }, 'No answer yet. Use the ideas above, then rate yourself.',
        h('button', { class: 'btn primary big', onclick: () => setStep(3) }, 'Rate'))
      : h('button', { class: 'btn primary big', onclick: () => setStep(2) }, 'Practise full answer'));
}

function storyCard(s) {
  return h('div', { class: 'card story' },
    h('div', { class: 'story-head' }, h('strong', null, s.title), s.when ? h('span', { class: 'small muted' }, s.when) : null),
    h('dl', null,
      h('dt', null, 'Situation'), h('dd', null, slotText(s.situation)),
      h('dt', null, 'Action'), h('dd', null, slotText(s.action)),
      h('dt', null, 'Result'), h('dd', null, slotText(s.result))));
}

function stepFade(q, setStep, rerender) {
  const ps = state.practise;
  if (q.status === 'todo' || q.answer.length === 0) {
    return h('div', { class: 'stack' },
      h('div', { class: 'card note warn' }, h('strong', null, 'No answer yet. '), 'Ideas:',
        h('ul', { class: 'points' }, q.keyPoints.map((k) => h('li', null, slotText(k))))),
      h('button', { class: 'btn primary big', onclick: () => setStep(3) }, 'Rate'));
  }

  const { paragraphs, words } = tokenizeAnswer(q.answer, state.slots);
  const hidden = hiddenSet(words, q.id, ps.level);

  const levels = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Fade level' },
    [0, 1, 2, 3, 4].map((l) => h('button', {
      class: l === ps.level ? 'active' : '', role: 'radio', 'aria-checked': String(l === ps.level),
      onclick: () => { ps.level = l; rerender(); },
    }, `${l * 25}%`)));

  const text = h('div', { class: 'answer' }, paragraphs.map((tokens) => h('p', null, tokens.map((t) => {
    if (t.type === 'space') return t.text;
    const cls = t.unfilled ? ' unfilled' : '';
    if (!hidden.has(t.index)) return [t.pre, h('span', { class: `w${cls}` }, t.core), t.post];
    const blank = h('span', {
      class: `blank${cls}`, role: 'button', tabindex: '0', 'aria-label': 'Hidden word. Tap to show.',
      onclick: (e) => reveal(e.currentTarget),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(e.currentTarget); } },
    }, t.core);
    return [t.pre, blank, t.post];
  }))));

  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('span', { class: 'small muted' }, 'Hide words'),
        h('span', { class: 'small muted' }, `${hidden.size} of ${words.length} hidden`)),
      levels,
      text,
      h('p', { class: 'small muted' }, 'Say the full answer out loud. Tap a blank to see that word.')),
    h('button', { class: 'btn primary big', onclick: () => setStep(3) }, 'Rate'));
}

function reveal(el) {
  el.classList.replace('blank', 'revealed');
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  el.removeAttribute('aria-label');
}

function stepRate(q, rerender) {
  const ps = state.practise;
  if (ps.rated) {
    const p = ps.rated;
    return h('div', { class: 'card stack', role: 'status' },
      h('p', null, h('strong', null, 'Saved. '), `Now in box ${p.box}. Next review: ${formatDate(p.due)}.`),
      h('div', { class: 'grid2' },
        h('button', { class: 'btn', onclick: () => { startPractise(q.id); state.practise.mode = 'single'; rerender(); } }, 'Practise again'),
        h('a', { class: 'btn primary', href: '#/list' }, 'Back to list')));
  }
  const prev = state.progress.get(q.id);
  const box = prev?.box ?? 1;
  const btn = (rating, label, sub, cls) => h('button', { class: `btn rate ${cls}`, onclick: () => rate(q, rating) },
    h('span', { class: 'rate-label' }, label), h('span', { class: 'small' }, sub));
  return h('div', { class: 'stack' },
    h('p', { class: 'muted center' }, `How did it go? (now box ${box})`),
    btn(1, "Couldn't", 'Back to box 1 · again today', 'r1'),
    btn(2, 'With hints', `Stay in box ${box} · ${dueText(box)}`, 'r2'),
    btn(3, 'Easily', `Box ${Math.min(5, box + 1)} · ${dueText(Math.min(5, box + 1))}`, 'r3'));
}

function dueText(box) {
  const d = DAYS_FOR_BOX[box];
  return d === 0 ? 'again today' : d === 1 ? 'in 1 day' : `in ${d} days`;
}

async function rate(q, rating) {
  const today = todayStr();
  const p = applyRating(q.id, state.progress.get(q.id), rating, today);
  try {
    await db.putProgress(p);
  } catch (e) {
    alert(`Could not save: ${e.message}`);
    return;
  }
  state.progress.set(q.id, p);
  if (state.session && state.practise?.mode === 'review') {
    state.session.results.push({ id: q.id, rating, box: p.box });
    state.session.index++;
    state.practise = null;
    window.scrollTo(0, 0);
  } else {
    state.practise.rated = p;
  }
  render();
}

// ---------- Today's review ----------
function viewReview() {
  if (!state.session) {
    const ids = todaysReview(questions(), state.progress, todayStr()).all;
    state.session = { ids, index: 0, results: [] };
  }
  const s = state.session;
  if (s.index >= s.ids.length) return viewReviewDone(s);

  const id = s.ids[s.index];
  const q = findQuestion(id);
  if (!q) { s.index++; return viewReview(); }
  if (state.practise?.id !== id || state.practise.mode !== 'review') { startPractise(id); state.practise.mode = 'review'; }

  const header = h('div', { class: 'row between' },
    h('a', { class: 'back', href: '#/home', onclick: () => { state.session = null; } }, '‹ End review'),
    h('span', { class: 'small muted' }, `Question ${s.index + 1} of ${s.ids.length}`));
  return practiseView(q, header);
}

function viewReviewDone(s) {
  const label = { 1: "Couldn't", 2: 'With hints', 3: 'Easily' };
  return h('section', { class: 'stack' },
    h('h1', null, 'Review done'),
    h('div', { class: 'card' },
      s.results.length === 0 ? h('p', null, 'Nothing to review right now.') :
        h('ul', { class: 'results' }, s.results.map((r) => h('li', null,
          h('span', null, slotText(findQuestion(r.id)?.question ?? r.id)),
          h('span', { class: `badge r${r.rating}` }, `${label[r.rating]} · box ${r.box}`))))),
    h('button', { class: 'btn primary big', onclick: () => { state.session = null; go('#/home'); } }, 'Back to Home'));
}

// ---------- Settings ----------
function viewSettings() {
  const slotKeys = Object.keys(state.slots);
  const inputs = {};
  const slotForm = h('form', {
    class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const next = { ...state.slots };
      for (const k of slotKeys) next[k] = inputs[k].value;
      await db.kvSet('slots', next);
      state.slots = next;
      state.flash = { text: 'Slot values saved.', kind: 'ok' };
      render();
    },
  },
  slotKeys.length === 0 ? h('p', { class: 'muted' }, 'No slots in this file.') : slotKeys.map((k) => {
    const input = h('input', { id: `slot-${k}`, type: 'text', value: state.slots[k] ?? '', autocomplete: 'off',
      class: isUnfilled(state.slots[k]) ? 'unfilled-input' : '',
      oninput: (e) => e.target.classList.toggle('unfilled-input', isUnfilled(e.target.value)) });
    inputs[k] = input;
    return h('label', { class: 'field', for: `slot-${k}` }, h('span', null, k), input);
  }),
  slotKeys.length ? h('p', { class: 'small muted' }, 'Values written like [this] are not filled and show highlighted.') : null,
  slotKeys.length ? h('div', { class: 'grid2' },
    h('button', { class: 'btn primary', type: 'submit' }, 'Save slots'),
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!confirm('Reset slot values to the ones in the imported file?')) return;
      state.slots = { ...(state.content?.slots || {}) };
      await db.kvSet('slots', state.slots);
      state.flash = { text: 'Slot values reset from file.', kind: 'ok' };
      render();
    } }, 'Reset from file')) : null);

  return h('section', { class: 'stack' },
    h('h1', null, 'Settings'),
    flashCard(),
    state.content ? h('div', { class: 'card stack' }, h('h2', null, 'Slots'), slotForm) : null,
    h('div', { class: 'card stack' },
      h('h2', null, 'Data'),
      state.content ? h('p', { class: 'small muted' }, `Loaded: ${state.content.title}${state.content.updated ? ` · ${state.content.updated}` : ''} · ${questions().length} questions`) : null,
      importButton(state.content ? 'Import new file' : 'Import file'),
      h('p', { class: 'small muted' }, 'Importing replaces the questions but keeps your practice progress.'),
      sampleButton('Load sample data'),
      importMessages()),
    h('div', { class: 'card stack' },
      h('h2', null, 'Progress'),
      h('button', { class: 'btn danger', onclick: resetProgress }, 'Reset progress')),
    h('p', { class: 'small muted center' }, `Interview Drill ${APP_VERSION}`));
}

async function resetProgress() {
  if (!confirm('Reset all practice progress? Every question goes back to "New". This cannot be undone.')) return;
  await db.clearProgress();
  state.progress = new Map();
  state.session = null;
  state.practise = null;
  state.flash = { text: 'Progress reset.', kind: 'ok' };
  render();
}

// ---------- Import ----------
let lastImport = null; // { ok, errors, warnings, text }

function importButton(label) {
  const input = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await importText(await file.text());
    } });
  return h('label', { class: 'btn primary' }, input, label);
}

function sampleButton(label) {
  return h('button', { class: 'btn', onclick: async () => {
    if (state.content && !confirm('Replace your current questions with the fake sample data? Progress is kept.')) return;
    try {
      const res = await fetch('data/sample-data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await importText(await res.text());
    } catch (e) {
      lastImport = { ok: false, errors: [`Could not load sample data (${e.message}).`], warnings: [] };
      render();
    }
  } }, label);
}

/** Validate first; only if everything is valid, save content + slots in one transaction. */
async function importText(text) {
  const result = parseAndValidate(text);
  if (!result.ok) {
    lastImport = { ...result, text: 'Import failed. Nothing was changed.' };
    render();
    return;
  }
  const data = result.data;
  try {
    await db.saveContent(data, { ...data.slots });
  } catch (e) {
    lastImport = { ok: false, errors: [`Could not save: ${e.message}`], warnings: [], text: 'Import failed. Nothing was changed.' };
    render();
    return;
  }
  const hadContent = !!state.content;
  state.content = data;
  state.slots = { ...data.slots };
  state.session = null;
  state.practise = null;
  const kept = data.questions.filter((q) => state.progress.has(q.id)).length;
  lastImport = {
    ok: true, errors: [], warnings: result.warnings,
    text: `Imported ${data.questions.length} questions.` + (hadContent ? ` Progress kept for ${kept}. Slot values taken from the file.` : ''),
  };
  db.requestPersistence();
  if ((location.hash || '#/home').startsWith('#/settings')) { render(); return; }
  state.flash = { node: importMessages() }; // show the result on Home
  lastImport = null;
  go('#/home');
}

function importMessages() {
  if (!lastImport) return null;
  const r = lastImport;
  const box = h('div', { class: `card note ${r.ok ? 'ok' : 'error'}`, role: r.ok ? 'status' : 'alert' },
    h('strong', null, r.text || ''),
    r.errors.length ? h('ul', { class: 'msgs' }, r.errors.map((m) => h('li', null, m))) : null,
    r.warnings.length ? [h('p', { class: 'small' }, 'Warnings:'), h('ul', { class: 'msgs small' }, r.warnings.map((m) => h('li', null, m)))] : null);
  return box;
}

// ---------- Start ----------
window.addEventListener('hashchange', () => { lastImport = null; render(); window.scrollTo(0, 0); });

(async function start() {
  try {
    await loadState();
  } catch (e) {
    main().replaceChildren(h('div', { class: 'card note error' }, `Could not open storage: ${e.message}`));
    return;
  }
  render();
})();
