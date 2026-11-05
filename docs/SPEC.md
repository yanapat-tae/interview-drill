# Interview Drill — Build Spec

A private iPhone web app (PWA) that helps one person **remember and practise job-interview answers**.
The goal is not word-for-word memorisation. The user first learns the **key points** of each answer,
then practises saying the full answer out loud until it feels natural.

## 1. Target
- **Device:** iPhone, Safari, and "Add to Home Screen" (standalone PWA). Portrait, one hand.
- **Hosting:** GitHub Pages from this public repo (`main` branch, root folder).
- **Offline:** must work fully offline after the first visit.
- **Storage:** on-device only (IndexedDB). No server, no accounts, no analytics, no external API calls.
- **Tech:** plain HTML + CSS + JavaScript (ES modules). No framework, no build step, no CDN.

Suggested files (adjust if there is a good reason):
```
index.html
manifest.webmanifest
sw.js                 service worker (offline cache)
css/style.css
js/app.js             screens + navigation
js/db.js              IndexedDB helpers
js/data.js            import / validate / export / slot filling
js/fade.js            fade-out word hiding
js/review.js          spaced review scheduling
js/mock.js            mock interview (TTS, timer, recording)
icons/                app icons (180, 192, 512 px)
data/sample-data.json fake data for development
```

## 2. Data
The user imports one JSON file (their real file is called `interview-data.json` and is **never** in this repo).
`data/sample-data.json` has the same shape with fake content.

```jsonc
{
  "schemaVersion": 1,
  "title": "string",
  "updated": "YYYY-MM-DD",
  "owner": "string",
  "slots": { "Company": "...", "Role": "...", "RoleFocus": "...", "Industry": "...", "CompanyReason": "..." },
  "questions": [{
    "id": "string",                 // stable, unique
    "category": "core | motivation | behavioral | todo",
    "question": "string",           // may contain {{Slot}}
    "status": "original | edited | new | todo",
    "editNote": "string?",          // why it was edited, shown as a small note
    "targetSeconds": 60,
    "answer": ["paragraph", "..."], // may be empty for status "todo"; may contain {{Slot}}
    "keyPoints": ["short line", "..."],
    "storyIds": ["story id", "..."],
    "followUps": [{ "q": "string", "hint": "string" }]
  }],
  "stories": [{ "id", "title", "when", "situation", "action", "result" }],
  "questionsToAsk": [{ "id", "category", "question", "note?" }],
  "glossary": [{ "term": "English term", "th": "Thai meaning" }]
}
```

Rules:
- **Slots:** replace `{{Name}}` with the value from the slots. The user can edit slot values in
  Settings, so they can switch between companies. Values still in `[square brackets]` are unfilled:
  show them highlighted so the user notices.
- **Validation on import:** check required fields, unique ids, and that `storyIds` exist. Show a
  clear message for each problem. Never import half a file.
- **Re-import:** replace the content but **keep practice progress** for question ids that still exist.
- **Export backup:** download a JSON file with the content and progress (`interview-drill-backup-YYYY-MM-DD.json`),
  so the user can save it to Files/iCloud.

## 3. Screens
1. **Home**
   - Progress summary: questions mastered / learning / new, and today's review count.
   - Big button: **Start today's review**.
   - Buttons: Practise one question · Mock interview · Stories · Questions to ask.
   - First run with no data: explain in one line, then **Import file** and **Try sample data**.
2. **Question list:** grouped by category; shows status badge (edited / new / todo) and mastery level.
3. **Practise one question** (4 steps; the user can jump between them):
   1. **Recall:** show only the question. The user tries to say the key points, then taps **Show key points**.
   2. **Key points:** list of key points + linked story cards.
   3. **Fade-out:** full answer with words progressively hidden.
      Levels 0–4 hide 0%, 25%, 50%, 75%, 100% of words. Hidden words show as a blank of the
      same width; tap a blank to reveal that word. Hide the same words every time at a given level
      (seeded by question id) and keep short function words visible until level 3.
   4. **Rate:** "Couldn't" (1) · "With hints" (2) · "Easily" (3).
   - `todo` questions show the key-point ideas and a note "No answer yet" instead of fade-out.
4. **Mock interview**
   - Pick 5 questions at random (weighted towards weak ones) plus sometimes one follow-up.
   - The app reads the question aloud with `speechSynthesis` (English voice, normal rate).
   - A timer counts up and turns amber after `targetSeconds` and red after +30 s.
   - Optional **record** button (MediaRecorder + microphone). After each answer: play it back,
     then rate 1–3. Keep only the last recording per question, stored in IndexedDB, with a
     "Delete all recordings" button in Settings.
   - At the end: summary list with times and ratings.
5. **Stories:** story cards (situation → action → result) and which questions use them.
6. **Questions to ask:** grouped list; notes shown in small text.
7. **Settings:** edit slot values · import · export backup · reset progress (with confirm) ·
   delete recordings · voice and speech rate · app version.

## 4. Spaced review (simple Leitner boxes)
Each question has a box from 1 to 5 (new = 1).
- Rating 1 → box 1 · Rating 2 → stay · Rating 3 → box + 1 (max 5)
- Next review after: box 1 = same day, 2 = 1 day, 3 = 3 days, 4 = 7 days, 5 = 14 days.
- "Mastered" = box 5. "Today's review" = questions whose due date is today or earlier, plus up
  to 3 new questions per day.

## 5. Glossary (English learning aid)
In all answer text, show glossary terms in **amber** (case-insensitive, whole word/phrase).
Tapping a term shows its Thai meaning in a small popover. Terms must not break the fade-out
(a hidden word stays hidden).

## 6. Design — Aurora / Dark Glass
- Background: near-black (#07080d) with 2–3 slow, soft aurora gradient blobs (teal, violet, blue),
  low opacity. Respect `prefers-reduced-motion`.
- Cards: frosted glass (`backdrop-filter: blur`), 1px light border, rounded 20–24 px, generous padding.
- Text: high contrast (WCAG AA). Body 17 px. System font stack (`-apple-system`, …).
- Accent: teal for actions, amber for glossary terms and warnings, red only for over-time.
- Touch targets ≥ 44 px. Bottom tab bar within the iPhone safe area (`env(safe-area-inset-*)`).
- Dark mode only.

## 7. Build phases
Build one phase at a time. After each phase: commit, push, and report the acceptance table.

- **Phase 1 — Core:** data import/validation/slots, sample data, Home, question list, Practise
  (recall, key points, fade-out, rate), spaced review, Settings (slots, import, reset), design.
- **Phase 2 — Mock interview:** text-to-speech, timer, recording + playback, summary, Stories,
  Questions to ask, glossary popovers.
- **Phase 3 — PWA:** manifest, icons, service worker (offline), export backup, GitHub Pages deploy,
  install instructions screen for iPhone.

## 8. Acceptance checklist
Report each item as **ผ่าน / ไม่ผ่าน / ยังไม่ได้ทดสอบ**, and say where it was tested
(desktop preview, iPhone Safari, iPhone Home Screen app).

| # | Check |
|---|---|
| 1 | Sample data loads; all screens open without console errors |
| 2 | Importing a broken JSON shows clear errors and changes nothing |
| 3 | Re-import keeps progress for existing question ids |
| 4 | Slots fill correctly; unfilled `[ ]` values are highlighted |
| 5 | Fade-out levels hide 0/25/50/75/100% and are the same each time |
| 6 | Ratings move questions between boxes; due dates are correct |
| 7 | Text-to-speech reads the question on iPhone |
| 8 | Recording and playback work on iPhone (Safari and Home Screen app) |
| 9 | App opens and works in airplane mode after first load |
| 10 | Export backup produces a file that can be imported again |
| 11 | Glossary terms are amber and show Thai on tap |
| 12 | Repo contains no personal data (only sample data) |
