// /api/_push.js — 휴대폰 알림(웹 푸시) 공용 부품. 외부 서비스 없이 표준 웹 푸시(VAPID)만 쓴다.
// (파일명이 _ 로 시작해서 주소로 노출되지 않는다)
//
// 필요한 환경변수(Vercel): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — 없으면 알림 기능만 조용히 꺼진다.
//   (선택) VAPID_SUBJECT  기본 https://daebugame.com
//
// KV: push:w:{wid} / push:c:{cid} → [구독, …] 기기 5대까지, 180일
// 알림이 가는 곳 = 결과 소식함과 같은 열쇠(회원 w:, 로그인 안 한 기기 c:)

import webpush from 'web-push';
import { kv } from '@vercel/kv';

let ready = null;
export function pushReady() {
  if (ready !== null) return ready;
  const pub = process.env.VAPID_PUBLIC_KEY || '', pri = process.env.VAPID_PRIVATE_KEY || '';
  if (!pub || !pri) return (ready = false);
  try { webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://daebugame.com', pub, pri); ready = true; } catch (e) { ready = false; }
  return ready;
}
export const publicKey = () => process.env.VAPID_PUBLIC_KEY || '';

const parse = (v) => { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
export async function getSubs(key) { const v = parse(await kv.get(`push:${key}`)); return Array.isArray(v) ? v : []; }
export async function saveSub(key, sub) {
  const list = (await getSubs(key)).filter((s) => s.endpoint !== sub.endpoint);
  list.unshift({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: Date.now() });
  await kv.set(`push:${key}`, list.slice(0, 5), { ex: 180 * 24 * 3600 });
}
export async function removeSub(key, endpoint) {
  const all = await getSubs(key), list = all.filter((s) => s.endpoint !== endpoint);
  if (list.length === all.length) return;
  if (list.length) await kv.set(`push:${key}`, list, { ex: 180 * 24 * 3600 }); else await kv.del(`push:${key}`);
}
// 로그인 전 기기(c:)에 켜 둔 알림을 회원(w:)으로 옮긴다 — 로그인 뒤 이어 붙이기(claim) 때
export async function moveSubs(fromKey, toKey) {
  const list = await getSubs(fromKey);
  for (const s of list) await saveSub(toKey, s);
  if (list.length) await kv.del(`push:${fromKey}`);
}
// payload: { title, body, url, tag } — 4KB 아래로 짧게
export async function sendPush(key, payload) {
  if (!pushReady()) return 0;
  let sent = 0;
  for (const s of await getSubs(key)) {
    try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'normal' }); sent++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await removeSub(key, s.endpoint).catch(() => {}); }
  }
  return sent;
}
