// Streams private videos. Two locks: a short-lived signed link AND a session that is
// allowed to see it (own family, or a crew-mate after the premiere).
import express from 'express';
import { one } from '../db.js';
import { verifySigned } from '../media/signed.js';
import { localCopy } from '../media/storage.js';
import { canView } from '../lib/videos.js';

const TYPES = { raw: null, final: 'video/mp4', thumb: 'image/jpeg', reel: 'video/mp4' };

export function mediaRouter() {
  const r = express.Router();

  r.get('/media/:kind/:id', async (req, res, next) => {
    try {
      const { kind, id } = req.params;
      if (!(kind in TYPES) || !verifySigned(kind, id, req.query.exp, req.query.sig)) return res.status(403).end();
      if (!req.session) return res.status(401).end();
      let key;
      let type = TYPES[kind];
      if (kind === 'reel') {
        const [scope, week] = id.split('|');
        const crewId = Number(scope.replace('c:', ''));
        const member = await one(
          `SELECT 1 FROM crew_members m JOIN kids k ON k.id = m.kid_id WHERE m.crew_id = $1 AND k.family_id = $2`,
          [crewId, req.session.familyId]
        );
        if (!member) return res.status(403).end();
        key = (await one(`SELECT media_key FROM reels WHERE scope = $1 AND week_start = $2 AND status = 'ready'`, [scope, week]))?.media_key;
      } else {
        const v = await one(`SELECT * FROM videos WHERE id = $1`, [id]);
        if (!v) return res.status(404).end();
        if (kind === 'raw') {
          // Raw takes are only for the child's own family.
          const own = await one(`SELECT 1 FROM kids WHERE id = $1 AND family_id = $2`, [v.kid_id, req.session.familyId]);
          if (!own) return res.status(403).end();
          type = v.raw_mime || 'video/mp4';
        } else if (!(await canView(req.session, v))) return res.status(403).end();
        key = { raw: v.raw_key, final: v.final_key, thumb: v.thumb_key }[kind];
      }
      if (!key) return res.status(404).end();
      const file = await localCopy(key);
      res.set({ 'Cache-Control': 'private, max-age=600', 'Content-Type': type });
      res.sendFile(file, { acceptRanges: true }); // Range support: Safari needs it to play video
    } catch (e) {
      next(e);
    }
  });

  return r;
}
