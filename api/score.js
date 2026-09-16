// /api/score.js
// 헬로 대부도 오락실의 랭킹 이벤트 시스템 — 헬로런/헬로버드 공용.
// 요청 body/query의 "game" 값으로 어느 게임의 점수인지 구분한다 (예: "hello_run" | "hello_bird").
//
// 소규모 커피쿠폰 이벤트 기준이라 부정행위 방지는 최소한만 한다:
//   - meters(또는 게임별 점수)가 상식적인 범위를 벗어나면 거부
//   - 닉네임/연락처는 그대로 저장 (당첨자 연락용, 별도 인증 없음)
//
// 필요한 환경변수 (Vercel 프로젝트에 Vercel KV를 연결하면 자동으로 채워짐):
//   KV_REST_API_URL, KV_REST_API_TOKEN
//   (Vercel 대시보드 > Storage > Create Database > KV 로 생성 후 프로젝트에 연결하면 끝)
//
// 저장 구조: Redis Sorted Set  "score:{game}"  { score: meters, member: JSON(entry) }
//   member에 JSON 전체를 넣는 이유: 같은 점수를 여러 명이 낼 수 있어서 member는 유니크해야 함.

import { kv } from '@vercel/kv';

const MAX_METERS = 5000; // 터무니없는 점수 최소 검증용 상한선(헬로런 기준, 필요시 게임별로 분리 가능)
const ALLOWED_GAMES = ['hello_run', 'hello_bird'];

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return handleSubmit(req, res);
  }
  if (req.method === 'GET') {
    return handleLeaderboard(req, res);
  }
  res.status(405).json({ error: 'method not allowed' });
}

async function handleSubmit(req, res) {
  try {
    const { game, nickname, contact, meters } = req.body || {};

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

    const entry = {
      nickname: nick,
      contact: cont,
      meters: score,
      submittedAt: new Date().toISOString(),
    };
    // member는 유니크해야 하므로 임의 id를 붙인다 (같은 사람이 여러 번 등록해도 각각 별도 기록으로 남음 —
    // 필요하면 여기서 "닉네임+연락처로 이전 기록보다 낮으면 무시" 같은 로직을 추가할 수 있음)
    const memberId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await kv.zadd(`score:${game}`, { score, member: memberId });
    await kv.hset(`score:${game}:entries`, { [memberId]: JSON.stringify(entry) });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}

async function handleLeaderboard(req, res) {
  try {
    const game = req.query.game;
    const limit = Math.min(50, Number(req.query.limit) || 10);
    if (!ALLOWED_GAMES.includes(game)) {
      return res.status(400).json({ error: 'invalid game' });
    }

    // 점수 높은 순 상위 N명의 memberId를 가져온다
    const topMembers = await kv.zrange(`score:${game}`, 0, limit - 1, { rev: true, withScores: true });
    // topMembers: [member1, score1, member2, score2, ...] 형태로 반환됨(@vercel/kv 버전에 따라 다를 수 있어 방어적으로 처리)
    const memberIds = [];
    for (let i = 0; i < topMembers.length; i += 2) memberIds.push(topMembers[i]);

    const entriesRaw = memberIds.length ? await kv.hmget(`score:${game}:entries`, ...memberIds) : [];
    const leaderboard = memberIds.map((id, i) => {
      const raw = entriesRaw[i];
      const parsed = raw ? JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)) : {};
      return {
        rank: i + 1,
        nickname: parsed.nickname,
        meters: parsed.meters,
        // 연락처(contact)는 관리자용 데이터라 공개 리더보드 응답에는 포함하지 않는다
      };
    });

    return res.status(200).json({ game, leaderboard });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
