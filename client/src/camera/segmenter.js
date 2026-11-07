// Cuts the child out of the camera picture so a backdrop can go behind them.
// Uses Google's MediaPipe selfie segmenter, which runs entirely on the iPad: the
// camera image never leaves the device. Loaded only when a backdrop is chosen.
const VERSION = '0.10.14';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let loading = null;

async function load() {
  const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const make = (delegate) =>
    vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  try {
    return await make('GPU');
  } catch {
    return make('CPU');
  }
}

export function getSegmenter() {
  loading ||= load().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/**
 * Keeps an up-to-date alpha mask canvas for the latest video frame.
 * mask.canvas is small (model resolution); draw it scaled with smoothing for soft edges.
 */
export function createMasker() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let image = null;
  let lastTs = -1;
  let ready = false;
  return {
    canvas,
    get ready() {
      return ready;
    },
    update(segmenter, video, ts) {
      if (!segmenter || video.readyState < 2 || ts <= lastTs) return;
      lastTs = ts;
      segmenter.segmentForVideo(video, ts, (result) => {
        const m = result.confidenceMasks?.[0];
        if (!m) return;
        const w = m.width;
        const h = m.height;
        const data = m.getAsFloat32Array();
        if (canvas.width !== w || canvas.height !== h || !image) {
          canvas.width = w;
          canvas.height = h;
          image = ctx.createImageData(w, h);
        }
        const px = image.data;
        for (let i = 0; i < data.length; i++) {
          // Soft threshold: crisp body, gentle edges.
          const a = Math.min(1, Math.max(0, (data[i] - 0.25) / 0.45));
          const o = i * 4;
          px[o] = 255;
          px[o + 1] = 255;
          px[o + 2] = 255;
          px[o + 3] = a * 255;
        }
        ctx.putImageData(image, 0, 0);
        ready = true;
        m.close?.();
      });
    },
  };
}
