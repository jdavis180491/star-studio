# 🟢 Dibbly Dobs

A private learning and creativity app for children aged 4–11, played on an iPad in Safari.
Children earn **1 Dibbly Dob** for every activity they finish (the same for every family, so it's fair).
Grown-ups can add Dobs for good behaviour, take some away, or take off what they spend at the shops.
Word help is always free. Grown-ups can get **phone notifications** when something needs approving or a child earns a Dob.

**Five sections:**
- 🎬 **Star Studio**: the once-a-day video challenge. Read the script, then a word moment, a call with the Director, the live effects camera, the auto-edit, and finally the crew premiere.
- 📖 **Reading**: make up a story with Story Buddy on a voice call. Claude writes it at the child's level, using their keywords. They read it aloud with the word-by-word tracker and word help. They can do this as often as they like.
- ✏️ **Writing**: write a story to a brother or sister, a crew friend, or their grown-up. A spelling check highlights mistakes and shows the right spelling; if it isn't sure which word was meant, the child says it out loud. Friends can continue the story. Stories to other families are checked by the sender's grown-up first.
- 🐝 **Spelling**: five words for the year group (plus some of your weekly words), said aloud with a sentence. There's a hint after 2 tries, a bigger hint after 3, and then the option to give up.
- 🔢 **Maths**: addition and subtraction (by year group), number bonds and times tables (you choose which), with five questions per set.

Also: a Dibbly Dobs leaderboard (family and crew, resets Monday), trophies at 50 / 250 / 1,000 Dobs earned, an avatar and studio shop that costs Dobs, a Dob history, and Little Stars mode for younger children. Dibbly Dobs are the only points in the app.

---

## Replit setup

### Secrets (Tools → Secrets)
| Name | What to put | Needed? |
|---|---|---|
| `SESSION_SECRET` | Any long random text (mash the keyboard, 40+ characters) | **Yes**: keeps logins and video links safe |
| `DATABASE_URL` | Added automatically when you create the PostgreSQL database | **Yes** |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | For Story Buddy, stories, spell check, spelling sentences, Star Studio briefs, the Director and the edits |
| `ELEVENLABS_API_KEY` | elevenlabs.io → API Keys (needs a paid plan from Replit's servers) | For the Director, Story Buddy and spelling voice |
| `OPENAI_API_KEY` | platform.openai.com → API Keys | Optional: rewards unlock words said on camera, and times captions to speech |

`PARENT_PASSCODE` is no longer used (each parent has their own account now). You can delete it.

### App Storage (for videos)
In Replit, open **Object Storage / App Storage** and create a bucket. Videos are then stored privately and survive restarts.
Without it, videos are kept on the server's temporary disk and can disappear.

### Phone notifications
Nothing to set up on Replit. On each grown-up's phone: open the grown-ups' page in Safari, tap Share → **Add to Home Screen**,
open **Dobs Grown-ups** from the Home Screen, log in, then **Settings → Turn on notifications on this phone** (iPhone needs iOS 16.4+).

### Publishing
Use **Reserved VM**, or set Autoscale's **maximum machines to 1**. Video editing runs in the background on the server, so one always-on machine works best.

### Getting updates
Paste this into Replit's AI chat:
```
Run these shell commands and nothing else: git fetch origin, then git reset --hard origin/main. Do not edit any files. Then restart the app (npm install, npm run build, npm start) and republish. Show me git log --oneline -1, then stop.
```

---

## For developers
```
npm install
npm run build && npm start      # needs DATABASE_URL
npm test                        # unit tests
TEST_DATABASE_URL=postgres://… npm test   # + full API walkthrough (two families, crew, video edit)
node scripts/make-music.mjs     # regenerate the original music loops
```
| Area | Where |
|---|---|
| Reading tracker, phonics | `client/src/reading/` |
| Speech (browser engine today, swappable for Whisper) | `client/src/speech/recognizer.js` |
| Director call | `client/src/components/DirectorCall.jsx`, `server/ai/director.js`, `server/ai/claude.js` |
| Live camera effects | `client/src/camera/` (effects, on-device segmentation, recorder) |
| Auto-edit | `server/media/render.js` (ffmpeg), `server/media/graphics.js` (cards & captions) |
| Accounts & sessions | `server/auth.js`, `server/routes/auth.js` |
| Rewards, shop, trophies | `server/lib/rewards.js`, `server/lib/catalog.js` |
| Crews, premieres | `server/lib/family.js`, `server/lib/videos.js`, `server/routes/kid.js` |
| Grown-ups dashboard | `client/src/parent/ParentApp.jsx`, `server/routes/parent.js` |
| Reading, Writing, Spelling, Maths | `client/src/learn/`, `server/routes/learn.js`, `server/lib/maths.js` |
| Dibbly Dobs (earning, adjustments, leaderboard) | `server/lib/rewards.js` |
| Phone notifications | `server/lib/notify.js`, `client/src/parent/Notifications.jsx`, `client/public/sw.js` |
| Database schema | `server/db.js` (migrations run on start) |

**Privacy:**
- AI services only ever see the channel name, never real names.
- Videos are private. They're streamed only with short-lived signed links, to the child's own family, and to crew-mates after the premiere.
- No free-text messaging between children: reactions are a fixed set of stickers.
- Parents can delete any video, any child, or the whole account.
