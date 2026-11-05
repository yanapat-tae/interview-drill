// fade.js — decides which words of an answer are hidden at each fade-out level.
// Pure functions only (no DOM).

import { slotParts } from './data.js';

// Level 0..4 hides this share of all words.
export const LEVEL_SHARE = [0, 0.25, 0.5, 0.75, 1];

// Short "function words" stay visible at levels 1 and 2 (hidden from level 3).
const FUNCTION_WORDS = new Set(`a an the and or but so to of in on at for with by from as is am are was
were be been being it its it's i i'm i'd i've i'll my me we our us you your this that these those then
than if when do does did have has had not no can will would should could there their they them he she
his her what which who how up out about into also very just more most each`.split(/\s+/));

export function isFunctionWord(core) {
  return FUNCTION_WORDS.has(core.toLowerCase().replace(/’/g, "'"));
}

/**
 * Turn answer paragraphs into tokens.
 * Returns { paragraphs: [[token...]...], words: [wordToken...] }
 * token = { type:'space', text } or
 *         { type:'word', pre, core, post, unfilled, index, para }
 * `pre`/`post` are punctuation that always stays visible; `core` is the hideable word.
 */
export function tokenizeAnswer(answer, slots) {
  const words = [];
  const paragraphs = answer.map((para, pi) => {
    const tokens = [];
    for (const part of slotParts(para, slots)) {
      for (const piece of part.text.split(/(\s+)/)) {
        if (piece === '') continue;
        if (/^\s+$/.test(piece)) { tokens.push({ type: 'space', text: piece }); continue; }
        const m = piece.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
        if (!m[2]) { tokens.push({ type: 'space', text: piece }); continue; } // e.g. "→" or "—"
        const w = { type: 'word', pre: m[1], core: m[2], post: m[3], unfilled: !!part.unfilled, index: words.length, para: pi };
        words.push(w);
        tokens.push(w);
      }
    }
    return tokens;
  });
  return { paragraphs, words };
}

// Small deterministic random generator, seeded by text (same seed = same numbers every time).
function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The order in which words get hidden: content words first (shuffled), then function words.
 * Because every level takes the first N of the SAME list, a higher level always hides
 * everything a lower level hides, plus more.
 */
export function hideOrder(words, seed) {
  const rand = mulberry32(hashString(String(seed)));
  const content = words.filter((w) => !isFunctionWord(w.core)).map((w) => w.index);
  const func = words.filter((w) => isFunctionWord(w.core)).map((w) => w.index);
  return { order: [...seededShuffle(content, rand), ...seededShuffle(func, rand)], contentCount: content.length };
}

/** Set of word indexes hidden at `level` (0..4). */
export function hiddenSet(words, seed, level) {
  const lvl = Math.max(0, Math.min(4, level | 0));
  const { order, contentCount } = hideOrder(words, seed);
  let count = Math.round(LEVEL_SHARE[lvl] * words.length);
  if (lvl < 3) count = Math.min(count, contentCount); // keep function words visible below level 3
  return new Set(order.slice(0, count));
}
