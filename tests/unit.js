// Unit tests for the pure modules. Open tests/unit.html through a local web server.
import { parseAndValidate, validateData, fillSlots, slotParts, isUnfilled, makeBackup, parseImport, backupFileName } from '../js/data.js';
import { tokenizeAnswer, hiddenSet, isFunctionWord, LEVEL_SHARE } from '../js/fade.js';
import { applyRating, addDays, todaysReview, mastery } from '../js/review.js';
import { glossaryMatches } from '../js/glossary.js';
import { pickMockItems, timerLevel, formatTime, weightOf } from '../js/mock.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, msg: e.message }); }
}
function eq(a, b, msg = '') {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`);
}
function ok(v, msg = 'expected true') { if (!v) throw new Error(msg); }

const sampleText = await (await fetch('../data/sample-data.json')).text();
const sample = JSON.parse(sampleText);
const clone = () => JSON.parse(sampleText);

// ---------- data.js ----------
test('sample data is valid', () => { const r = parseAndValidate(sampleText); ok(r.ok, r.errors.join('; ')); });
test('broken JSON is rejected', () => { const r = parseAndValidate('{ "title": '); ok(!r.ok); ok(r.errors[0].includes('not valid JSON')); });
test('duplicate question id is reported', () => {
  const d = clone(); d.questions[1].id = 'intro';
  const r = validateData(d); ok(!r.ok); ok(r.errors.some((e) => e.includes('used twice')), r.errors.join());
});
test('unknown storyId is reported', () => {
  const d = clone(); d.questions[0].storyIds = ['nope'];
  const r = validateData(d); ok(!r.ok); ok(r.errors.some((e) => e.includes('"nope" does not exist')));
});
test('missing required fields are reported (one message each)', () => {
  const d = clone(); delete d.title; delete d.questions[0].question; d.questions[0].category = 'x';
  const r = validateData(d); ok(!r.ok); eq(r.errors.length, 3, r.errors.join(' | '));
});
test('missing questions list is an error', () => { const d = clone(); delete d.questions; ok(!validateData(d).ok); });
test('optional lists default to []', () => {
  const d = clone(); delete d.glossary; delete d.questionsToAsk; const r = validateData(d); ok(r.ok); eq(r.data.glossary, []);
});
test('slots fill', () => {
  eq(fillSlots('Why {{Company}}?', sample.slots), 'Why Example Motors?');
  eq(fillSlots('{{ Role }} x', sample.slots), 'Test Engineer x');
});
test('unfilled slot detection', () => {
  ok(isUnfilled('[one specific thing]')); ok(isUnfilled('')); ok(!isUnfilled('Acme'));
  const parts = slotParts('because {{CompanyReason}}.', sample.slots);
  eq(parts[1].unfilled, true); eq(parts[1].text, '[one specific thing about this company]');
  eq(slotParts('{{Missing}}', {})[0], { text: '{{Missing}}', slot: 'Missing', unfilled: true });
});

// ---------- fade.js ----------
const intro = sample.questions[0];
const { words } = tokenizeAnswer(intro.answer, sample.slots);
test('tokenizer keeps punctuation outside the word', () => {
  const w = words.find((x) => x.core === 'Sample'); eq([w.pre, w.post], ['', '.']);
});
test('levels hide 0/25/50/75/100% of words', () => {
  for (let l = 0; l <= 4; l++) {
    eq(hiddenSet(words, intro.id, l).size, Math.round(LEVEL_SHARE[l] * words.length), `level ${l}`);
  }
});
test('same words hidden every time (deterministic)', () => {
  for (let l = 0; l <= 4; l++) eq([...hiddenSet(words, intro.id, l)], [...hiddenSet(words, intro.id, l)]);
});
test('higher level hides everything the lower level hides', () => {
  for (let l = 1; l <= 4; l++) {
    const lo = hiddenSet(words, intro.id, l - 1), hi = hiddenSet(words, intro.id, l);
    for (const i of lo) ok(hi.has(i), `level ${l} misses word ${i}`);
  }
});
test('function words stay visible at levels 1–2', () => {
  for (const l of [1, 2]) for (const i of hiddenSet(words, intro.id, l)) ok(!isFunctionWord(words[i].core), `"${words[i].core}" hidden at ${l}`);
});
test('different question ids hide different words', () => {
  const a = [...hiddenSet(words, 'intro', 2)].join(), b = [...hiddenSet(words, 'other-id', 2)].join();
  ok(a !== b);
});

// ---------- review.js ----------
const T = '2026-11-05';
test('addDays rolls over months', () => { eq(addDays('2026-11-30', 1), '2026-12-01'); eq(addDays('2026-12-25', 14), '2027-01-08'); });
test('new question rated 3 → box 2, due tomorrow', () => { const p = applyRating('q', undefined, 3, T); eq([p.box, p.due], [2, '2026-11-06']); });
test('rating 2 keeps box', () => { const p = applyRating('q', { box: 3, firstRated: '2026-10-01' }, 2, T); eq([p.box, p.due, p.firstRated], [3, '2026-11-08', '2026-10-01']); });
test('rating 1 → box 1, due today', () => { const p = applyRating('q', { box: 4 }, 1, T); eq([p.box, p.due], [1, T]); });
test('box 4 + rating 3 → box 5 (14 days), max stays 5', () => {
  eq(applyRating('q', { box: 4 }, 3, T).due, '2026-11-19');
  eq(applyRating('q', { box: 5 }, 3, T).box, 5);
  eq(mastery({ box: 5 }), 'mastered');
});
test("today's review: due items + up to 3 new, no todo", () => {
  const qs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, status: 'new' })).concat([{ id: 't', status: 'todo' }]);
  const prog = new Map([['a', { id: 'a', box: 2, due: '2026-11-04', firstRated: '2026-11-01' }], ['b', { id: 'b', box: 3, due: '2026-11-09', firstRated: '2026-11-01' }]]);
  eq(todaysReview(qs, prog, T), { due: ['a'], fresh: ['c', 'd', 'e'], all: ['a', 'c', 'd', 'e'] });
  prog.set('c', { id: 'c', box: 2, due: '2026-11-06', firstRated: T }); // one new started today
  eq(todaysReview(qs, prog, T).fresh, ['d', 'e']);
});

// ---------- glossary.js ----------
const glossWords = (text) => tokenizeAnswer(Array.isArray(text) ? text : [text], {}).words;
test('glossary: case-insensitive whole words', () => {
  const w = glossWords('I Troubleshoot daily; troubleshooting is different.');
  const m = glossaryMatches(w, sample.glossary);
  eq([...m.keys()].map((i) => w[i].core), ['Troubleshoot']);
});
test('glossary: hyphenated term and punctuation', () => {
  const w = glossWords('My detail-oriented approach.');
  eq([...glossaryMatches(w, sample.glossary).keys()].map((i) => w[i].core), ['detail-oriented']);
});
test('glossary: phrases match consecutive words, longer phrase wins, not across paragraphs', () => {
  const g = [{ term: 'production line', th: 'สายการผลิต' }, { term: 'line', th: 'เส้น' }];
  const w = glossWords(['The Production Line stopped. One line.', 'production', 'line']);
  const m = glossaryMatches(w, g);
  eq([...m.entries()].map(([i, e]) => `${w[i].core}=${e.term}`), ['Production=production line', 'Line=production line', 'line=line', 'line=line']);
});
test('glossary words in sample answers are found', () => {
  const ws = tokenizeAnswer(sample.questions[2].answer, sample.slots).words;
  const terms = new Set([...glossaryMatches(ws, sample.glossary).values()].map((g) => g.term));
  eq([...terms].sort(), ['prioritize', 'troubleshoot']);
});

// ---------- mock.js ----------
function seeded(seed) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; }
const manyQs = Array.from({ length: 8 }, (_, i) => ({ id: `q${i}`, status: 'new', question: `Q${i}?`, answer: ['x'], targetSeconds: 60, followUps: i === 0 ? [{ q: 'Why?', hint: 'h' }] : [] }))
  .concat([{ id: 'todo', status: 'todo', question: 'T?', answer: [], targetSeconds: 30, followUps: [] }]);
test('mock: 5 different questions, never todo', () => {
  for (let s = 1; s < 30; s++) {
    const items = pickMockItems(manyQs, new Map(), seeded(s), 5, 0).filter((i) => !i.followUp);
    eq(items.length, 5); eq(new Set(items.map((i) => i.qid)).size, 5); ok(!items.some((i) => i.qid === 'todo'));
  }
});
test('mock: follow-up comes right after its question', () => {
  const items = pickMockItems(manyQs, new Map(), seeded(7), 8, 1);
  const fi = items.findIndex((i) => i.followUp);
  ok(fi > 0, 'no follow-up'); eq(items[fi - 1].qid, items[fi].qid); eq(items[fi].text, 'Why?'); eq(items[fi].targetSeconds, 30);
});
test('mock: weak questions are picked more often', () => {
  const qs = manyQs.slice(0, 8);
  const prog = new Map(qs.slice(0, 4).map((q) => [q.id, { box: 5 }]).concat(qs.slice(4).map((q) => [q.id, { box: 1, lastRating: 1 }])));
  let weak = 0, strong = 0; const r = seeded(42);
  for (let k = 0; k < 400; k++) for (const it of pickMockItems(qs, prog, r, 1, 0)) (prog.get(it.qid).box === 1 ? weak++ : strong++);
  ok(weak > strong * 3, `weak ${weak} strong ${strong}`);
  eq([weightOf(undefined), weightOf({ box: 1 }), weightOf({ box: 1, lastRating: 1 }), weightOf({ box: 5 })], [3, 5, 7, 1]);
});
test('mock: timer colours', () => {
  eq([timerLevel(60, 60), timerLevel(61, 60), timerLevel(90, 60), timerLevel(91, 60)], ['normal', 'amber', 'amber', 'red']);
  eq([formatTime(0), formatTime(65.7), formatTime(600)], ['0:00', '1:05', '10:00']);
});

// ---------- backup ----------
test('backup round-trip: export then import gives the same data', () => {
  const progress = new Map([['intro', { id: 'intro', box: 3, due: '2026-11-08', firstRated: '2026-11-01', reviews: 4 }]]);
  const b = makeBackup({ content: sample, slots: { ...sample.slots, Company: 'Acme' }, settings: { rate: 0.9 }, progress, appVersion: 'x', now: new Date('2026-11-05T10:00:00Z') });
  const r = parseImport(JSON.stringify(b));
  ok(r.ok, r.errors.join('; ')); eq(r.kind, 'backup');
  eq(r.progress, [...progress.values()]); eq(r.slots.Company, 'Acme'); eq(r.settings.rate, 0.9); eq(r.data.questions.length, sample.questions.length);
  eq(backupFileName('2026-11-05'), 'interview-drill-backup-2026-11-05.json');
});
test('normal content file is still accepted by parseImport', () => { const r = parseImport(sampleText); ok(r.ok); eq(r.kind, 'content'); });
test('broken backup is rejected with clear messages', () => {
  const b = makeBackup({ content: clone(), slots: {}, settings: {}, progress: new Map([['x', { id: 'x', box: 9, due: 'soon' }]]), appVersion: 'x' });
  delete b.content.title;
  const r = parseImport(JSON.stringify(b));
  ok(!r.ok); ok(r.errors.some((e) => e.includes('Backup content')), r.errors.join()); ok(r.errors.some((e) => e.includes('"box" must be 1–5')));
});

// ---------- report ----------
const out = document.getElementById('out');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.msg ? ': ' + r.msg : ''}`;
  out.append(li);
}
const failed = results.filter((r) => !r.ok).length;
document.getElementById('summary').textContent = `${results.length - failed} passed, ${failed} failed`;
window.__testResults = { passed: results.length - failed, failed, results };
