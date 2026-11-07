# ⭐ Star Studio

A private daily video-challenge game for children aged 5–9, played on an iPad in Safari.
Kids read a funny brief aloud to unlock filming, chat with a voiced AI Director, then film their take.
Under the hood, it's reading practice.

**Current build: Phases 1–3.**
- Read-aloud script with word help
- Briefs written by Claude using your keywords, plus a phonics word bank
- A word moment (spell a word from tiles, or name the video)
- A voiced Director chat
- Filming with the iPad camera

The auto-edit (music, captions, effects) comes in Phase 4.

---

## Running it on Replit (from GitHub)

### First time
1. Go to **replit.com** and sign in with GitHub.
2. Tap **Create App** → **Import from GitHub** → pick `star-studio` → **Import**.
3. Leave everything as imported. Don't let Replit's AI "set up" the project.
4. Tap **Run**. The first run takes 1–2 minutes.
5. Open the `.replit.dev` web address **in Safari on the iPad**. The microphone and camera don't work inside Replit's own preview.

### Getting new versions
Open the **Git** panel → **Pull**, then tap **Run** again, then refresh Safari.

### Secrets (the padlock icon, "Secrets")
Add each one with **+ New Secret**: type the name exactly as shown, paste the value, then tap **Add Secret**.

| Name | What it is | Needed for |
|---|---|---|
| `PARENT_PASSCODE` | Any passcode you choose, e.g. 6 digits | The grown-ups dashboard |
| `ANTHROPIC_API_KEY` | From console.anthropic.com → API Keys | Claude writing briefs and the Director's replies |
| `ELEVENLABS_API_KEY` | From elevenlabs.io → your profile → API Keys | The Director's voice |
| `DATABASE_URL` | Added **automatically** when you add a database (below) | Saving keywords and briefs |
| `SESSION_SECRET` | Not needed yet (Phase 5) | Kids' logins |
| `OPENAI_API_KEY` | Optional, not needed yet | A future upgrade to speech recognition |

After adding or changing secrets, tap **Stop** and then **Run**.

### Database
In Replit, open the **Database** tool (search "Database" in the tools list) and create a **PostgreSQL** database.
Replit adds `DATABASE_URL` for you. Then Stop and Run. Without a database the app still runs, but saved
briefs and keywords may be lost when Replit restarts.

---

## iPad setup (one time)
- **Settings → General → Keyboard → Enable Dictation: ON.** Safari's speech recognition uses this.
- When Safari asks for the **microphone**, **speech recognition** and **camera**, tap **Allow**.
- If you tapped "Don't Allow" by mistake, go to **Settings → Apps → Safari → Camera / Microphone** and set it to **Ask** or **Allow**.
- Optional: **Settings → Accessibility → Spoken Content → Voices → English (UK)**: download an *Enhanced* voice for nicer word help.

## How a day works
1. **Grown-ups** (`/parent`, or the small "Grown-ups" link on the home screen):
   - Add this week's spelling words, or use **Suggest from word bank**.
   - Under **Daily briefs**, tap **Write with Claude**, check the result, then **Approve for the kids**. You can do tomorrow's the night before.
   - Under **Studio**, set the channel name and choose the Director's voice.
2. **Kids** tap **Start script read**. They read aloud and the words light up.
3. Filming unlocks at about 80% of the words, all the unlock words and the last sentence.
4. **Word moment**: spell a word from tiles to unlock an effect, or type a video title that uses an unlock word.
5. **Director's chair**: the Director asks about mood, music and the big ending. Kids answer by voice, or tap a choice.
6. **Camera**: a 3-2-1 countdown, up to 60 seconds, with as many retakes as they like.

Until you approve a brief for the day, kids get a built-in practice brief.

### Grown-up tricks
- **👂** on the reading screen shows what the iPad heard.
- Press and hold **LOCKED** for 2 seconds to skip the reading check.

## Privacy so far
- The AI services only ever see the **channel name**, never children's names.
- The Director's voice can only speak lines the server wrote itself, so nobody else can use your ElevenLabs key.
- Videos stay on the iPad until Phase 4 adds private storage.

## For developers
```
npm install
npm run build && npm start   # http://localhost:3000
npm test
```
- `client/src/reading/`: the forgiving word matcher and the phonics chunker
- `client/src/speech/recognizer.js`: the speech interface (the browser engine today, Whisper-ready)
- `server/ai/claude.js`: Claude (`claude-sonnet-5-5`) structured-output calls
- `server/ai/voice.js`: ElevenLabs
- `server/store/`: Postgres (or a JSON file when there's no `DATABASE_URL`)
- `server/data/wordBank.js`: Reception to Year 6 starter word bank
- `docs/ROADMAP.md`: decisions and phases
