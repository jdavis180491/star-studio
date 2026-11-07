// Tiny in-memory rate limiter (per IP) to protect paid AI/voice calls.
export function rateLimit({ perMinute = 30 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < 60000);
    if (list.length >= perMinute) return res.status(429).json({ error: 'Slow down a bit!' });
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    next();
  };
}
