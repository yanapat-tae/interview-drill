# Interview Drill — rules for Claude Code

Read this file and `docs/SPEC.md` before doing any work.

## About the owner
- The owner is a beginner programmer. Explain important code briefly and simply.
- They give commands from Claude Code on iPhone, so keep replies short and easy to scan.
- End every task report with two lines:
  - `Claude ทำแล้ว: ...`
  - `สิ่งที่ฉันต้องทำต่อ: ...`
- Report acceptance items as **ผ่าน / ไม่ผ่าน / ยังไม่ได้ทดสอบ**. Never say something works on iPhone
  unless it was tested on a real iPhone. A desktop browser preview does not prove iPhone behaviour.

## Privacy rule (most important)
This repo is **public**. It must never contain the owner's real interview answers, resume,
phone number, email, or any employer-internal information.
- Real data lives only on the owner's iPhone and is loaded with the in-app **Import** button.
- Use only `data/sample-data.json` (fake content) for development and tests.
- Never commit files matching `.gitignore` (e.g. `interview-data.json`, `*.private.json`, backups).
- If you see personal data staged for commit, stop and warn the owner.

## Engineering rules
- Plain HTML, CSS and JavaScript. No framework, no build step, no npm dependencies.
- Make the smallest safe change. Inspect existing files before editing. Keep Git history.
- Never delete or overwrite the owner's stored data. Data format changes need a migration
  step that keeps old data.
- Commit with clear messages after each working phase.
- Design: Aurora / Dark Glass (see `docs/SPEC.md`). Keep text readable (WCAG AA contrast).
