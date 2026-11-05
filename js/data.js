// data.js — import, validation and slot filling.
// Pure functions only (no DOM, no IndexedDB), so they are easy to test.

export const SCHEMA_VERSION = 1;
export const CATEGORIES = ['core', 'motivation', 'behavioral', 'todo'];
export const STATUSES = ['original', 'edited', 'new', 'todo'];

const SLOT_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);

/**
 * Parse JSON text and validate it.
 * Returns { ok, errors: [], warnings: [], data }.
 * If ok is false, nothing should be saved.
 */
export function parseAndValidate(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`The file is not valid JSON (${e.message}).`], warnings: [], data: null };
  }
  return validateData(raw);
}

export function validateData(raw) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);

  if (!isObj(raw)) {
    return { ok: false, errors: ['The file must contain one JSON object { ... }.'], warnings, data: null };
  }

  if (raw.schemaVersion !== SCHEMA_VERSION) {
    err(`"schemaVersion" must be ${SCHEMA_VERSION} (found ${JSON.stringify(raw.schemaVersion)}).`);
  }
  if (!isNonEmptyStr(raw.title)) err('"title" is missing or empty.');
  if (raw.slots !== undefined && !isObj(raw.slots)) err('"slots" must be an object like { "Company": "..." }.');
  if (isObj(raw.slots)) {
    for (const [k, v] of Object.entries(raw.slots)) {
      if (!isStr(v)) err(`Slot "${k}" must be text.`);
    }
  }

  // --- stories (checked first so questions can refer to them) ---
  const storyIds = new Set();
  checkList(raw, 'stories', false, err, (s, where) => {
    if (!isNonEmptyStr(s.id)) err(`${where}: "id" is missing.`);
    else if (storyIds.has(s.id)) err(`${where}: id "${s.id}" is used twice.`);
    else storyIds.add(s.id);
    for (const f of ['title', 'situation', 'action', 'result']) {
      if (!isNonEmptyStr(s[f])) err(`${where}: "${f}" is missing.`);
    }
    if (s.when !== undefined && !isStr(s.when)) err(`${where}: "when" must be text.`);
  });

  // --- questions ---
  const qIds = new Set();
  const usedSlots = new Set();
  const collectSlots = (t) => { if (isStr(t)) for (const n of slotNamesIn(t)) usedSlots.add(n); };
  const okQuestions = checkList(raw, 'questions', true, err, (q, where) => {
    const label = isNonEmptyStr(q.id) ? `Question "${q.id}"` : where;
    if (!isNonEmptyStr(q.id)) err(`${where}: "id" is missing.`);
    else if (qIds.has(q.id)) err(`${label}: id is used twice.`);
    else qIds.add(q.id);

    if (!CATEGORIES.includes(q.category)) err(`${label}: "category" must be one of ${CATEGORIES.join(', ')}.`);
    if (!isNonEmptyStr(q.question)) err(`${label}: "question" is missing.`);
    if (!STATUSES.includes(q.status)) err(`${label}: "status" must be one of ${STATUSES.join(', ')}.`);
    if (q.editNote !== undefined && !isStr(q.editNote)) err(`${label}: "editNote" must be text.`);
    if (typeof q.targetSeconds !== 'number' || !(q.targetSeconds > 0)) err(`${label}: "targetSeconds" must be a number above 0.`);
    if (!isStrArray(q.answer)) err(`${label}: "answer" must be a list of paragraphs (text).`);
    else if (q.answer.length === 0 && q.status !== 'todo') warnings.push(`${label}: has no answer yet (status is not "todo").`);
    if (!isStrArray(q.keyPoints)) err(`${label}: "keyPoints" must be a list of text.`);
    if (!isStrArray(q.storyIds)) err(`${label}: "storyIds" must be a list of story ids.`);
    else for (const sid of q.storyIds) if (!storyIds.has(sid)) err(`${label}: story "${sid}" does not exist in "stories".`);
    if (!Array.isArray(q.followUps)) err(`${label}: "followUps" must be a list.`);
    else q.followUps.forEach((f, i) => {
      if (!isObj(f) || !isNonEmptyStr(f.q)) err(`${label}: follow-up #${i + 1} needs "q".`);
      else if (f.hint !== undefined && !isStr(f.hint)) err(`${label}: follow-up #${i + 1} "hint" must be text.`);
    });

    collectSlots(q.question);
    if (Array.isArray(q.answer)) q.answer.forEach(collectSlots);
    if (Array.isArray(q.keyPoints)) q.keyPoints.forEach(collectSlots);
  });
  if (okQuestions && raw.questions.length === 0) err('"questions" is empty.');

  // --- questions to ask ---
  const askIds = new Set();
  checkList(raw, 'questionsToAsk', false, err, (a, where) => {
    if (!isNonEmptyStr(a.id)) err(`${where}: "id" is missing.`);
    else if (askIds.has(a.id)) err(`${where}: id "${a.id}" is used twice.`);
    else askIds.add(a.id);
    if (!isNonEmptyStr(a.category)) err(`${where}: "category" is missing.`);
    if (!isNonEmptyStr(a.question)) err(`${where}: "question" is missing.`);
    if (a.note !== undefined && !isStr(a.note)) err(`${where}: "note" must be text.`);
  });

  // --- glossary ---
  checkList(raw, 'glossary', false, err, (g, where) => {
    if (!isNonEmptyStr(g.term)) err(`${where}: "term" is missing.`);
    if (!isNonEmptyStr(g.th)) err(`${where}: "th" is missing.`);
  });

  const slots = isObj(raw.slots) ? raw.slots : {};
  for (const name of usedSlots) {
    if (!(name in slots)) warnings.push(`Slot {{${name}}} is used but has no value in "slots".`);
  }

  if (errors.length) return { ok: false, errors, warnings, data: null };

  // Normalised copy: optional lists default to [].
  const data = {
    ...raw,
    slots: { ...slots },
    stories: raw.stories ?? [],
    questionsToAsk: raw.questionsToAsk ?? [],
    glossary: raw.glossary ?? [],
  };
  return { ok: true, errors, warnings, data };
}

// Checks that raw[key] is a list of objects and runs `each` on every item.
function checkList(raw, key, required, err, each) {
  const list = raw[key];
  if (list === undefined) {
    if (required) err(`"${key}" is missing.`);
    return false;
  }
  if (!Array.isArray(list)) { err(`"${key}" must be a list [ ... ].`); return false; }
  list.forEach((item, i) => {
    const where = `${key} #${i + 1}`;
    if (!isObj(item)) err(`${where} must be an object { ... }.`);
    else each(item, where);
  });
  return true;
}

// ---------------- Slots ----------------

export function slotNamesIn(text) {
  return [...text.matchAll(SLOT_RE)].map((m) => m[1]);
}

/** A slot value is "unfilled" if it is empty or still written like [something]. */
export function isUnfilled(value) {
  return typeof value !== 'string' || value.trim() === '' || /^\s*\[.*\]\s*$/s.test(value);
}

/**
 * Split text into parts: plain text and filled slots.
 * Example: "Join {{Company}}!" -> [{text:"Join "}, {text:"Acme", slot:"Company", unfilled:false}, {text:"!"}]
 */
export function slotParts(text, slots = {}) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(SLOT_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const name = m[1];
    const has = Object.prototype.hasOwnProperty.call(slots, name);
    const value = has ? slots[name] : undefined;
    const unfilled = isUnfilled(value);
    let shown = value;
    if (!has) shown = `{{${name}}}`;
    else if (typeof value !== 'string' || value.trim() === '') shown = `[${name}]`;
    parts.push({ text: shown, slot: name, unfilled });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function fillSlots(text, slots = {}) {
  return slotParts(text, slots).map((p) => p.text).join('');
}
