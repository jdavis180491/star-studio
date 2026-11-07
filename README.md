# ⭐ Star Studio

A private daily video-challenge game for children aged 5–9, played on an iPad in Safari.
Kids read a funny brief aloud to unlock filming. Under the hood, it's reading practice.

**Current build: Phase 1.** This phase has the brief, the read-aloud check and word help.

---

## Running it on Replit (from GitHub)

### First time
1. Go to **replit.com** and sign in. Signing in with your GitHub account is easiest.
2. Tap **+ Create App** (or **Create Repl**), then choose **Import from GitHub**.
3. Pick the `star-studio` repository and tap **Import**.
4. When it opens, tap the green **Run** button. The first run takes 1–2 minutes because it installs everything and builds the app.
5. A preview appears. Don't test inside Replit's preview, because the microphone won't work there. Find the web address (it ends in `.replit.dev`) and **open it in Safari on the iPad**.

### Getting new versions
When new code is pushed to GitHub, open your Replit app, go to the **Git** panel, tap **Pull**, then tap **Run** again.

### Secrets (later phases)
Phase 1 needs no keys. Later phases read these from Replit **Secrets** (the padlock icon):
`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` (optional), `DATABASE_URL`, `SESSION_SECRET`.

---

## iPad setup (one time)
- **Settings → General → Keyboard → Enable Dictation: ON.** Safari's speech recognition uses this.
- The first time you tap the mic, Safari asks to use the microphone and speech recognition. Tap **Allow**.
- If you tapped "Don't Allow" by mistake, go to **Settings → Apps → Safari → Microphone** and set it to **Ask** or **Allow**.
- Optional: in Safari, tap **Share → Add to Home Screen** so it opens like an app.

## Testing Phase 1
- Pick a brief, tap the pink **Read it!** mic, and read aloud. Words turn gold as they're heard.
- The bouncing pink dot shows the next word.
- **Tap any word** for help. Help costs 2 coins, and it's free if you're out of coins or have already paid for that word.
- The blue chips at the bottom are **star words** (keywords). Tap one that isn't done yet to practise it on its own. After 3 tries it counts anyway.
- Filming unlocks at about **80%** of words read **and** all star words read.
- **👂 button** (grown-ups): shows exactly what the iPad heard. This is useful if a word keeps not lighting up.
- **Grown-up skip:** press and hold the 🔒 button for 2 seconds to unlock straight away.

## For developers
```
npm install
npm run build && npm start   # http://localhost:3000
npm test                     # reading-matcher unit tests
```
- `client/src/reading/` has the forgiving word matcher (`tracker.js`, `words.js`) and the phonics chunker (`phonics.js`).
- `client/src/speech/recognizer.js` holds the speech interface. The browser engine is used today, and it's built so it can be swapped for Whisper later.
- `server/` is the Express API. It also serves the built React app from `dist/`.
