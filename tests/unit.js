// Unit tests for the pure modules. Open tests/unit.html through a local web server.
import { parseAndValidate, validateData, fillSlots, slotParts, isUnfilled } from '../js/data.js';
import { tokenizeAnswer, hiddenSet, isFunctionWord, LEVEL_SHARE } from '../js/fade.js';
import { applyRating, addDays, todaysReview, mastery } from '../js/review.js';

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
