// /api/sea-room.js  (주소: /sea/room — vercel.json 에서 연결)
// 방아머리 바닷가의 "함께 있는 공간": 접속자 수, 같이 앉기 방, 말풍선 대화, 모래 글씨 공유.
//
// 실시간 서버 없이 "몇 초마다 묻기"로 동작한다. 저장소는 오락실이 이미 쓰는 Upstash Redis(@vercel/kv).
// 호출을 아끼는 원칙:
//   - 접속 신호(beat) 한 번 = 보통 명령 2~3개. 전체 인원 집계는 5초에 한 번만 다시 계산해 모두가 같이 쓴다.
//   - 방 자료(말·글씨)는 방에 들어가 있을 때만, 바뀐 것만 내려준다.
//   - 사람이 많아지면 다음 신호 간격(next)을 늘려 보낸다.
//
// 저장 구조 (모두 만료가 걸려 있어 저절로 정리된다)
//   sea:p            ZSET  member = "sid|room" , score = 마지막 신호 시각(ms)
//   sea:cnt          STR   집계 결과 JSON, 5초
//   sea:r:{id}:m     HASH  sid -> {"n":이름,"j":들어온 시각,"s":마지막 신호}
//   sea:r:{id}:msg   LIST  말 {"i","s","n","x","t"} 최근 40개, 24시간
//   sea:r:{id}:st    LIST  모래 글씨 {"i","s","p":[[x,y],...],"e":지워지는 시각} 최근 40개
//   sea:r:{id}:v     STR   글씨 버전(숫자)
//   sea:g            LIST  모든 사람의 최근 글씨(다른 사람에겐 흐린 흔적으로만) 30개
//   sea:gv           STR   전체 글씨 버전
//   sea:ex           ZSET  member = 글씨 id, score = 지워지는 시각 → "지금 N개의 글씨가 바다로" 계산
import { kv } from '@vercel/kv';
import { randomBytes } from 'crypto';

const ALIVE_MS = 35000;
const AWAY_MS = 10 * 60e3;
const ROOM_TTL = 86400;
const ROOM_MAX = 6;
const P = (x) => { if (x == null) return null; if (typeof x === 'object') return x; try { return JSON.parse(x); } catch (e) { return null; } };
const idOk = (s, n) => typeof s === 'string' && new RegExp('^[A-Za-z0-9]{' + n + '}$').test(s);
const cleanText = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

async function counts(now) {
  const cached = P(await kv.get('sea:cnt'));
  if (cached && now - cached.at < 5000) return cached;
  await kv.zremrangebyscore('sea:p', 0, now - ALIVE_MS);
  const rows = await kv.zrange('sea:p', 0, -1, { withScores: true });
  // rows = [member, score, member, score, ...]
  const bySid = new Map();
  for (let i = 0; i < rows.length; i += 2) {
    const [sid, room] = String(rows[i]).split('|');
    const sc = Number(rows[i + 1]);
    const prev = bySid.get(sid);
    if (!prev || prev.sc < sc) bySid.set(sid, { room: room || '', sc });
  }
  const rooms = new Map();
  let solo = 0;
  for (const [, v] of bySid) {
    if (!v.room) { solo++; continue; }
    rooms.set(v.room, (rooms.get(v.room) || 0) + 1);
  }
  let couple = 0, family = 0;
  const roomSizes = {};
  for (const [r, n] of rooms) {
    roomSizes[r] = n;
    if (n === 1) solo++; else if (n === 2) couple++; else family++;
  }
  const exNow = await kv.zcount('sea:ex', now - 20 * 60e3, now + 10 * 60e3);
  if (Math.random() < 0.05) await kv.zremrangebyscore('sea:ex', 0, now - 3600e3);
  const out = { at: now, total: bySid.size, solo, couple, family, roomSizes, erasing: exNow };
  await kv.set('sea:cnt', JSON.stringify(out), { ex: 6 });
  return out;
}

function nextInterval(total, inRoom, roomN) {
  if (inRoom && roomN > 1) return total > 3000 ? 8000 : 3000;
  if (total > 3000) return 60000;
  if (total > 500) return 30000;
  return 15000;
}

async function roomState(room, sid, now, q) {
  const key = 'sea:r:' + room;
  const raw = await kv.hgetall(key + ':m');
  if (!raw || !raw[sid]) return { gone: true };
  const me = P(raw[sid]) || {};
  me.s = now;
  await kv.hset(key + ':m', { [sid]: JSON.stringify(me) });
  const members = Object.entries(raw)
    .map(([s, v]) => Object.assign({ sid: s }, P(v) || {}))
    // 신호가 끊겨도 10분 동안은 "잠깐 자리 비움"으로 자리를 남겨 둔다(직접 나가기를 누르면 바로 빠진다)
    .filter((m) => m.sid === sid || now - (m.s || 0) < AWAY_MS)
    .sort((a, b) => (a.j || 0) - (b.j || 0))
    .map((m) => ({ sid: m.sid, n: m.n || '친구', on: m.sid === sid || now - (m.s || 0) < ALIVE_MS }));
  const since = Number(q.since) || 0;
  const msgs = (await kv.lrange(key + ':msg', -40, -1)).map(P).filter((m) => m && m.t > since);
  const v = Number(await kv.get(key + ':v')) || 0;
  let strokes;
  if (String(v) !== String(q.sv || '')) strokes = (await kv.lrange(key + ':st', 0, -1)).map(P).filter((s) => s && s.e > now);
  return { members, msgs, sv: v, strokes };
}

async function globalTraces(q, now) {
  const gv = Number(await kv.get('sea:gv')) || 0;
  if (String(gv) === String(q.gv || '')) return { gv };
  const g = (await kv.lrange('sea:g', 0, -1)).map(P).filter((s) => s && s.e > now).map((s) => ({ i: s.i, s: s.s, r: s.r, p: s.p, e: s.e }));
  return { gv, traces: g };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let q = req.body;
  if (typeof q === 'string') { try { q = JSON.parse(q); } catch (e) { q = {}; } }
  q = q || {};
  const now = Date.now();
  const sid = q.sid;
  if (!idOk(sid, 16)) return res.status(400).json({ ok: false, err: 'sid' });
  const room = idOk(q.room, 8) ? q.room : '';

  try {
    switch (q.act) {
      case 'beat': {
        await kv.zadd('sea:p', { score: now, member: sid + '|' + room });
        const c = await counts(now);
        const out = { ok: true, c: { total: c.total, solo: c.solo, couple: c.couple, family: c.family, erasing: c.erasing } };
        if (room) {
          const rs = await roomState(room, sid, now, q);
          if (rs.gone) out.gone = true; else Object.assign(out, rs);
          out.c.myRoom = c.roomSizes[room] || 0;
        }
        if (q.wantG) Object.assign(out, await globalTraces(q, now));
        out.next = nextInterval(c.total, !!room, out.members ? out.members.filter((m) => m.on).length : 0);
        return res.status(200).json(out);
      }
      case 'create': {
        const id = randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).padEnd(8, 'x');
        const key = 'sea:r:' + id;
        const name = cleanText(q.name, 10) || '나';
        await kv.hset(key + ':m', { [sid]: JSON.stringify({ n: name, j: now, s: now }) });
        await kv.expire(key + ':m', ROOM_TTL);
        await kv.zadd('sea:p', { score: now, member: sid + '|' + id });
        return res.status(200).json({ ok: true, room: id });
      }
      case 'join': {
        if (!room) return res.status(400).json({ ok: false, err: 'room' });
        const key = 'sea:r:' + room;
        const raw = await kv.hgetall(key + ':m');
        if (!raw) return res.status(200).json({ ok: false, err: 'gone' });
        if (!raw[sid]) {
          const live = Object.values(raw).map(P).filter((m) => m && now - (m.s || 0) < ROOM_TTL * 1000);
          if (live.length >= ROOM_MAX) return res.status(200).json({ ok: false, err: 'full' });
        }
        const name = cleanText(q.name, 10) || '친구';
        const prev = P(raw[sid]) || {};
        await kv.hset(key + ':m', { [sid]: JSON.stringify({ n: name, j: prev.j || now, s: now }) });
        await kv.expire(key + ':m', ROOM_TTL);
        await kv.zadd('sea:p', { score: now, member: sid + '|' + room });
        const host = Object.entries(raw).map(([s, v]) => Object.assign({ sid: s }, P(v) || {})).sort((a, b) => (a.j || 0) - (b.j || 0))[0];
        return res.status(200).json({ ok: true, room, host: host && host.sid !== sid ? host.n : null });
      }
      case 'leave': {
        if (room) await kv.hdel('sea:r:' + room + ':m', sid);
        return res.status(200).json({ ok: true });
      }
      case 'say': {
        if (!room) return res.status(400).json({ ok: false });
        const text = cleanText(q.text, 80);
        if (!text) return res.status(400).json({ ok: false, err: 'empty' });
        const key = 'sea:r:' + room;
        const meRaw = await kv.hget(key + ':m', sid);
        if (!meRaw) return res.status(403).json({ ok: false, err: 'notin' });
        const rl = await kv.incr('sea:rl:' + sid);
        if (rl === 1) await kv.expire('sea:rl:' + sid, 10);
        if (rl > 8) return res.status(429).json({ ok: false, err: 'slow' });
        const me = P(meRaw) || {};
        const msg = { i: randomBytes(4).toString('hex'), s: sid, n: me.n || '친구', x: text, t: now };
        await kv.rpush(key + ':msg', JSON.stringify(msg));
        await kv.ltrim(key + ':msg', -40, -1);
        await kv.expire(key + ':msg', ROOM_TTL);
        return res.status(200).json({ ok: true, msg });
      }
      case 'stroke': {
        const pts = Array.isArray(q.p) ? q.p.slice(0, 120).map((a) => [Math.round(+a[0]) || 0, Math.round(+a[1]) || 0]) : [];
        const e = Math.min(Number(q.e) || 0, now + 2 * 86400e3);
        if (pts.length < 2 || e <= now) return res.status(400).json({ ok: false });
        const rl = await kv.incr('sea:rls:' + sid);
        if (rl === 1) await kv.expire('sea:rls:' + sid, 10);
        if (rl > 30) return res.status(429).json({ ok: false, err: 'slow' });
        const st = { i: randomBytes(4).toString('hex'), s: sid, p: pts, e, r: room || '' };
        if (room) {
          const key = 'sea:r:' + room;
          await kv.rpush(key + ':st', JSON.stringify(st));
          await kv.ltrim(key + ':st', -40, -1);
          await kv.expire(key + ':st', ROOM_TTL);
          await kv.incr(key + ':v');
          await kv.expire(key + ':v', ROOM_TTL);
        }
        await kv.rpush('sea:g', JSON.stringify(st));
        await kv.ltrim('sea:g', -30, -1);
        await kv.incr('sea:gv');
        await kv.zadd('sea:ex', { score: e, member: st.i });
        return res.status(200).json({ ok: true, i: st.i });
      }
      case 'clear': {
        if (room) {
          const key = 'sea:r:' + room;
          const all = (await kv.lrange(key + ':st', 0, -1)).map(P).filter((x) => x && x.s !== sid);
          await kv.del(key + ':st');
          if (all.length) { await kv.rpush(key + ':st', ...all.map((x) => JSON.stringify(x))); await kv.expire(key + ':st', ROOM_TTL); }
          await kv.incr(key + ':v');
        }
        return res.status(200).json({ ok: true });
      }
      default:
        return res.status(400).json({ ok: false, err: 'act' });
    }
  } catch (e) {
    return res.status(200).json({ ok: false, err: 'store' });
  }
}
