// /api/push.js — 휴대폰 알림 켜기/끄기
//   GET                                   → { key: 알림용 공개 열쇠, ready }
//   POST { action:'subscribe', sub, cid } → 이 기기에서 알림 받기(회원이면 회원에게, 아니면 이 기기 번호에)
//   POST { action:'unsubscribe', endpoint, cid }
//   POST { action:'test', cid }           → "알림이 켜졌어요" 시험 알림 한 번
import { sessionUser } from './_session.js';
import { pushReady, publicKey, saveSub, removeSub, sendPush } from './_push.js';

const CID_RE = /^[a-z0-9]{8,24}$/;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.status(200).json({ key: publicKey(), ready: pushReady() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    const b = req.body || {};
    const me = await sessionUser(req).catch(() => null);
    const cid = CID_RE.test(String(b.cid || '')) ? String(b.cid) : '';
    const key = me ? `w:${me.wid}` : cid ? `c:${cid}` : '';
    if (!key) return res.status(400).json({ error: 'bad cid' });
    if (!pushReady()) return res.status(503).json({ error: '알림 기능이 아직 준비되지 않았어요' });
    if (b.action === 'subscribe') {
      const s = b.sub || {};
      if (!/^https:\/\/[^\s]{10,500}$/.test(String(s.endpoint || '')) || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string' || s.keys.p256dh.length > 200 || s.keys.auth.length > 100)
        return res.status(400).json({ error: 'bad subscription' });
      await saveSub(key, s);
      return res.status(200).json({ ok: true, member: !!me });
    }
    if (b.action === 'unsubscribe') { await removeSub(key, String(b.endpoint || '')); return res.status(200).json({ ok: true }); }
    if (b.action === 'test') {
      const n = await sendPush(key, { title: '🔔 헬로 대부도 오락실', body: '알림이 켜졌어요! 내 도전장의 승부가 나면 바로 알려 드릴게요.', url: '/', tag: 'push-test' });
      return res.status(200).json({ ok: true, sent: n });
    }
    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
