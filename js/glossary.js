// glossary.js — find glossary terms inside answer text. Pure functions only.
// Works on the same word list as fade-out, so a hidden word stays hidden even if it is a glossary term.

const norm = (s) => s.toLowerCase().replace(/’/g, "'");
// Same edge-trimming as the fade tokenizer: "e.g." → "e.g", "(prioritize)" → "prioritize"
const core = (s) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Returns Map(wordIndex → glossary entry). Case-insensitive, whole words only.
 * A phrase ("production line") matches only consecutive words in the same paragraph.
 * Longer phrases win over shorter ones that start at the same word.
 */
export function glossaryMatches(words, glossary = []) {
  const terms = glossary
    .map((g) => ({ g, parts: g.term.trim().split(/\s+/).map((p) => norm(core(p))).filter(Boolean) }))
    .filter((t) => t.parts.length)
    .sort((a, b) => b.parts.length - a.parts.length);
  const out = new Map();
  for (let i = 0; i < words.length; i++) {
    if (out.has(i)) continue;
    for (const t of terms) {
      const n = t.parts.length;
      if (i + n > words.length) continue;
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        const w = words[i + k];
        ok = norm(w.core) === t.parts[k] && w.para === words[i].para;
      }
      if (!ok) continue;
      for (let k = 0; k < n; k++) out.set(i + k, t.g);
      i += n - 1;
      break;
    }
  }
  return out;
}
