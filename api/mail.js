// /api/mail.js — 오락실 안에서 회원끼리 도전장 보내기(📮) — 대표 결정 10/12
//
//   GET  ?box=1            → 내가 받은 도전장(최근 30통, 기한 지난 것 빼고) + 안 읽은 수   (로그인)
//   GET  ?recent=1         → 최근 상대(결투장 상대, 내 성을 털었던 사람) 10명            (로그인)
//   GET  ?find=닉네임      → 닉네임으로 회원 찾기(앞부분·포함 일치, 10명)                  (로그인)
//   POST { action:'send', to, kind, ref }   → 도전장 보내기
//        kind: 'duel'(헬로 스윙·먼치 도전장 번호) · 'ghost'(헬로 캐슬 신들의 성 도전장 번호) · 'castle'(내 성 — ref 없이 내 성)
//   POST { action:'seen' }                  → 받은 도전장을 모두 읽음으로
//   POST { action:'block', wid } / { action:'unblock', wid } → 이 사람 도전장 안 받기 / 다시 받기
//
// 아이들도 쓰므로: 로그인 회원끼리만 · 한마디는 각 도전장의 정해진 문구만(자유 입력 없음) · 하루 10통, 같은 사람에게 하루 3통 · 차단 가능.
// (오락실 안의 이동 링크라 UTM 꼬리표는 붙이지 않는다 — 휴대폰 알림으로 들어올 때만 push 꼬리표)
// 받은 사람에게는 오락실 첫 화면·게임 첫 화면의 📮 카드와 휴대폰 알림(켜 둔 사람만)으로 알린다.
//
// KV
//   dmail:{wid} (목록)            → 받은 도전장 30통(14일)  { id, kind, game, ref, from, fw, title, sub, link, exp, at }
//   dmailseen:{wid}               → 마지막으로 읽은 시각
//   dmsend:{wid}:{날짜}           → 그날 보낸 수(2일)
//   dmpair:{보낸}:{받는}:{날짜}   → 그날 같은 사람에게 보낸 수(2일)
//   dmblock:{wid} (해시)          → 내가 막은 사람 wid → 막은 시각

import { kv } from '@vercel/kv';
import { randomBytes } from 'crypto';
import { sessionUser, SITE_ORIGIN } from './_session.js';
import { sendPush } from './_push.js';
import { PHRASES } from './duel.js';

const parse = (v) => { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const kstDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
const WID_RE = /^[a-z0-9]{4,16}$/, ID_RE = /^[a-z0-9]{8}$/;
const PER_DAY = 10, PER_PAIR = 3, KEEP = 30, TTL = 14 * 24 * 3600;
const GAMES = {
  hello_swing: { name: '헬로 스윙', path: '/games/hello-swing/', unit: 'm' },
  hello_munch: { name: '헬로 먼치', path: '/games/hello-munch/', unit: 'm' },
  hello_castle: { name: '헬로 캐슬', path: '/games/hello-castle/', unit: '줄' },
};
function newId() { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'[b[i] % 31]; return s; }
async function memberOf(wid) { const r = parse(await kv.hget('members', wid)); return r ? { wid, nick: String(r.nick || '') } : null; }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const me = await sessionUser(req).catch(() => null);
    if (!me) return res.status(401).json({ error: 'login required' });
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'send') return await send(res, me, b);
      if (b.action === 'seen') { await kv.set(`dmailseen:${me.wid}`, Date.now(), { ex: TTL }); return res.status(200).json({ ok: true }); }
      if (b.action === 'block' || b.action === 'unblock') {
        const w = String(b.wid || ''); if (!WID_RE.test(w) || w === me.wid) return res.status(400).json({ error: 'bad wid' });
        if (b.action === 'block') await kv.hset(`dmblock:${me.wid}`, { [w]: Date.now() }); else await kv.hdel(`dmblock:${me.wid}`, w);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'unknown action' });
    }
    const q = req.query || {};
    if (q.box) {
      const [list, seen, blk] = await Promise.all([kv.lrange(`dmail:${me.wid}`, 0, KEEP - 1), kv.get(`dmailseen:${me.wid}`), kv.hgetall(`dmblock:${me.wid}`)]);
      const now = Date.now(), B = blk || {};
      const items = (list || []).map(parse).filter((x) => x && x.exp > now && !B[x.fw]);
      return res.status(200).json({ items, unread: items.filter((x) => x.at > Number(seen || 0)).length, seen: Number(seen || 0) });
    }
    if (q.recent) return await recent(res, me);
    if (q.find != null) return await find(res, me, String(q.find));
    return res.status(400).json({ error: 'bad request' });
  } catch (e) {
    console.error('[mail]', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
}

// 최근 상대: 결투장 대결 상대 + 내 성 소식(털었거나 막힌 사람) — 겹치면 한 번만, 최신 순 10명
async function recent(res, me) {
  const [duels, raids] = await Promise.all([kv.lrange(`arenam:${me.wid}`, 0, 49), kv.lrange(`cinbox:${me.wid}`, 0, 29)]);
  const seen = new Set(), out = [];
  const rows = [];
  (duels || []).map(parse).filter(Boolean).forEach((x) => rows.push({ wid: x.o, nick: x.on, at: x.at, why: '결투장 상대' }));
  (raids || []).map(parse).filter(Boolean).forEach((x) => rows.push({ wid: x.bw, nick: x.by, at: x.at, why: x.r === 'l' ? '내 성을 턴 사람' : '내 성에 왔던 사람' }));
  rows.sort((a, b) => b.at - a.at).forEach((r) => { if (!r.wid || r.wid === me.wid || seen.has(r.wid) || out.length >= 10) return; seen.add(r.wid); out.push(r); });
  // 닉네임은 지금 이름으로
  const cur = await Promise.all(out.map((r) => memberOf(r.wid)));
  return res.status(200).json({ list: out.filter((r, i) => cur[i]).map((r, i) => ({ wid: r.wid, nick: cur[i].nick || r.nick, why: r.why })) });
}

async function find(res, me, q) {
  q = q.replace(/\s+/g, '').slice(0, 12);
  if (!q) return res.status(200).json({ list: [] });
  const all = (await kv.hgetall('members')) || {};
  const hit = [];
  for (const [wid, raw] of Object.entries(all)) {
    if (wid === me.wid) continue;
    const r = parse(raw); const n = r && String(r.nick || ''); if (!n) continue;
    const nn = n.replace(/\s+/g, '');
    if (nn.includes(q)) hit.push({ wid, nick: n, exact: nn === q ? 0 : nn.startsWith(q) ? 1 : 2 });
  }
  hit.sort((a, b) => a.exact - b.exact || a.nick.localeCompare(b.nick));
  return res.status(200).json({ list: hit.slice(0, 10).map(({ wid, nick }) => ({ wid, nick })) });
}

async function send(res, me, b) {
  const to = String(b.to || ''), kind = String(b.kind || ''), ref = String(b.ref || '').toLowerCase();
  if (!WID_RE.test(to) || to === me.wid) return res.status(400).json({ error: '받는 사람을 다시 골라 주세요' });
  const target = await memberOf(to);
  if (!target) return res.status(404).json({ error: '없는 회원이에요' });
  if (await kv.hget(`dmblock:${to}`, me.wid)) return res.status(403).json({ error: target.nick + '님은 지금 도전장을 받지 않아요' });
  // 도전장 내용은 서버가 직접 만든다(기기가 보낸 제목·주소는 믿지 않음)
  let item = null; const now = Date.now();
  if (kind === 'duel') {
    const d = ID_RE.test(ref) ? parse(await kv.get(`duel:${ref}`)) : null;
    if (!d || !GAMES[d.game]) return res.status(404).json({ error: '도전장을 찾을 수 없어요. 다시 만들어 주세요' });
    if (d.wid !== me.wid) return res.status(403).json({ error: '내가 만든 도전장만 보낼 수 있어요' });
    const G = GAMES[d.game];
    item = { kind, game: d.game, ref, title: `${G.name} 도전장 · ${d.dist}${G.unit}`, sub: PHRASES[d.msg] || '', link: `${G.path}?duel=${ref}`, exp: d.exp };
  } else if (kind === 'ghost') {
    const g = ID_RE.test(ref) ? parse(await kv.get(`cghost:${ref}`)) : null;
    if (!g) return res.status(404).json({ error: '도전장을 찾을 수 없어요. 다시 만들어 주세요' });
    if (g.wid !== me.wid) return res.status(403).json({ error: '내가 만든 도전장만 보낼 수 있어요' });
    item = { kind, game: 'hello_castle', ref, title: `오늘의 신들의 성 도전장 · ${g.row}줄${g.summit ? ' 🏛' : ''}`, sub: '오늘 자정까지 · 내 유령을 넘어 봐!', link: `/games/hello-castle/?ghost=${ref}`, exp: g.exp };
  } else if (kind === 'castle') {
    const c = parse(await kv.get(`castle:${me.wid}`));
    if (!c || !c.pub) return res.status(404).json({ error: '아직 공개된 내 성이 없어요' });
    item = { kind, game: 'hello_castle', ref: me.wid, title: `${me.nick}님의 성 · ${c.pub.len}줄 — 깨 봐!`, sub: '들어올 테면 와 봐', link: `/games/hello-castle/?castle=${me.wid}`, exp: now + 7 * 864e5 };
  } else return res.status(400).json({ error: 'bad kind' });
  // 하루 제한(보내는 사람 기준 10통, 같은 사람에게 3통)
  const day = kstDay(), dk = `dmsend:${me.wid}:${day}`, pk = `dmpair:${me.wid}:${to}:${day}`;
  const [nd, np] = await Promise.all([kv.get(dk), kv.get(pk)]);
  if (Number(nd || 0) >= PER_DAY) return res.status(429).json({ error: `오늘은 도전장을 ${PER_DAY}통까지 보낼 수 있어요. 내일 또 보내요!` });
  if (Number(np || 0) >= PER_PAIR) return res.status(429).json({ error: `${target.nick}님에게는 오늘 ${PER_PAIR}통까지 보낼 수 있어요` });
  const a = await kv.incr(dk), p = await kv.incr(pk);
  if (a === 1) await kv.expire(dk, 2 * 24 * 3600); if (p === 1) await kv.expire(pk, 2 * 24 * 3600);
  Object.assign(item, { id: newId(), from: me.nick, fw: me.wid, at: now });
  await kv.lpush(`dmail:${to}`, JSON.stringify(item)); await kv.ltrim(`dmail:${to}`, 0, KEEP - 1); await kv.expire(`dmail:${to}`, TTL);
  await sendPush('w:' + to, { title: `📮 ${me.nick}님의 도전장!`, body: item.title + (item.sub ? ' · "' + item.sub + '"' : ''), url: item.link + '&utm_source=push&utm_medium=notification&utm_campaign=mail_challenge', tag: 'mail-' + item.id }).catch(() => 0);
  return res.status(200).json({ ok: true, to: target.nick, left: PER_DAY - a });
}
