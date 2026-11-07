# ⭐ Star Studio

A private daily video-challenge game for children aged 5–9, played on an iPad in Safari.
It feels like being a creator; underneath, it's reading practice.

**A day in the studio:**
1. **Read the script.** The brief uses this week's spelling words, and the words light up as the child reads aloud.
2. **Word moment.** Spell an unlock word from tiles to win an effect, or name the video using an unlock word.
3. **Director call.** A voice call with the Director (no subtitles, no menus) to plan the mood, the music, the big ending and any effects.
4. **Studio camera.** Live weather, backdrops (the child is cut out, like a green screen), colour looks, TV frames, stickers and music.
5. **Edit suite.** The server adds an intro, captions, effect hits, ducked music and a sing-along lyric card. There's one remix.
6. **Post.** The child earns followers (with a 1-in-6 chance of a viral hit), then a grown-up approves the video.
7. **Premiere.** The crew's videos are revealed together once everyone has posted, or at 6pm.
8. **Afterwards.** Sticker reactions, one award per child per day, a weekly league, and Friday Premiere Night.

There's also a studio with an avatar, a shop, decor and a trophy shelf, plus a Little Stars mode for younger children and a grown-ups dashboard (kids, approvals, briefs, keywords, crews, reading stats, deleting data).

---

## Replit setup

### Secrets (Tools → Secrets)
| Name | What to put | Needed? |
|---|---|---|
| `SESSION_SECRET` | Any long random text (mash the keyboard, 40+ characters) | **Yes**: keeps logins and video links safe |
| `DATABASE_URL` | Added automatically when you create the PostgreSQL database | **Yes** |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | For Claude briefs, the Director and the edits |
| `ELEVENLABS_API_KEY` | elevenlabs.io → API Keys (needs a paid plan from Replit's servers) | For the Director's voice |
| `OPENAI_API_KEY` | platform.openai.com → API Keys | Optional: rewards unlock words said on camera, and times captions to speech |

`PARENT_PASSCODE` is no longer used (each parent has their own account now). You can delete it.

### App Storage (for videos)
In Replit, open **Object Storage / App Storage** and create a bucket. Videos are then stored privately and survive restarts.
Without it, videos are kept on the server's temporary disk and can disappear.

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
| Database schema | `server/db.js` (migrations run on start) |

**Privacy:**
- AI services only ever see the channel name, never real names.
- Videos are private. They're streamed only with short-lived signed links, to the child's own family, and to crew-mates after the premiere.
- No free-text messaging between children: reactions are a fixed set of stickers.
- Parents can delete any video, any child, or the whole account.
