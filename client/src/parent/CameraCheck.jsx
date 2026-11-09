import React, { useRef, useState } from 'react';

// Grown-ups → Settings → Camera check. Run it ON the iPad that has the problem:
// it tests that device and says, in plain English, what's stopping the camera.

function iosVersion() {
  const m = navigator.userAgent.match(/OS (\d+)[_.](\d+)/);
  if (m) return `${m[1]}.${m[2]}`;
  // iPads in "desktop" mode report as a Mac; Safari's version is the best clue.
  const v = navigator.userAgent.match(/Version\/(\d+)\.(\d+)/);
  return v ? `${v[1]}.${v[2]} (Safari)` : 'unknown';
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'Timeout' })), ms))]);

export default function CameraCheck() {
  const [rows, setRows] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);

  const run = async () => {
    setBusy(true);
    setVerdict(null);
    const out = [];
    const add = (ok, label, detail = '') => out.push({ ok, label, detail });
    const ios = iosVersion();
    const major = parseInt(ios, 10) || 0;
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    add(major === 0 || major >= 15, `iPad software (iOS) ${ios}`, major && major < 15 ? 'This is old: update in Settings → General → Software Update.' : '');
    add(true, standalone ? 'Opened from a Home Screen icon' : 'Opened in Safari');
    add(window.isSecureContext, 'Secure connection (https)');
    const hasGum = Boolean(navigator.mediaDevices?.getUserMedia);
    add(hasGum, 'Camera access available to websites');
    add(typeof MediaRecorder !== 'undefined', 'Video recording supported', typeof MediaRecorder === 'undefined' ? 'Needs iOS 14.3 or newer.' : '');
    let perm = 'unknown';
    try {
      perm = (await navigator.permissions?.query({ name: 'camera' }))?.state || 'unknown';
    } catch {
      /* not supported on this iPad */
    }
    add(perm !== 'denied', `Camera permission for this website: ${perm}`, perm === 'denied' ? 'Blocked for this website.' : '');
    let cams = null;
    try {
      cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length;
    } catch {
      /* ignore */
    }
    add(cams !== 0, `Cameras the iPad lets this website see: ${cams ?? 'unknown'}`, cams === 0 ? 'None: usually Screen Time is blocking the camera.' : '');

    let camErr = null;
    let picture = false;
    if (hasGum) {
      try {
        const stream = await withTimeout(navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }), 20000);
        const v = videoRef.current;
        v.srcObject = stream;
        v.muted = true;
        await v.play().catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
        picture = v.readyState >= 2 && v.videoWidth > 0;
        add(true, 'Camera turned on');
        add(picture, picture ? `Picture showing (${v.videoWidth}×${v.videoHeight})` : 'Camera on, but no picture', picture ? '' : 'Low Power Mode can stop the picture: turn it off in Settings → Battery.');
        setTimeout(() => stream.getTracks().forEach((t) => t.stop()), 2500);
      } catch (e) {
        camErr = e;
        add(false, `Camera didn’t turn on: ${e.name || 'error'}`, e.message || '');
      }
      try {
        const mic = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }), 20000);
        mic.getTracks().forEach((t) => t.stop());
        add(true, 'Microphone works');
      } catch (e) {
        add(false, `Microphone didn’t turn on: ${e.name || 'error'}`, 'Settings → Safari → Microphone → Allow.');
      }
    }

    // The plain-English answer.
    let v;
    if (!window.isSecureContext) v = 'The app must be opened with https:// (the address Replit gives you).';
    else if (!hasGum) v = standalone ? 'This iPad can’t use the camera from a Home Screen icon. Open Dibbly Dobs in Safari instead, or update the iPad.' : 'This browser can’t use the camera. Open Dibbly Dobs in Safari, and update the iPad (Settings → General → Software Update).';
    else if (camErr?.name === 'NotAllowedError' || camErr?.name === 'SecurityError' || perm === 'denied')
      v = 'The camera is blocked for this iPad or website. Check three places: (1) Settings → Screen Time → Content & Privacy Restrictions → Allowed Apps → Camera must be ON. (2) In Safari, tap “aA” in the address bar → Website Settings → Camera → Allow. (3) Settings → Safari → Camera → Allow.';
    else if (camErr?.name === 'NotFoundError' || cams === 0) v = 'The iPad isn’t letting websites see its camera. This is almost always Screen Time: Settings → Screen Time → Content & Privacy Restrictions → Allowed Apps → switch Camera ON.';
    else if (camErr?.name === 'NotReadableError' || camErr?.name === 'AbortError') v = 'Another app is using the camera. Close FaceTime, Camera or video apps (swipe them away), then try again. If it still fails, restart the iPad.';
    else if (camErr?.name === 'Timeout') v = 'The iPad never answered the camera request. Restart the iPad, then open Dibbly Dobs in Safari and try again.';
    else if (camErr) v = `The camera failed (${camErr.name}). Restart the iPad and try again; if it still fails, send a screenshot of this check.`;
    else if (!picture) v = 'The camera turns on but no picture comes through. Turn off Low Power Mode (Settings → Battery) and try again.';
    else if (major && major < 15) v = 'The camera works here, but this iPad’s software is old, so filming may not. Update it in Settings → General → Software Update.';
    else v = 'The camera works on this iPad ✓ If it still won’t start in Star Studio, fully close Safari (swipe it away) and open Dibbly Dobs again so the newest version loads.';
    setRows(out);
    setVerdict(v);
    setBusy(false);
  };

  return (
    <div className="p-card">
      <h2>🎥 Camera check</h2>
      <p className="muted">Camera not coming on? Open this page on that iPad and run the check. It tells you exactly what to change.</p>
      <div className="p-actions">
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'Checking… (tap Allow if asked)' : '🎥 Run camera check'}
        </button>
      </div>
      <video ref={videoRef} className="camcheck-video" muted playsInline style={{ display: rows?.some((r) => r.label.startsWith('Picture showing')) ? 'block' : 'none' }} />
      {verdict && <div className={`notice ${/✓/.test(verdict) ? 'ok' : ''}`}>{verdict}</div>}
      {rows && (
        <ul className="camcheck">
          {rows.map((r, i) => (
            <li key={i}>
              <span>{r.ok ? '✅' : '❌'}</span> {r.label}
              {r.detail && <div className="muted small">{r.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
