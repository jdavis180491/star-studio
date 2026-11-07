// The auto-edit: turns a raw take into a finished video with ffmpeg.
//   intro card → the child's clip (+ captions & effect hits) → sing-along lyrics → outro
//   with background music ducked under the child's voice.
// Jobs run one at a time in the background; the app polls the video's status.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegStatic from 'ffmpeg-static';
import { one, q, many } from '../db.js';
import { localCopy, putFile, removeFile, tmpPath } from './storage.js';
import { introCard, outroCard, captionOverlay, lyricCard, reelCard } from './graphics.js';
import { claudeEnabled, editPlan } from '../ai/claude.js';
import { transcribe } from '../ai/transcribe.js';
import { spokenWords, isKeywordForm, normalizeWord } from '../../client/src/reading/words.js';
import { MUSIC, EDIT_EFFECTS } from '../../client/src/shared/creative.js';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIRS = [path.join(here, '..', '..', 'client', 'public', 'music'), path.join(here, '..', '..', 'dist', 'music')];
const INTRO = 2.5;
const OUTRO = 2.5;
const LYRIC_LINE = 1.9;
const MAX_CLIP = 62;

function run(args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200000) err = err.slice(-100000);
    });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-1500)}`));
    });
    p.on('error', reject);
  });
}

/** Duration (seconds) and whether the file has an audio track. */
export async function probe(file) {
  const out = await run(['-i', file, '-f', 'null', '-t', '0.1', '-']).catch((e) => e.message);
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  let seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  const hasAudio = /Stream #\d+:\d+.*Audio:/.test(out);
  if (!seconds || !Number.isFinite(seconds)) {
    // Some browser recordings have no duration header: decode to measure.
    const full = await run(['-i', file, '-f', 'null', '-']).catch((e) => e.message);
    const times = [...full.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
    if (times) seconds = Number(times[1]) * 3600 + Number(times[2]) * 60 + Number(times[3]);
  }
  return { seconds: Math.min(seconds || 0, MAX_CLIP), hasAudio };
}

function musicFile(id) {
  const name = MUSIC.some((m) => m.id === id) ? id : 'pop';
  for (const d of MUSIC_DIRS) {
    const f = path.join(d, `${name}.mp3`);
    if (fs.existsSync(f)) return f;
  }
  throw new Error('Music files missing');
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Make the edit plan safe: times inside the clip, sensible lengths, limited counts. */
export function cleanEdit(edit, seconds, brief) {
  const dur = Math.max(1, seconds);
  const captions = (edit.captions || [])
    .map((c) => {
      const start = clamp(Number(c.start) || 0, 0, dur - 0.5);
      const end = clamp(Number(c.end) || start + 2, start + 0.8, Math.min(dur, start + 4));
      return { start, end, text: String(c.text || '').slice(0, 40), position: c.position === 'top' ? 'top' : 'bottom' };
    })
    .filter((c) => c.text)
    .slice(0, 6);
  const effects = (edit.effects || [])
    .filter((e) => EDIT_EFFECTS.includes(e.type))
    .map((e) => {
      const start = clamp(Number(e.start) || 0, 0, dur - 0.3);
      return { type: e.type, start, end: clamp(Number(e.end) || start + 0.6, start + 0.2, Math.min(dur, start + 1.5)) };
    })
    .slice(0, 4);
  const kws = (brief.keywords || []).map(normalizeWord);
  let lyrics = (edit.lyrics || []).map((l) => String(l).slice(0, 60)).filter(Boolean).slice(0, 8);
  if (lyrics.length < 4) lyrics = [];
  if (lyrics.length && !kws.every((k) => lyrics.some((l) => spokenWords(l).some((w) => isKeywordForm(k, w))))) {
    // Keep it anyway: it's still a song, but log so we can tune the prompt.
    console.warn('Lyrics missing some keywords');
  }
  return {
    intro_tagline: String(edit.intro_tagline || '').slice(0, 50),
    captions,
    effects,
    lyrics,
    outro_text: String(edit.outro_text || 'See you tomorrow!').slice(0, 40),
  };
}

/** Edit plan without AI: hype captions spread through the clip and a hit at the end. */
export function fallbackEdit(seconds, brief, plan, remix) {
  const d = Math.max(3, seconds);
  const lines = remix
    ? ['REMIX TIME', 'NO WAY...', 'TURN IT UP', 'WAIT FOR IT']
    : ['BREAKING NEWS', `${String(brief.title || 'TODAY').toUpperCase()}`, 'WAIT FOR IT...', 'THE BIG FINISH!'];
  return {
    intro_tagline: plan?.mood === 'spooky' ? 'If you dare...' : 'You are not ready.',
    captions: lines.map((text, i) => ({ start: (d * i) / lines.length + 0.3, end: (d * i) / lines.length + 2.3, text, position: i % 2 ? 'top' : 'bottom' })),
    effects: [{ type: remix ? 'glitch' : 'flash', start: Math.max(0, d - 2), end: Math.max(0.5, d - 1.4) }, { type: 'shake', start: Math.max(0, d - 1.3), end: d - 0.4 }],
    lyrics: [],
    outro_text: 'See you tomorrow!',
  };
}

function effectFilters(effects) {
  const f = [];
  for (const e of effects) {
    const on = `between(t,${e.start.toFixed(2)},${e.end.toFixed(2)})`;
    if (e.type === 'flash') f.push(`eq=brightness=0.32:saturation=1.4:enable='${on}'`);
    if (e.type === 'glitch') f.push(`rgbashift=rh=14:bh=-14:gv=6:enable='${on}'`);
    if (e.type === 'shake') f.push(`crop=w=1220:h=686:x='30+28*sin(t*55)*${on}':y='17+16*cos(t*47)*${on}',scale=1280:720`);
    if (e.type === 'zoom') f.push(`zoompan=z='if(${on.replace(/\bt\b/g, 'it')},1.18,1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30`);
  }
  return f;
}

/**
 * Render the finished video. Returns { file, thumb, seconds }.
 * Exported for tests; jobs call renderVideo().
 */
export async function buildEdit({ rawFile, edit, plan, brief, channelName, title, workDir }) {
  const { seconds, hasAudio } = await probe(rawFile);
  if (seconds < 1) throw new Error('The clip is empty');
  const mood = plan?.mood || 'funny';
  const files = [];
  const img = (name) => {
    const f = path.join(workDir, name);
    files.push(f);
    return f;
  };
  const intro = introCard(img('intro.png'), { channelName, title: title || brief.title, tagline: edit.intro_tagline, mood });
  const outro = outroCard(img('outro.png'), { channelName, text: edit.outro_text, mood });
  const caps = edit.captions.map((c, i) => captionOverlay(img(`cap${i}.png`), { ...c, index: i }));
  const lyr = edit.lyrics.map((_, i) => lyricCard(img(`lyric${i}.png`), { lines: edit.lyrics, current: i, keywords: brief.keywords, channelName, mood }));

  const args = ['-i', rawFile];
  args.push('-loop', '1', '-framerate', '30', '-t', String(INTRO), '-i', intro);
  args.push('-loop', '1', '-framerate', '30', '-t', String(OUTRO), '-i', outro);
  lyr.forEach((f) => args.push('-loop', '1', '-framerate', '30', '-t', String(LYRIC_LINE), '-i', f));
  const capBase = 3 + lyr.length;
  caps.forEach((f) => args.push('-i', f));
  const musicIdx = capBase + caps.length;
  args.push('-stream_loop', '-1', '-i', musicFile(plan?.music));

  const total = INTRO + seconds + lyr.length * LYRIC_LINE + OUTRO;
  const fc = [];
  // Main clip, normalised to 1280x720 @30fps.
  let v = '[0:v]';
  fc.push(`${v}trim=0:${seconds.toFixed(2)},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0a0a10,setsar=1,fps=30,format=yuv420p[m0]`);
  v = '[m0]';
  const fx = effectFilters(edit.effects);
  if (fx.length) {
    fc.push(`${v}${fx.join(',')}[m1]`);
    v = '[m1]';
  }
  caps.forEach((_, i) => {
    const c = edit.captions[i];
    fc.push(`${v}[${capBase + i}:v]overlay=0:0:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[c${i}]`);
    v = `[c${i}]`;
  });
  fc.push(`${v}format=yuv420p,setsar=1[mainv]`);
  if (hasAudio) fc.push(`[0:a]atrim=0:${seconds.toFixed(2)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,apad=whole_dur=${seconds.toFixed(2)}[maina]`);
  else fc.push(`anullsrc=r=44100:cl=stereo,atrim=0:${seconds.toFixed(2)}[maina]`);
  // Cards.
  const silence = (label, d) => fc.push(`anullsrc=r=44100:cl=stereo,atrim=0:${d}[${label}]`);
  fc.push(`[1:v]zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=in:st=0:d=0.3,fade=out:st=${INTRO - 0.3}:d=0.3,format=yuv420p,setsar=1[iv]`);
  silence('ia', INTRO);
  lyr.forEach((_, i) => {
    fc.push(`[${3 + i}:v]format=yuv420p,setsar=1,fps=30[lv${i}]`);
    silence(`la${i}`, LYRIC_LINE);
  });
  fc.push(`[2:v]fade=in:st=0:d=0.3,format=yuv420p,setsar=1,fps=30[ov]`);
  silence('oa', OUTRO);
  const segs = ['[iv][ia]', '[mainv][maina]', ...lyr.map((_, i) => `[lv${i}][la${i}]`), '[ov][oa]'];
  fc.push(`${segs.join('')}concat=n=${segs.length}:v=1:a=1[vout][voice]`);
  // Music under the voice (ducked while the child talks), louder on the cards.
  fc.push(`[voice]asplit=2[vk][vm]`);
  fc.push(`[${musicIdx}:a]atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,volume=0.5,afade=t=out:st=${(total - 1).toFixed(2)}:d=1[mus]`);
  fc.push(`[mus][vk]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=400[duck]`);
  fc.push(`[vm][duck]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]`);

  const out = path.join(workDir, 'final.mp4');
  await run([
    ...args,
    '-filter_complex', fc.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', process.env.RENDER_PRESET || 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    out,
  ]);
  const thumb = path.join(workDir, 'thumb.jpg');
  await run(['-ss', String(INTRO + Math.min(2, seconds / 2)), '-i', out, '-frames:v', '1', '-vf', 'scale=640:360', '-q:v', '4', thumb]);
  return { file: out, thumb, seconds, total, hasAudio };
}

// ------------------------------------------------------------- jobs

const queue = [];
let busy = false;

export function enqueue(job) {
  queue.push(job);
  pump();
}

async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  try {
    await job();
  } catch (e) {
    console.error('Job failed', e);
  } finally {
    busy = false;
    setImmediate(pump);
  }
}

export const queueLength = () => queue.length + (busy ? 1 : 0);

async function extractAudio(rawFile, workDir) {
  const f = path.join(workDir, 'audio.mp3');
  await run(['-i', rawFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', f]);
  return f;
}

/** Full pipeline for one video: transcript → edit plan → render → store. */
export function renderVideo(videoId, { remix = false } = {}) {
  enqueue(async () => {
    const v = await one(`SELECT v.*, k.channel_name FROM videos v JOIN kids k ON k.id = v.kid_id WHERE v.id = $1`, [videoId]);
    if (!v || !v.raw_key) return;
    const workDir = await fsp.mkdtemp(tmpPath('render-'));
    try {
      await q(`UPDATE videos SET status = 'rendering', render_error = NULL WHERE id = $1`, [videoId]);
      const rawFile = await localCopy(v.raw_key);
      const { seconds, hasAudio } = await probe(rawFile);

      // What did they say? (optional Whisper) → keywords said on camera.
      let transcript = v.transcript;
      let timed = null;
      if (hasAudio && transcript == null) {
        try {
          const t = await transcribe(await extractAudio(rawFile, workDir));
          if (t) {
            transcript = t.text;
            timed = t.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
          }
        } catch (e) {
          console.warn('Transcription skipped:', e.message);
        }
      }
      const said = transcript
        ? (v.brief.keywords || []).filter((k) => spokenWords(transcript).some((w) => isKeywordForm(normalizeWord(k), w)))
        : v.keywords_said || [];

      let edit = null;
      if (claudeEnabled()) {
        try {
          edit = await editPlan({ brief: v.brief, plan: v.plan, title: v.title, channelName: v.channel_name, seconds, transcript: timed || transcript, remix });
        } catch (e) {
          console.warn('Edit plan fell back:', e.message);
        }
      }
      edit = cleanEdit(edit || fallbackEdit(seconds, v.brief, v.plan, remix), seconds, v.brief);

      const plan = { ...v.plan };
      if (remix) {
        // A remix also swaps the music for a different style.
        const others = MUSIC.map((m) => m.id).filter((id) => id !== v.plan?.music);
        plan.music = others[Math.floor(Math.random() * others.length)];
      }
      const out = await buildEdit({ rawFile, edit, plan, brief: v.brief, channelName: v.channel_name, title: v.title, workDir });
      const finalKey = `videos/${v.id}/final-${Date.now()}.mp4`;
      const thumbKey = `videos/${v.id}/thumb-${Date.now()}.jpg`;
      await putFile(finalKey, out.file);
      await putFile(thumbKey, out.thumb);
      const old = await one(`SELECT final_key, thumb_key FROM videos WHERE id = $1`, [videoId]);
      await q(
        `UPDATE videos SET status = 'ready', final_key = $2, thumb_key = $3, edit = $4, plan = $5, seconds = $6,
           transcript = $7, keywords_said = $8, remixes = remixes + $9 WHERE id = $1`,
        [videoId, finalKey, thumbKey, { ...edit, music: plan.music }, plan, Math.round(out.seconds), transcript, JSON.stringify(said), remix ? 1 : 0]
      );
      if (old?.final_key) await removeFile(old.final_key);
      if (old?.thumb_key) await removeFile(old.thumb_key);
    } catch (e) {
      console.error('Render failed', videoId, e.message);
      await q(`UPDATE videos SET status = 'failed', render_error = $2 WHERE id = $1`, [videoId, String(e.message).slice(0, 500)]);
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true });
    }
  });
}

/** Friday "Premiere Night": a reel of the week's crew videos. */
export function renderReel(scope, weekStart, crewName) {
  enqueue(async () => {
    const workDir = await fsp.mkdtemp(tmpPath('reel-'));
    try {
      const vids = await many(
        `SELECT v.id, v.final_key, v.title, v.brief, k.channel_name FROM videos v JOIN kids k ON k.id = v.kid_id
          WHERE v.scope = $1 AND v.brief_date >= $2 AND v.brief_date < ($2::date + 7) AND v.status = 'approved' AND v.final_key IS NOT NULL
          ORDER BY v.brief_date, v.approved_at LIMIT 10`,
        [scope, weekStart]
      );
      if (!vids.length) throw new Error('No videos this week yet');
      const args = [];
      const fc = [];
      const segs = [];
      let idx = 0;
      const addCard = (heading, sub, d) => {
        const f = reelCard(path.join(workDir, `card${idx}.png`), { heading, sub });
        args.push('-loop', '1', '-framerate', '30', '-t', String(d), '-i', f);
        fc.push(`[${idx}:v]format=yuv420p,setsar=1,fps=30[v${idx}]`, `anullsrc=r=44100:cl=stereo,atrim=0:${d}[a${idx}]`);
        segs.push(`[v${idx}][a${idx}]`);
        idx++;
      };
      addCard('Premiere Night', crewName || 'This week', 2.5);
      for (const v of vids) {
        addCard(v.title || v.brief?.title || 'Untitled', v.channel_name, 1.6);
        const file = await localCopy(v.final_key);
        args.push('-ss', String(INTRO), '-t', '12', '-i', file);
        fc.push(`[${idx}:v]scale=1280:720,setsar=1,fps=30,format=yuv420p[v${idx}]`, `[${idx}:a]aresample=44100,aformat=channel_layouts=stereo[a${idx}]`);
        segs.push(`[v${idx}][a${idx}]`);
        idx++;
      }
      fc.push(`${segs.join('')}concat=n=${segs.length}:v=1:a=1[vout][aout]`);
      const out = path.join(workDir, 'reel.mp4');
      await run([...args, '-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
      const key = `reels/${scope.replace(':', '-')}/${weekStart}-${Date.now()}.mp4`;
      await putFile(key, out);
      const old = await one(`SELECT media_key FROM reels WHERE scope = $1 AND week_start = $2`, [scope, weekStart]);
      await q(`UPDATE reels SET status = 'ready', media_key = $3, video_ids = $4, error = NULL WHERE scope = $1 AND week_start = $2`, [scope, weekStart, key, JSON.stringify(vids.map((v) => v.id))]);
      if (old?.media_key) await removeFile(old.media_key);
    } catch (e) {
      console.error('Reel failed', e.message);
      await q(`UPDATE reels SET status = 'failed', error = $3 WHERE scope = $1 AND week_start = $2`, [scope, weekStart, String(e.message).slice(0, 300)]);
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true });
    }
  });
}

/** After a restart, pick up anything that was mid-render. */
export async function resumeJobs() {
  const stuck = await many(`SELECT id FROM videos WHERE status = 'rendering' OR status = 'uploaded'`);
  for (const s of stuck) renderVideo(s.id);
}
