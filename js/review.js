// review.js — simple Leitner-box spaced review. Pure functions only.
// Dates are local calendar days written as "YYYY-MM-DD".

export const DAYS_FOR_BOX = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
export const NEW_PER_DAY = 3;
export const MAX_BOX = 5;

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n)); // Date handles month/year rollover
}

/**
 * New progress record after a rating.
 * rating 1 = Couldn't → box 1, 2 = With hints → same box, 3 = Easily → box + 1 (max 5).
 */
export function applyRating(id, prev, rating, today) {
  const oldBox = prev?.box ?? 1;
  let box = oldBox;
  if (rating === 1) box = 1;
  else if (rating === 3) box = Math.min(MAX_BOX, oldBox + 1);
  return {
    id,
    box,
    due: addDays(today, DAYS_FOR_BOX[box]),
    lastRated: today,
    lastRating: rating,
    firstRated: prev?.firstRated ?? today,
    reviews: (prev?.reviews ?? 0) + 1,
  };
}

/** 'new' (never rated), 'learning' (box 1–4) or 'mastered' (box 5). */
export function mastery(p) {
  if (!p) return 'new';
  return p.box >= MAX_BOX ? 'mastered' : 'learning';
}

export function isDue(p, today) {
  return !!p && p.due <= today; // "YYYY-MM-DD" strings sort like dates
}

/**
 * Today's review = questions due today or earlier + up to 3 new questions per day.
 * New questions already rated for the first time today count toward the 3.
 * Questions with status "todo" are not picked as new (they have no answer yet).
 */
export function todaysReview(questions, progress, today) {
  const due = questions
    .filter((q) => isDue(progress.get(q.id), today))
    .sort((a, b) => {
      const pa = progress.get(a.id), pb = progress.get(b.id);
      return pa.due.localeCompare(pb.due) || pa.box - pb.box;
    })
    .map((q) => q.id);
  const startedToday = questions.filter((q) => progress.get(q.id)?.firstRated === today).length;
  const room = Math.max(0, NEW_PER_DAY - startedToday);
  const fresh = questions
    .filter((q) => !progress.has(q.id) && q.status !== 'todo')
    .slice(0, room)
    .map((q) => q.id);
  return { due, fresh, all: [...due, ...fresh] };
}

export function summarize(questions, progress) {
  const s = { new: 0, learning: 0, mastered: 0 };
  for (const q of questions) s[mastery(progress.get(q.id))]++;
  return s;
}
