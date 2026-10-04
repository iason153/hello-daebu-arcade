// /api/score.js
// 헬로 대부도 오락실의 랭킹 이벤트 시스템 — 헬로런/헬로버드/헬로타워 공용.
// 요청 body/query의 "game" 값으로 어느 게임의 점수인지 구분한다 (예: "hello_run" | "hello_bird" | "hello_tower" | "hello_munch").
//
// 소규모 커피쿠폰 이벤트 기준이라 부정행위 방지는 최소한만 한다:
//   - meters(또는 게임별 점수)가 상식적인 범위를 벗어나면 거부
//   - 닉네임/연락처는 그대로 저장 (당첨자 연락용, 별도 인증 없음)
//
// 필요한 환경변수 (Vercel 프로젝트에 Upstash Redis를 연결하면 자동으로 채워짐):
//   KV_REST_API_URL, KV_REST_API_TOKEN
//
// 저장 구조: Redis Sorted Set  "score:{game}"
//   score = meters(순위 정렬용 숫자), member = 닉네임/연락처/기록이 다 담긴 JSON 문자열 그 자체.
//   (처음엔 "sorted set에는 순위만, 상세정보는 별도 hash에" 이렇게 두 군데로 나눠서 저장했는데,
//    조회할 때 두 자료구조를 다시 짜맞추는 과정에서 값이 안 붙는 문제가 있었다. member 안에
//    필요한 정보를 통째로 넣으면 조회 시 매칭할 게 없어져서 이 문제 자체가 사라진다.)
//
// [관리자 기능 — 2026-09 보안 수정]
// 예전엔 비밀키가 이 파일에 그대로 적혀 있었고(퍼블릭 레포라 누구나 볼 수 있었음),
// GET URL 하나로 삭제가 됐다. 지금은:
//   - 비밀키는 Vercel 환경변수 ADMIN_SECRET 에서만 읽는다(코드엔 없음).
//     환경변수가 비어 있으면 관리자 기능 전체가 꺼진다(안전한 쪽으로 실패).
//   - 비밀키는 URL이 아니라 요청 헤더 x-admin-secret 으로 받는다(주소창/로그에 안 남게).
//   - 삭제는 POST {action:'delete'} 로만 된다(링크 미리보기·크롤러가 실수로 지우는 일 방지).
// 관리자 화면: /admin.html

import { kv } from '@vercel/kv';
import { timingSafeEqual, createHmac } from 'crypto';
import { sessionUser } from './_session.js';

const MAX_METERS = 5000; // 터무니없는 점수 최소 검증용 상한선(헬로런 기준, 필요시 게임별로 분리 가능)
const ALLOWED_GAMES = ['hello_run', 'hello_bird', 'hello_tower', 'hello_munch'];

// [기록 확인표 — 2026-10 조작 방지]
// 게임을 시작할 때 서버가 "확인표"를 내준다(게임 이름 + 시작 시각 + 서명). 기록을 등록할 때 이 표를 함께 보내면
// 서버는 ① 표가 진짜인지 ② 시작한 뒤 흐른 시간에 비해 기록이 가능한 값인지 를 본다.
// 통과하지 못한 기록은 버리지 않고 "확인 대기"(pending:{game})에 따로 모아 두며, 랭킹·왕좌·신전에는 나오지 않는다.
// 관리실에서 확인 후 올려 주거나 지울 수 있다. (정상 이용자가 통신 문제로 표를 못 받은 경우를 살리기 위함)
const TICKET_TTL = 6 * 3600 * 1000;
// 게임별 "1초에 올릴 수 있는 최대 기록"과 여유분 — 사람이 낼 수 있는 속도보다 넉넉하게 잡았다.
const PACE = {
  hello_munch: { perSec: 8, base: 30 },
  hello_tower: { perSec: 1.5, base: 5 },
  hello_run: { perSec: 15, base: 30 },
  hello_bird: { perSec: 3, base: 5 },
};
function ticketSig(game, t) {
  const secret = process.env.SESSION_SECRET || '';
  if (!secret) return '';
  return createHmac('sha256', secret).update(`ticket|${game}|${t}`).digest('hex').slice(0, 32);
}
function makeTicket(game) {
  const t = Date.now();
  const sig = ticketSig(game, t);
  return sig ? `${game}.${t}.${sig}` : '';
}
// → { ok, why, dur(초) }
function checkTicket(ticket, game, score) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 3) return { ok: false, why: '확인표 없음' };
  const [g, ts, sig] = parts;
  const t = Number(ts);
  const want = ticketSig(g, t);
  if (!want || g !== game || !Number.isFinite(t)) return { ok: false, why: '확인표 오류' };
  const a = Buffer.from(want), b = Buffer.from(String(sig));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, why: '확인표 오류' };
  const ms = Date.now() - t;
  const dur = Math.max(0, Math.round(ms / 1000));
  if (ms < 0 || ms > TICKET_TTL) return { ok: false, why: '확인표 만료', dur };
  const pace = PACE[game];
  if (score > pace.base + pace.perSec * (ms / 1000)) return { ok: false, why: `너무 빠름(${dur}초)`, dur };
  return { ok: true, dur };
}

function isAdminRequest(req) {
  const expected = process.env.ADMIN_SECRET || '';
  const given = String(req.headers['x-admin-secret'] || '');
  if (!expected || !given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 회원 닉네임 → 카드첩 주소. 같은 닉네임 회원이 둘 이상이면 누구 것인지 알 수 없으므로 합치지 않는다.
async function memberNickMap() {
  const map = new Map(), dup = new Set();
  try {
    const members = (await kv.hgetall('members')) || {};
    for (const [wid, r] of Object.entries(members)) {
      try { const o = typeof r === 'string' ? JSON.parse(r) : r; const n = o && o.nick; if (!n) continue; if (map.has(n)) dup.add(n); else map.set(n, wid); } catch (e) {}
    }
  } catch (e) {}
  for (const n of dup) map.delete(n);
  return map;
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const action = (req.body || {}).action;
    if (action === 'start') {
      const game = (req.body || {}).game;
      if (!ALLOWED_GAMES.includes(game)) return res.status(400).json({ error: 'invalid game' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, ticket: makeTicket(game) });
    }
    if (action === 'delete') {
      return handleDelete(req, res);
    }
    if (action === 'approve') {
      return handleApprove(req, res);
    }
    return handleSubmit(req, res);
  }
  if (req.method === 'GET') {
    return handleLeaderboard(req, res);
  }
  res.status(405).json({ error: 'method not allowed' });
}

async function handleSubmit(req, res) {
  try {
    const { game, nickname, contact, meters, ticket } = req.body || {};

    if (!ALLOWED_GAMES.includes(game)) {
      return res.status(400).json({ error: 'invalid game' });
    }
    const nick = String(nickname || '').trim().slice(0, 12);
    const cont = String(contact || '').trim().slice(0, 30);
    const score = Number(meters);

    if (!nick || !cont) {
      return res.status(400).json({ error: 'nickname/contact required' });
    }
    if (!Number.isFinite(score) || score <= 0 || score > MAX_METERS) {
      return res.status(400).json({ error: 'invalid score' });
    }

    // id를 넣어두는 이유: 같은 닉네임/연락처/기록으로 정확히 똑같은 밀리초에 두 번 등록하는
    // 극히 드문 경우에도 member 문자열이 겹치지 않도록(겹치면 sorted set에서 한 건으로 합쳐짐)
    // — 관리자가 특정 기록 하나만 콕 집어 삭제할 때도 이 id로 구분한다.
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      nickname: nick,
      contact: cont,
      meters: score,
      submittedAt: new Date().toISOString(),
    };
    // [올림포스 카드첩] 로그인한 회원이 등록한 기록이면 카드첩 주소를 함께 저장 —
    // 랭킹·신전에서 그 이름을 누르면 카드첩을 구경 갈 수 있게 한다(로그인 안 했으면 예전과 동일).
    try {
      const me = await sessionUser(req);
      if (me) entry.wid = me.wid;
    } catch (e) { /* 로그인 확인 실패해도 등록은 계속 */ }
    // [조작 방지] 확인표 검사 — 통과 못 하면 "확인 대기"로 따로 보관(랭킹·왕좌에 반영 안 됨)
    const chk = checkTicket(ticket, game, score);
    if (chk.dur != null) entry.dur = chk.dur;
    if (!chk.ok) {
      entry.why = chk.why;
      await kv.zadd(`pending:${game}`, { score, member: JSON.stringify(entry) });
      return res.status(200).json({ ok: true, saved: false, pending: true, throne: false });
    }
    // 왕좌 판정(명예의 전당 /hall-of-fame.html 규칙과 동일): 지금 최고 기록 "이상"이면
    // 이 기록이 새 왕좌의 주인이 된다(같은 기록이면 나중에 오른 사람이 왕좌를 가져감).
    // 게임 화면이 이 값을 보고 "왕좌에 올랐어요! 왕좌 카드 받기" 안내를 띄운다.
    // [도배 방지] 같은 사람이 이미 더 높은 기록을 올려 두었다면 새로 저장하지 않고 안내만 한다.
    // "같은 사람" = 같은 카드첩(로그인 회원) 또는 닉네임과 연락처가 모두 같은 경우.
    // (예전 기록은 지우지 않는다 — 신전의 왕좌 역사가 그 기록들로 계산되기 때문. 랭킹 화면에서만 최고 기록 하나로 보여 준다.)
    try {
      const all = await kv.zrange(`score:${game}`, 0, -1);
      let best = -Infinity;
      for (const raw of all) {
        try {
          const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!e) continue;
          const same = (entry.wid && e.wid === entry.wid) || (e.nickname === nick && e.contact === cont) || (entry.wid && !e.wid && e.nickname === nick);
          if (same && Number(e.meters) > best) best = Number(e.meters);
        } catch (err) { /* 손상된 기록은 건너뜀 */ }
      }
      if (score < best) return res.status(200).json({ ok: true, saved: false, lower: true, best, throne: false });
    } catch (e) { /* 확인 실패해도 등록은 계속 */ }

    let throne = false;
    try {
      const top = await kv.zrange(`score:${game}`, 0, 0, { rev: true, withScores: true });
      const topScore = top && top.length >= 2 ? Number(top[1]) : -Infinity;
      throne = score >= topScore;
    } catch (e) { /* 판정 실패해도 등록은 계속 */ }

    await kv.zadd(`score:${game}`, { score, member: JSON.stringify(entry) });

    return res.status(200).json({ ok: true, throne });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}

async function handleLeaderboard(req, res) {
  try {
    const game = req.query.game;
    const isAdmin = isAdminRequest(req);
    // 관리자는 최대 200건까지(부정 기록 찾기용), 일반 조회는 기존대로 50건 상한
    const limit = Math.min(isAdmin ? 200 : 50, Number(req.query.limit) || 10);
    if (!ALLOWED_GAMES.includes(game)) {
      return res.status(400).json({ error: 'invalid game' });
    }
    // 관리자 헤더가 맞으면 응답에 id·연락처·등록시각도 같이 담아줌(삭제·당첨자 연락용).
    // 일반 조회(게임 화면의 랭킹 페이지)는 예전과 동일하게 순위/닉네임/기록만 보임.

    // 점수 높은 순 상위 N개 member를 가져온다. 각 member 자체가 그 기록의 전체 정보(JSON)라
    // 이후 별도로 다른 자료구조와 짜맞출 필요가 없다.
    // 일반 조회는 "한 사람당 최고 기록 하나"만 보여 준다(도배 방지). 그래서 전체를 읽은 뒤 추린다.
    // 관리자 조회는 삭제·확인을 위해 모든 기록을 그대로 보여 준다.
    const wantPending = isAdmin && req.query.pending === '1';
    const topMembers = await kv.zrange(`${wantPending ? 'pending' : 'score'}:${game}`, 0, isAdmin ? limit - 1 : -1, { rev: true });
    const seen = new Set();
    // 로그인 전에 같은 닉네임으로 올린 기록은 그 회원의 기록으로 합친다(한 사람이 두 줄로 나오지 않게).
    const widOf = isAdmin ? new Map() : await memberNickMap();
    if (!isAdmin) topMembers.forEach((raw) => {
      try { const e = typeof raw === 'string' ? JSON.parse(raw) : raw; if (e && e.wid && e.nickname && !widOf.has(e.nickname)) widOf.set(e.nickname, e.wid); } catch (err) {}
    });

    const leaderboard = [];
    topMembers.forEach((raw) => {
      // @vercel/kv 클라이언트가 JSON처럼 보이는 값을 자동으로 파싱해서 돌려주는 경우와,
      // 문자열 그대로 돌려주는 경우가 둘 다 있을 수 있어 방어적으로 처리한다.
      // 예전 버전(디버깅 전) 코드로 등록된 낡은 기록이 섞여 있어도(member가 JSON이 아닌 경우)
      // 그 한 건만 건너뛰고 나머지 리더보드는 정상적으로 보여준다.
      try {
        const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (entry && entry.nickname) {
          if (!isAdmin) {
            if (leaderboard.length >= limit) return;
            if (!entry.wid && widOf.has(entry.nickname)) entry.wid = widOf.get(entry.nickname);
            const who = entry.wid ? 'w:' + entry.wid : 'n:' + entry.nickname; // 같은 회원 또는 같은 닉네임
            if (seen.has(who)) return; // 높은 순으로 읽으므로 처음 만난 것이 그 사람의 최고 기록
            seen.add(who);
          }
          const row = { rank: leaderboard.length + 1, nickname: entry.nickname, meters: entry.meters };
          if (entry.wid) row.wid = entry.wid;
          if (isAdmin) {
            row.id = entry.id;
            row.contact = entry.contact;
            row.submittedAt = entry.submittedAt;
            if (entry.dur != null) row.dur = entry.dur;
            if (entry.why) row.why = entry.why;
          }
          leaderboard.push(row);
        }
      } catch (e) {
        // 낡은/손상된 기록은 조용히 건너뜀
      }
    });

    const out = { game, leaderboard, isAdmin };
    if (isAdmin) { try { out.pendingCount = await kv.zcard(`pending:${game}`); } catch (e) { out.pendingCount = 0; } }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}

async function handleDelete(req, res) {
  try {
    const { game, id, pending } = req.body || {};
    const key = `${pending ? 'pending' : 'score'}:${game}`;
    if (!isAdminRequest(req)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (!ALLOWED_GAMES.includes(game)) {
      return res.status(400).json({ error: 'invalid game' });
    }
    if (!id) {
      return res.status(400).json({ error: 'id required' });
    }

    // sorted set은 member 문자열 전체로 지워야 해서, 전체를 훑어 id가 일치하는
    // member(원본 문자열 그대로)를 찾은 다음 그 문자열로 zrem 한다.
    const all = await kv.zrange(key, 0, -1);
    let removed = 0;
    for (const raw of all) {
      try {
        const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (entry && entry.id === id) {
          await kv.zrem(key, raw);
          removed++;
        }
      } catch (e) {
        // 손상된 기록은 건너뜀
      }
    }
    return res.status(200).json({ ok: true, removed });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}

// 확인 대기 기록을 관리자가 확인하고 랭킹에 올린다.
async function handleApprove(req, res) {
  try {
    const { game, id } = req.body || {};
    if (!isAdminRequest(req)) return res.status(403).json({ error: 'forbidden' });
    if (!ALLOWED_GAMES.includes(game)) return res.status(400).json({ error: 'invalid game' });
    if (!id) return res.status(400).json({ error: 'id required' });
    const all = await kv.zrange(`pending:${game}`, 0, -1);
    let moved = 0;
    for (const raw of all) {
      try {
        const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (entry && entry.id === id) {
          const kept = { ...entry, approved: true };
          delete kept.why;
          await kv.zadd(`score:${game}`, { score: Number(entry.meters), member: JSON.stringify(kept) });
          await kv.zrem(`pending:${game}`, raw);
          moved++;
        }
      } catch (e) { /* 손상된 기록은 건너뜀 */ }
    }
    return res.status(200).json({ ok: true, moved });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
