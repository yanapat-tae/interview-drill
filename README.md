# Interview Drill

A small offline iPhone web app for practising job-interview answers:
learn the key points, practise with fade-out text, and run mock interviews out loud.

- All data stays on the device (IndexedDB). Load your own file with **Import**.
- This repo has only code and fake sample data (`data/sample-data.json`).
- Build spec: [`docs/SPEC.md`](docs/SPEC.md) · Rules for Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Use on iPhone
1. Open https://yanapat-tae.github.io/interview-drill/ in Safari.
2. Share → **Add to Home Screen** → Add. Open **Drill** from the Home Screen.
3. The Home Screen app has its own storage: import your file (or a backup) inside it.
4. After the first open it works offline. Use Settings → **Export backup** every week.

## Run locally
ES modules need a web server (opening `index.html` as a file will not work):
```
python3 -m http.server 8000
```
Then open http://localhost:8000 and tap **Try sample data**.
Unit tests: open http://localhost:8000/tests/unit.html
