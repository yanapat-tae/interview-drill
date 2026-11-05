// mock.js — mock interview: picking questions, timer colours, text-to-speech and recording.

export const MOCK_SIZE = 5;
export const FOLLOW_UP_CHANCE = 0.5;
export const OVERTIME_GRACE = 30;      // seconds after target before the timer turns red
export const FOLLOW_UP_SECONDS = 30;   // target time for a follow-up question

/** Weak questions get a bigger weight, so they are picked more often. */
export function weightOf(p) {
  if (!p) return 3;                    // never practised
  let w = 6 - p.box;                   // box 1 → 5 … box 5 (mastered) → 1
  if (p.lastRating === 1) w += 2;      // last time: "Couldn't"
  return w;
}

/**
 * Pick up to 5 different questions (weighted random) and sometimes add one follow-up
 * right after its parent question. `rand` can be replaced in tests.
 * Item: { key, qid, text, targetSeconds, followUp, hint }
 */
export function pickMockItems(questions, progress, rand = Math.random, n = MOCK_SIZE, followUpChance = FOLLOW_UP_CHANCE) {
  const pool = questions
    .filter((q) => q.status !== 'todo' && q.answer.length > 0)
    .map((q) => ({ q, w: weightOf(progress.get(q.id)) }));
  const picked = [];
  while (picked.length < n && pool.length) {
    let r = rand() * pool.reduce((sum, x) => sum + x.w, 0);
    let i = 0;
    while (i < pool.length - 1 && r >= pool[i].w) { r -= pool[i].w; i++; }
    picked.push(pool.splice(i, 1)[0].q);
  }
  const items = picked.map((q) => ({ key: q.id, qid: q.id, text: q.question, targetSeconds: q.targetSeconds, followUp: false, hint: '' }));

  const withFollowUps = picked.filter((q) => q.followUps.length);
  if (withFollowUps.length && rand() < followUpChance) {
    const q = withFollowUps[Math.floor(rand() * withFollowUps.length)];
    const fi = Math.floor(rand() * q.followUps.length);
    const f = q.followUps[fi];
    const at = items.findIndex((it) => it.qid === q.id) + 1;
    items.splice(at, 0, { key: `${q.id}#followup-${fi}`, qid: q.id, text: f.q, targetSeconds: FOLLOW_UP_SECONDS, followUp: true, hint: f.hint || '' });
  }
  return items;
}

/** 'normal' → 'amber' after the target time → 'red' 30 s later. */
export function timerLevel(seconds, target) {
  if (seconds > target + OVERTIME_GRACE) return 'red';
  if (seconds > target) return 'amber';
  return 'normal';
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------- Text-to-speech ----------------

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export function englishVoices() {
  if (!ttsSupported()) return [];
  return speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

export function pickVoice(voiceURI) {
  const vs = englishVoices();
  return vs.find((v) => v.voiceURI === voiceURI)
    || vs.find((v) => /^en[-_]US/i.test(v.lang) && v.localService)
    || vs.find((v) => /^en[-_]US/i.test(v.lang))
    || vs[0] || null;
}

/**
 * Read `text` aloud. Calls onDone once when speaking ends (or fails).
 * Returns a function that stops speaking without calling onDone.
 * iOS sometimes never fires "end", so a time estimate is used as a fallback.
 */
export function speak(text, { voiceURI = '', rate = 1 } = {}, onDone) {
  let finished = false;
  let fallback = null;
  const done = () => {
    if (finished) return;
    finished = true;
    clearTimeout(fallback);
    onDone?.();
  };
  if (!ttsSupported()) { setTimeout(done, 0); return () => { finished = true; }; }

  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(voiceURI);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
  u.rate = rate;
  u.onend = done;
  u.onerror = done;
  const words = text.split(/\s+/).length;
  fallback = setTimeout(done, (2500 + words * 500) / rate);
  speechSynthesis.speak(u);
  return () => { finished = true; clearTimeout(fallback); speechSynthesis.cancel(); };
}

// ---------------- Recording ----------------

export const recordingSupported = () =>
  typeof window !== 'undefined' && !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/**
 * Start recording from the microphone. Returns { stop(): Promise<Blob>, cancel() }.
 * The microphone is switched off as soon as recording stops (on iPhone, a live microphone
 * can make playback come out of the quiet earpiece speaker).
 */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t));
  let rec;
  try {
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks = [];
  const micOff = () => stream.getTracks().forEach((t) => t.stop());
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start();
  return {
    stop: () => new Promise((resolve) => {
      const finish = () => { micOff(); resolve(new Blob(chunks, { type: rec.mimeType || type || 'audio/mp4' })); };
      if (rec.state === 'inactive') finish();
      else { rec.onstop = finish; rec.stop(); }
    }),
    cancel: () => { try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ } micOff(); },
  };
}
