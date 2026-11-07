// Private file storage for videos.
// On Replit: Replit Object Storage (App Storage). Elsewhere: a local folder (.data/media).
// Files are never public; they are streamed through /api/media with signed, expiring links.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';

const LOCAL_DIR = path.join(process.cwd(), '.data', 'media');
const CACHE_DIR = path.join(os.tmpdir(), 'star-studio-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const safeKey = (key) => {
  if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes('..')) throw new Error(`Bad storage key: ${key}`);
  return key;
};

function localDriver() {
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const p = (key) => path.join(LOCAL_DIR, safeKey(key));
  return {
    kind: 'local',
    async put(key, file) {
      await fsp.mkdir(path.dirname(p(key)), { recursive: true });
      await fsp.copyFile(file, p(key));
    },
    async fetchTo(key, dest) {
      await fsp.copyFile(p(key), dest);
    },
    async remove(key) {
      await fsp.rm(p(key), { force: true });
    },
  };
}

async function replitDriver() {
  const { Client } = await import('@replit/object-storage');
  const client = new Client(process.env.OBJECT_STORAGE_BUCKET_ID ? { bucketId: process.env.OBJECT_STORAGE_BUCKET_ID } : undefined);
  const check = (r, what) => {
    if (!r.ok) throw new Error(`Object storage ${what} failed: ${r.error?.message || r.error}`);
    return r.value;
  };
  // Probe once so a missing bucket is reported at start-up, not mid-upload.
  check(await client.list({ prefix: 'probe/' }), 'list');
  return {
    kind: 'replit',
    async put(key, file) {
      check(await client.uploadFromFilename(safeKey(key), file), 'upload');
    },
    async fetchTo(key, dest) {
      check(await client.downloadToFilename(safeKey(key), dest), 'download');
    },
    async remove(key) {
      const r = await client.delete(safeKey(key));
      if (!r.ok && !String(r.error?.message || '').includes('No such object')) check(r, 'delete');
    },
  };
}

let driver = null;
export async function initStorage() {
  if (process.env.REPL_ID || process.env.OBJECT_STORAGE_BUCKET_ID) {
    try {
      driver = await replitDriver();
      console.log('📦 Videos: Replit Object Storage');
      return driver;
    } catch (e) {
      console.warn(`📦 Replit Object Storage not available (${e.message}). Using local disk; videos may be lost on redeploy.`);
    }
  }
  driver = localDriver();
  console.log('📦 Videos: local disk (.data/media)');
  return driver;
}

export const storageKind = () => driver?.kind || 'none';

export async function putFile(key, file) {
  await driver.put(key, file);
  // Keep a copy in the local cache so the first view is instant.
  await fsp.copyFile(file, cachePath(key)).catch(() => {});
}

export async function removeFile(key) {
  if (!key) return;
  await driver.remove(key).catch((e) => console.warn('remove failed', key, e.message));
  await fsp.rm(cachePath(key), { force: true }).catch(() => {});
}

const cachePath = (key) => path.join(CACHE_DIR, safeKey(key).replace(/\//g, '__'));

const inflight = new Map();
/** Local file path for a stored object (downloaded into a temp cache when needed). */
export async function localCopy(key) {
  const dest = cachePath(key);
  if (fs.existsSync(dest)) return dest;
  if (!inflight.has(key)) {
    inflight.set(
      key,
      (async () => {
        const tmp = `${dest}.part-${process.pid}`;
        await driver.fetchTo(key, tmp);
        await fsp.rename(tmp, dest);
        return dest;
      })().finally(() => inflight.delete(key))
    );
  }
  return inflight.get(key);
}

/** Stream an HTTP request body into a temp file (with a size limit). */
export async function receiveUpload(req, maxBytes) {
  const file = path.join(os.tmpdir(), `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBytes) req.destroy(new Error('too big'));
  });
  await pipeline(req, fs.createWriteStream(file));
  return { file, size };
}

export const tmpPath = (name) => path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
