// /api/score.js
// 헬로 대부도 오락실의 랭킹 이벤트 시스템 — 헬로런/헬로버드 공용.
// 요청 body/query의 "game" 값으로 어느 게임의 점수인지 구분한다 (예: "hello_run" | "hello_bird").
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

import { kv } from '@vercel/kv';

const MAX_METERS = 5000; // 터무니없는 점수 최소 검증용 상한선(헬로런 기준, 필요시 게임별로 분리 가능)
const ALLOWED_GAMES = ['hello_run', 'hello_bird', 'hello_tower'];

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

    // id를 넣어두는 이유: 같은 닉네임/연락처/기록으로 정확히 똑같은 밀리초에 두 번 등록하는
    // 극히 드문 경우에도 member 문자열이 겹치지 않도록(겹치면 sorted set에서 한 건으로 합쳐짐)
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      nickname: nick,
      contact: cont,
      meters: score,
      submittedAt: new Date().toISOString(),
    };
    await kv.zadd(`score:${game}`, { score, member: JSON.stringify(entry) });

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

    // 점수 높은 순 상위 N개 member를 가져온다. 각 member 자체가 그 기록의 전체 정보(JSON)라
    // 이후 별도로 다른 자료구조와 짜맞출 필요가 없다.
    const topMembers = await kv.zrange(`score:${game}`, 0, limit - 1, { rev: true });

    const leaderboard = [];
    topMembers.forEach((raw) => {
      // @vercel/kv 클라이언트가 JSON처럼 보이는 값을 자동으로 파싱해서 돌려주는 경우와,
      // 문자열 그대로 돌려주는 경우가 둘 다 있을 수 있어 방어적으로 처리한다.
      // 예전 버전(디버깅 전) 코드로 등록된 낡은 기록이 섞여 있어도(member가 JSON이 아닌 경우)
      // 그 한 건만 건너뛰고 나머지 리더보드는 정상적으로 보여준다.
      try {
        const entry = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (entry && entry.nickname) {
          leaderboard.push({ rank: leaderboard.length + 1, nickname: entry.nickname, meters: entry.meters });
        }
      } catch (e) {
        // 낡은/손상된 기록은 조용히 건너뜀
      }
    });

    return res.status(200).json({ game, leaderboard });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
