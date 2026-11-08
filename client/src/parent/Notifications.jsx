import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Phone notifications for grown-ups (Web Push).
// iPhone: works from iOS 16.4 once the grown-ups' page is added to the Home Screen.
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export default function NotificationsCard() {
  const [info, setInfo] = useState(null);
  const [onHere, setOnHere] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  const load = async () => {
    setInfo(await api.get('/api/parent/notifications'));
    if (supported) setOnHere(Boolean(await currentSub().catch(() => null)));
  };
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setMsg(isIOS() ? 'Notifications are blocked. Turn them on in iPhone Settings → Notifications → Dibbly Dobs Grown-ups, then try again.' : 'Notifications are blocked. Allow them for this site in your browser settings, then try again.');
        return;
      }
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) });
      await api.post('/api/parent/notifications/subscribe', { subscription: sub.toJSON(), origin: location.origin });
      await load();
      const t = await api.post('/api/parent/notifications/test');
      setMsg(t.sent ? 'All set! A test notification is on its way.' : 'Turned on. If no test notification arrives, try turning it off and on again.');
    } catch (e) {
      setMsg(e.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await currentSub();
      if (sub) {
        await api.post('/api/parent/notifications/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      await load();
      setMsg('Turned off on this phone.');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    const t = await api.post('/api/parent/notifications/test');
    setMsg(t.sent ? 'Test sent ✓' : 'No phones are set up yet.');
  };

  const setPref = async (key, value) => {
    const out = await api.put('/api/parent/notifications/prefs', { ...info.prefs, [key]: value });
    setInfo({ ...info, prefs: out.prefs });
  };

  if (!info) return null;
  return (
    <div className="p-card">
      <h2>🔔 Phone notifications</h2>
      <p className="muted">Get a notification on your phone when something needs approving, or when a child earns a Dibbly Dob.</p>

      {!supported && isIOS() && !isStandalone() ? (
        <div className="notify-steps">
          <b>On iPhone, first add this page to your Home Screen:</b>
          <ol>
            <li>Open this page in <b>Safari</b> on your phone.</li>
            <li>
              Tap the <b>Share</b> button (the square with an arrow), then <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
            <li>
              Open <b>Dobs Grown-ups</b> from your Home Screen, log in, and come back to <b>Settings</b>.
            </li>
          </ol>
          <div className="muted small">Needs iOS 16.4 or newer.</div>
        </div>
      ) : !supported ? (
        <div className="muted">This browser can’t show notifications. On iPhone use Safari; on Android use Chrome.</div>
      ) : onHere ? (
        <div className="p-actions">
          <span className="saved">On for this phone ✓</span>
          <button className="btn" onClick={test} disabled={busy}>
            Send a test
          </button>
          <button className="btn" onClick={turnOff} disabled={busy}>
            Turn off on this phone
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={turnOn} disabled={busy}>
          {busy ? 'Setting up…' : 'Turn on notifications on this phone'}
        </button>
      )}

      {msg && <div className="notice">{msg}</div>}

      <div className="field-label">Notify me when…</div>
      <label className="consent">
        <input type="checkbox" checked={info.prefs.approvals} onChange={(e) => setPref('approvals', e.target.checked)} />
        <span>a video or story needs approving</span>
      </label>
      <label className="consent">
        <input type="checkbox" checked={info.prefs.dobs} onChange={(e) => setPref('dobs', e.target.checked)} />
        <span>a child earns a Dibbly Dob</span>
      </label>
      <div className="muted small">
        {info.phones === 1 ? '1 phone is' : `${info.phones} phones are`} set up. Each grown-up can turn it on on their own phone.
      </div>
    </div>
  );
}
