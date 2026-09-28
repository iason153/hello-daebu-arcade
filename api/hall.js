// /api/hall.js
// 헬로 신전(명예의 전당) 데이터 — GET /api/hall
//
// 새 저장소를 따로 만들지 않고, 랭킹(score:{game})에 이미 쌓인 기록에서 매번 계산한다.
// 그래서 관리자 페이지에서 부정 기록을 지우면 명예의 전당에서도 자동으로 사라진다.
//
// 게임마다 돌려주는 것:
//   champion   : 현재 왕좌의 주인 — 최고 기록 중 "가장 먼저" 세운 사람(동점이면 선착순)
//   ascended   : 헬로타워 100층(엔딩)을 달성한 모든 사람 — 닉네임별 첫 달성 시각 순
//   podium     : 닉네임 중복을 뺀 상위 3명(1명이 여러 번 올린 기록은 가장 좋은 것 하나만)
//   history    : 왕좌가 바뀐 순간들(신기록이 나올 때마다) — 최근 것부터 최대 10개
//   players    : 기록을 올린 서로 다른 닉네임 수
//
// 연락처는 절대 내보내지 않는다(닉네임·기록·시각만).

import { kv } from '@vercel/kv';

const GAMES = {
  hello_tower: { maxScore: 100 }, // 100층 = 천국 엔딩
  hello_run: {},
  hello_bird: {},
};

function parseEntries(raws) {
  const out = [];
  for (const raw of raws) {
    try {
      const e = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (e && e.nickname && Number.isFinite(Number(e.meters))) {
        out.push({ nickname: String(e.nickname), score: Number(e.meters), at: e.submittedAt || null });
      }
    } catch (err) { /* 낡은 기록은 건너뜀 */ }
  }
  return out;
}

// 시각이 없는 옛 기록은 가장 오래된 것으로 취급
const timeOf = (e) => (e.at ? Date.parse(e.at) || 0 : 0);

function summarize(entries, cfg) {
  if (!entries.length) return { champion: null, ascended: [], podium: [], history: [], players: 0 };

  // 닉네임별 최고 기록(동점이면 먼저 세운 것)
  const best = new Map();
  for (const e of entries) {
    const cur = best.get(e.nickname);
    if (!cur || e.score > cur.score || (e.score === cur.score && timeOf(e) < timeOf(cur))) best.set(e.nickname, e);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || timeOf(a) - timeOf(b));

  // 왕좌의 역사: 시간 순으로 훑으며 최고 기록이 "넘어선" 순간만 남김
  const chrono = [...entries].sort((a, b) => timeOf(a) - timeOf(b));
  const history = [];
  let top = -Infinity;
  for (const e of chrono) {
    if (e.score > top) {
      top = e.score;
      history.push(e);
    }
  }

  const ascended = cfg.maxScore
    ? ranked.filter((e) => e.score >= cfg.maxScore).sort((a, b) => timeOf(a) - timeOf(b))
    : [];

  return {
    champion: ranked[0],
    ascended,
    podium: ranked.slice(0, 3),
    history: history.reverse().slice(0, 10),
    players: best.size,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const result = {};
    for (const [game, cfg] of Object.entries(GAMES)) {
      const raws = await kv.zrange(`score:${game}`, 0, -1);
      result[game] = summarize(parseEntries(raws), cfg);
    }
    // 1분 캐시 — 신전은 실시간일 필요가 없고, 방문이 몰려도 DB 호출이 늘지 않게
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ games: result, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
