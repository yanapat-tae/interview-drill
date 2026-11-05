// app.js — screens and navigation.
// Routes use the URL hash: #/home, #/list, #/practise/<id>, #/review, #/mock, #/stories, #/ask, #/settings

import * as db from './db.js';
import { parseAndValidate, slotParts, fillSlots, isUnfilled, CATEGORIES } from './data.js';
import { tokenizeAnswer, hiddenSet } from './fade.js';
import { glossaryMatches } from './glossary.js';
import { todayStr, applyRating, mastery, isDue, todaysReview, summarize, DAYS_FOR_BOX } from './review.js';
import * as mock from './mock.js';

export const APP_VERSION = '0.2.0 (Phase 2)';

// ---------- App state (loaded from IndexedDB) ----------
const state = {
  content: null,      // imported file
  slots: {},          // current slot values (editable in Settings)
  progress: new Map(),// question id → progress record
  session: null,      // today's review session { ids, index, results }
  practise: null,     // current practise screen { id, step, level, rated }
  flash: null,        // one-time message for the next render
  mock: null,         // running mock interview
  settings: { voiceURI: '', rate: 1 },
};

async function loadState() {
  state.content = (await db.kvGet('content')) || null;
  state.slots = (await db.kvGet('slots')) || state.content?.slots || {};
  state.progress = await db.getAllProgress();
  state.settings = { ...state.settings, ...((await db.kvGet('settings')) || {}) };
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

/**
 * Turn word tokens into DOM pieces.
 * hidden: Set of word indexes to show as blanks (fade-out). gloss: Map(word index → glossary entry).
 * A hidden glossary word stays a blank; it only turns amber after the user reveals it.
 */
function renderTokens(tokens, { hidden = null, gloss = new Map() } = {}) {
  return tokens.map((t) => {
    if (t.type === 'space') return t.text;
    const g = gloss.get(t.index);
    const unf = t.unfilled ? ' unfilled' : '';
    const data = g ? { 'data-term': g.term, 'data-th': g.th } : {};
    if (hidden?.has(t.index)) {
      const blank = h('span', {
        ...data, class: `blank${unf}`, role: 'button', tabindex: '0', 'aria-label': 'Hidden word. Tap to show.',
        onclick: (e) => { e.stopPropagation(); reveal(e.currentTarget); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); reveal(e.currentTarget); } },
      }, t.core);
      return [t.pre, blank, t.post];
    }
    const span = h('span', { ...data, class: `w${unf}${g ? ' gloss' : ''}`, role: g ? 'button' : null, tabindex: g ? '0' : null }, t.core);
    return [t.pre, span, t.post];
  });
}

/** One line of answer-style text: slots filled, unfilled highlighted, glossary terms in amber. */
function richText(text) {
  const { paragraphs, words } = tokenizeAnswer([text], state.slots);
  return renderTokens(paragraphs[0], { gloss: glossaryMatches(words, state.content?.glossary) });
}

// ---------- Glossary popover ----------
let popEl = null;
function showGloss(el) {
  if (!popEl) {
    popEl = h('div', { class: 'gloss-pop', role: 'status', 'aria-live': 'polite' });
    document.body.append(popEl);
  }
  popEl.replaceChildren(h('strong', null, el.dataset.term), h('span', { lang: 'th' }, el.dataset.th));
  popEl.hidden = false;
  const r = el.getBoundingClientRect();
  const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - pw / 2, innerWidth - pw - 12));
  let top = r.bottom + 8;
  const limit = innerHeight - (document.querySelector('.tabbar')?.offsetHeight || 0) - 8;
  if (top + ph > limit) top = r.top - ph - 8;
  popEl.style.left = `${left + scrollX}px`;
  popEl.style.top = `${top + scrollY}px`;
}
function hideGloss() { if (popEl) popEl.hidden = true; }

document.addEventListener('click', (e) => {
  const t = e.target.closest?.('.gloss');
  if (t) showGloss(t); else hideGloss();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideGloss();
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('gloss')) { e.preventDefault(); showGloss(e.target); }
});

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
  else if (route === 'mock') view = viewMock();
  else if (route === 'stories') view = viewStories();
  else if (route === 'ask') view = viewAsk();
  else if (route === 'settings') view = viewSettings();
  else view = viewHome();

  hideGloss();
  main().replaceChildren(view);
  const tab = { practise: 'list', review: 'home', mock: 'home', stories: 'home', ask: 'home' }[route] || route || 'home';
  for (const a of document.querySelectorAll('.tabbar a')) {
    const active = a.dataset.route === tab;
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
      h('a', { class: 'btn', href: '#/mock' }, 'Mock interview'),
      h('a', { class: 'btn', href: '#/stories' }, 'Stories'),
      h('a', { class: 'btn', href: '#/ask' }, 'Questions to ask')));
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
      q.keyPoints.length ? h('ol', { class: 'points' }, q.keyPoints.map((k) => h('li', null, richText(k))))
        : h('p', { class: 'muted' }, 'No key points yet.')),
    stories.map(storyCard),
    q.status === 'todo' || q.answer.length === 0
      ? h('div', { class: 'card note warn' }, 'No answer yet. Use the ideas above, then rate yourself.',
        h('button', { class: 'btn primary big', onclick: () => setStep(3) }, 'Rate'))
      : h('button', { class: 'btn primary big', onclick: () => setStep(2) }, 'Practise full answer'));
}

function storyCard(s, usedIn = null) {
  return h('div', { class: 'card story' },
    h('div', { class: 'story-head' }, h('strong', null, s.title), s.when ? h('span', { class: 'small muted' }, s.when) : null),
    h('dl', null,
      h('dt', null, 'Situation'), h('dd', null, richText(s.situation)),
      h('dt', null, 'Action'), h('dd', null, richText(s.action)),
      h('dt', null, 'Result'), h('dd', null, richText(s.result))),
    usedIn ? h('div', { class: 'used-in' },
      h('span', { class: 'small muted' }, 'Used in:'),
      usedIn.length ? h('ul', null, usedIn.map((q) => h('li', null, h('a', { href: `#/practise/${encodeURIComponent(q.id)}` }, slotText(q.question)))))
        : h('span', { class: 'small muted' }, ' no questions yet')) : null);
}

function stepFade(q, setStep, rerender) {
  const ps = state.practise;
  if (q.status === 'todo' || q.answer.length === 0) {
    return h('div', { class: 'stack' },
      h('div', { class: 'card note warn' }, h('strong', null, 'No answer yet. '), 'Ideas:',
        h('ul', { class: 'points' }, q.keyPoints.map((k) => h('li', null, richText(k))))),
      h('button', { class: 'btn primary big', onclick: () => setStep(3) }, 'Rate'));
  }

  const { paragraphs, words } = tokenizeAnswer(q.answer, state.slots);
  const hidden = hiddenSet(words, q.id, ps.level);

  const levels = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Fade level' },
    [0, 1, 2, 3, 4].map((l) => h('button', {
      class: l === ps.level ? 'active' : '', role: 'radio', 'aria-checked': String(l === ps.level),
      onclick: () => { ps.level = l; rerender(); },
    }, `${l * 25}%`)));

  const gloss = glossaryMatches(words, state.content.glossary);
  const text = h('div', { class: 'answer' }, paragraphs.map((tokens) => h('p', null, renderTokens(tokens, { hidden, gloss }))));

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
  hideGloss();
  el.classList.replace('blank', 'revealed');
  el.removeAttribute('aria-label');
  if (el.dataset.term) {
    el.classList.add('gloss'); // now visible → amber, tap again for the Thai meaning
  } else {
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
  }
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

// ---------- Mock interview ----------
// Flow per question: "ask" (question read aloud, timer runs, optional recording)
// → "review" (time, playback, rate 1–3) → next question … → "done" (summary).
let mockTimer = null;   // setInterval id for the timer display
let stopSpeech = null;  // function that stops the current speech

function endMock() {
  if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
  if (stopSpeech) { stopSpeech(); stopSpeech = null; }
  const m = state.mock;
  if (!m) return;
  m.recorder?.cancel();
  for (const r of m.results) if (r.audioUrl) URL.revokeObjectURL(r.audioUrl);
  if (m.audioUrl && !m.results.some((r) => r.audioUrl === m.audioUrl)) URL.revokeObjectURL(m.audioUrl);
  state.mock = null;
}

const mockPool = () => questions().filter((q) => q.status !== 'todo' && q.answer.length > 0);

function viewMock() {
  const m = state.mock;
  if (!m) return viewMockIntro();
  if (m.phase === 'done') return viewMockSummary(m);
  const item = m.items[m.index];
  return m.phase === 'ask' ? viewMockAsk(m, item) : viewMockReview(m, item);
}

function viewMockIntro() {
  const n = Math.min(mock.MOCK_SIZE, mockPool().length);
  return h('section', { class: 'stack' },
    h('h1', null, 'Mock interview'),
    h('div', { class: 'card stack' },
      h('p', null, `${n} questions, read aloud. Questions you find hard come up more often. Sometimes a follow-up question is added.`),
      h('p', { class: 'small muted' }, 'Answer out loud. The timer starts after the question is read. It turns amber after the target time and red 30 seconds later.'),
      mock.ttsSupported() ? null : h('p', { class: 'small warn-text' }, 'This browser cannot read aloud. The question is shown as text only.'),
      mock.recordingSupported() ? h('p', { class: 'small muted' }, 'Optional: tap Record to hear yourself afterwards. Only the last recording per question is kept, on this device.')
        : h('p', { class: 'small warn-text' }, 'Recording is not available in this browser.'),
      h('p', { class: 'small muted' }, 'On iPhone: turn the silent switch off to hear the question.')),
    h('button', { class: 'btn primary big', disabled: n === 0, onclick: startMock }, n ? 'Start mock interview' : 'No questions with answers yet'));
}

function startMock() {
  endMock();
  state.mock = { items: mock.pickMockItems(questions(), state.progress), index: 0, results: [] };
  beginMockItem(); // speak inside the tap, so iPhone allows the audio
  render();
}

function beginMockItem() {
  const m = state.mock;
  Object.assign(m, { phase: 'ask', startedAt: null, seconds: 0, blob: null, audioUrl: null, recorder: null, recordError: null, busy: false });
  readQuestionAloud();
}

function readQuestionAloud() {
  const m = state.mock;
  const item = m.items[m.index];
  if (stopSpeech) stopSpeech();
  stopSpeech = mock.speak(fillSlots(item.text, state.slots), state.settings, () => {
    stopSpeech = null;
    if (state.mock === m && m.phase === 'ask' && !m.startedAt) startMockTimer();
  });
}

function startMockTimer() {
  const m = state.mock;
  m.startedAt = performance.now();
  if (mockTimer) clearInterval(mockTimer);
  mockTimer = setInterval(updateMockTimer, 250);
  updateMockTimer();
}

function mockElapsed(m) { return m.startedAt ? (performance.now() - m.startedAt) / 1000 : 0; }

// Updates only the timer text (no full re-render), 4 times per second.
function updateMockTimer() {
  const m = state.mock;
  const el = document.getElementById('mock-timer');
  if (!m || m.phase !== 'ask' || !el) return;
  const item = m.items[m.index];
  const sec = mockElapsed(m);
  el.textContent = mock.formatTime(sec);
  el.dataset.level = mock.timerLevel(sec, item.targetSeconds);
  const st = document.getElementById('mock-status');
  if (st) st.textContent = m.startedAt ? 'Answer now' : 'Listening…';
  if (m.startedAt) document.getElementById('mock-start-now')?.remove();
}

function viewMockAsk(m, item) {
  const sec = mockElapsed(m);
  const recording = !!m.recorder;
  return h('section', { class: 'stack' },
    mockHeader(m),
    h('div', { class: 'card question' },
      h('div', { class: 'meta' },
        item.followUp ? h('span', { class: 'badge s-new' }, 'Follow-up') : h('span', { class: 'badge' }, CATEGORY_LABEL[findQuestion(item.qid)?.category] || ''),
        h('span', { class: 'small muted' }, `target ${item.targetSeconds} s`)),
      h('p', { class: 'qbig' }, slotText(item.text))),
    h('div', { class: 'card timer-card' },
      h('div', { id: 'mock-timer', class: 'timer', 'data-level': mock.timerLevel(sec, item.targetSeconds), role: 'timer', 'aria-live': 'off' }, mock.formatTime(sec)),
      h('div', { id: 'mock-status', class: 'small muted' }, m.startedAt ? 'Answer now' : 'Listening…'),
      m.startedAt ? null : h('button', { id: 'mock-start-now', class: 'btn small-btn', onclick: () => { if (stopSpeech) { stopSpeech(); stopSpeech = null; } startMockTimer(); render(); } }, 'Start timer now')),
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', onclick: readQuestionAloud }, 'Read again'),
      mock.recordingSupported()
        ? h('button', { class: `btn ${recording ? 'recording' : ''}`, onclick: toggleRecord, disabled: m.busy, 'aria-pressed': String(recording) },
          recording ? [h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), 'Stop recording'] : (m.blob ? 'Record again' : 'Record'))
        : h('button', { class: 'btn', disabled: true }, 'No recording')),
    m.blob && !recording ? h('p', { class: 'small muted center' }, 'Recorded. You can play it back after you finish.') : null,
    m.recordError ? h('div', { class: 'card note warn', role: 'alert' }, m.recordError) : null,
    h('button', { class: 'btn primary big', onclick: finishAnswer, disabled: m.busy }, 'Done answering'));
}

function mockHeader(m) {
  return h('div', { class: 'row between' },
    h('a', { class: 'back', href: '#/home' }, '‹ End'),
    h('span', { class: 'small muted' }, `Question ${m.index + 1} of ${m.items.length}`));
}

async function toggleRecord() {
  const m = state.mock;
  if (!m || m.busy) return;
  m.busy = true;
  if (m.recorder) {
    const rec = m.recorder;
    m.recorder = null;
    m.blob = await rec.stop();
  } else {
    if (stopSpeech) { stopSpeech(); stopSpeech = null; }
    if (!m.startedAt) startMockTimer();
    try {
      m.recorder = await mock.startRecording();
      m.recordError = null;
    } catch (e) {
      m.recordError = `Microphone not available (${e.name || 'Error'}: ${e.message}). Check that the microphone is allowed for this site.`;
    }
  }
  m.busy = false;
  if (state.mock === m) render();
}

async function finishAnswer() {
  const m = state.mock;
  if (!m || m.busy) return;
  m.busy = true;
  const item = m.items[m.index];
  if (stopSpeech) { stopSpeech(); stopSpeech = null; }
  m.seconds = mockElapsed(m);
  if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
  if (m.recorder) { const rec = m.recorder; m.recorder = null; m.blob = await rec.stop(); }
  if (m.blob && m.blob.size) {
    m.audioUrl = URL.createObjectURL(m.blob);
    try {
      await db.putRecording({ id: item.key, qid: item.qid, data: await m.blob.arrayBuffer(), mimeType: m.blob.type, date: todayStr(), seconds: Math.round(m.seconds) });
    } catch (e) {
      m.recordError = `The recording could not be saved (${e.message}). You can still play it now.`;
    }
  }
  m.busy = false;
  m.phase = 'review';
  if (state.mock === m) render();
}

function viewMockReview(m, item) {
  const level = mock.timerLevel(m.seconds, item.targetSeconds);
  const q = findQuestion(item.qid);
  const btn = (rating, label, cls) => h('button', { class: `btn rate ${cls}`, onclick: () => rateMock(rating) }, h('span', { class: 'rate-label' }, label));
  return h('section', { class: 'stack' },
    mockHeader(m),
    h('div', { class: 'card question' },
      item.followUp ? h('div', { class: 'meta' }, h('span', { class: 'badge s-new' }, 'Follow-up')) : null,
      h('p', { class: 'qbig' }, slotText(item.text)),
      h('p', null, 'Your time: ', h('strong', { class: `time-${level}` }, mock.formatTime(m.seconds)), h('span', { class: 'muted' }, ` · target ${mock.formatTime(item.targetSeconds)}`))),
    m.audioUrl ? h('div', { class: 'card stack' }, h('span', { class: 'small muted' }, 'Your answer'), h('audio', { controls: true, src: m.audioUrl, preload: 'auto' })) : null,
    m.recordError ? h('div', { class: 'card note warn', role: 'alert' }, m.recordError) : null,
    item.followUp && item.hint ? h('div', { class: 'card' }, h('span', { class: 'small muted' }, 'Hint: '), item.hint) : null,
    !item.followUp && q?.keyPoints.length ? h('details', { class: 'card' }, h('summary', null, 'Check key points'),
      h('ol', { class: 'points' }, q.keyPoints.map((k) => h('li', null, richText(k))))) : null,
    h('p', { class: 'muted center' }, 'How did it go?'),
    btn(1, "Couldn't", 'r1'), btn(2, 'With hints', 'r2'), btn(3, 'Easily', 'r3'));
}

function rateMock(rating) {
  const m = state.mock;
  const item = m.items[m.index];
  m.results.push({ key: item.key, text: item.text, followUp: item.followUp, seconds: m.seconds, target: item.targetSeconds, rating, audioUrl: m.audioUrl });

  // Mock ratings also count for spaced review (follow-ups do not have their own box).
  if (!item.followUp && findQuestion(item.qid)) {
    const p = applyRating(item.qid, state.progress.get(item.qid), rating, todayStr());
    state.progress.set(item.qid, p);
    db.putProgress(p).catch((e) => alert(`Could not save progress: ${e.message}`));
  }

  m.index++;
  if (m.index >= m.items.length) m.phase = 'done';
  else beginMockItem(); // speaks the next question inside this tap
  render();
  window.scrollTo(0, 0);
}

function viewMockSummary(m) {
  const label = { 1: "Couldn't", 2: 'With hints', 3: 'Easily' };
  const total = m.results.reduce((s, r) => s + r.seconds, 0);
  return h('section', { class: 'stack' },
    h('h1', null, 'Mock interview done'),
    h('p', { class: 'muted' }, `${m.results.length} answers · total ${mock.formatTime(total)}`),
    h('ul', { class: 'qlist' }, m.results.map((r) => h('li', { class: 'card stack' },
      h('span', null, r.followUp ? h('span', { class: 'badge s-new' }, 'Follow-up') : null, r.followUp ? ' ' : null, slotText(r.text)),
      h('span', { class: 'badges' },
        h('span', { class: `badge time-${mock.timerLevel(r.seconds, r.target)}` }, `${mock.formatTime(r.seconds)} / ${mock.formatTime(r.target)}`),
        h('span', { class: `badge r${r.rating}` }, label[r.rating])),
      r.audioUrl ? h('audio', { controls: true, src: r.audioUrl, preload: 'none' }) : null))),
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', onclick: startMock }, 'New mock'),
      h('a', { class: 'btn primary', href: '#/home' }, 'Back to Home')));
}

// ---------- Stories ----------
function viewStories() {
  const stories = state.content.stories;
  return h('section', { class: 'stack' },
    h('h1', null, 'Stories'),
    stories.length
      ? stories.map((s) => storyCard(s, questions().filter((q) => q.storyIds.includes(s.id))))
      : h('div', { class: 'card muted' }, 'No stories in this file.'));
}

// ---------- Questions to ask ----------
function viewAsk() {
  const list = state.content.questionsToAsk;
  const cats = [...new Set(list.map((a) => a.category))];
  return h('section', { class: 'stack' },
    h('h1', null, 'Questions to ask'),
    list.length ? cats.map((c) => h('div', { class: 'stack' },
      h('h2', null, c),
      h('ul', { class: 'qlist' }, list.filter((a) => a.category === c).map((a) => h('li', { class: 'card ask' },
        h('span', null, slotText(a.question)),
        a.note ? h('span', { class: 'small muted' }, a.note) : null)))))
      : h('div', { class: 'card muted' }, 'No questions in this file.'));
}

// ---------- Voice settings ----------
function fillVoiceSelect(select) {
  const voices = mock.englishVoices();
  const current = state.settings.voiceURI;
  select.replaceChildren(
    h('option', { value: '' }, voices.length ? 'Automatic (English)' : 'Default voice'),
    voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === current }, `${v.name} (${v.lang})`)));
}

async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await db.kvSet('settings', state.settings);
}

if (mock.ttsSupported()) {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    const sel = document.getElementById('voice-select');
    if (sel) fillVoiceSelect(sel);
  });
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
    voiceCard(),
    h('div', { class: 'card stack' },
      h('h2', null, 'Progress & recordings'),
      h('button', { class: 'btn danger', onclick: resetProgress }, 'Reset progress'),
      recordingsRow()),
    h('p', { class: 'small muted center' }, `Interview Drill ${APP_VERSION}`));
}

function voiceCard() {
  const select = h('select', { id: 'voice-select', onchange: (e) => saveSettings({ voiceURI: e.target.value }) });
  fillVoiceSelect(select);
  const rateOut = h('output', { for: 'rate-input' }, `${Number(state.settings.rate).toFixed(1)}×`);
  const rate = h('input', { id: 'rate-input', type: 'range', min: '0.6', max: '1.4', step: '0.1', value: String(state.settings.rate),
    oninput: (e) => { rateOut.textContent = `${Number(e.target.value).toFixed(1)}×`; },
    onchange: (e) => saveSettings({ rate: Number(e.target.value) }) });
  return h('div', { class: 'card stack' },
    h('h2', null, 'Voice'),
    mock.ttsSupported() ? null : h('p', { class: 'small warn-text' }, 'This browser cannot read aloud.'),
    h('label', { class: 'field', for: 'voice-select' }, h('span', null, 'Voice'), select),
    h('label', { class: 'field', for: 'rate-input' }, h('span', null, 'Speech rate ', rateOut), rate),
    h('button', { class: 'btn', onclick: () => mock.speak('What is your greatest strength?', state.settings) }, 'Test voice'));
}

function recordingsRow() {
  const info = h('span', { class: 'small muted' }, 'Counting recordings…');
  db.countRecordings().then((n) => { info.textContent = `${n} recording${n === 1 ? '' : 's'} saved on this device.`; })
    .catch(() => { info.textContent = ''; });
  return [info, h('button', { class: 'btn danger', onclick: deleteRecordings }, 'Delete all recordings')];
}

async function deleteRecordings() {
  if (!confirm('Delete all saved recordings? This cannot be undone.')) return;
  await db.clearRecordings();
  state.flash = { text: 'All recordings deleted.', kind: 'ok' };
  render();
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
  endMock();
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
window.addEventListener('hashchange', () => {
  lastImport = null;
  if (state.mock && !location.hash.startsWith('#/mock')) endMock(); // leaving stops speech, timer and microphone
  render();
  window.scrollTo(0, 0);
});

(async function start() {
  try {
    await loadState();
  } catch (e) {
    main().replaceChildren(h('div', { class: 'card note error' }, `Could not open storage: ${e.message}`));
    return;
  }
  render();
})();
