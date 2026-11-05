# Prompts to paste into Claude Code

## 1) First session: build Phase 1
```
Read CLAUDE.md and docs/SPEC.md first.
Build Phase 1 (Core) of the Interview Drill app exactly as described in the spec.
Use only data/sample-data.json for testing. Do not add any personal data to the repo.
When done: commit and push to main, then give me the acceptance table
(ผ่าน / ไม่ผ่าน / ยังไม่ได้ทดสอบ) and explain the 3 most important parts of the code simply.
```

## 2) Next session: Phase 2
```
Read CLAUDE.md and docs/SPEC.md. Phase 1 is done.
Build Phase 2 (Mock interview, Stories, Questions to ask, glossary popovers).
Commit, push, and report the acceptance table.
```

## 3) Next session: Phase 3 + deploy
```
Read CLAUDE.md and docs/SPEC.md. Phases 1–2 are done.
Build Phase 3 (PWA: manifest, icons, offline service worker, export backup, install help screen).
Make sure it works on GitHub Pages under the /interview-drill/ path (use relative URLs).
Commit, push, and tell me step by step how to turn on GitHub Pages and install the app on my iPhone.
```

## Fix-a-problem template
```
On my iPhone [Safari / Home Screen app], when I [do X], I expected [Y] but got [Z].
Find the cause, make the smallest safe fix, commit, push, and tell me how to re-test it.
```
