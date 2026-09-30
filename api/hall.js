// /api/hall.js
// 헬로 신전(명예의 전당) 데이터 — GET /api/hall
//
// 새 저장소를 따로 만들지 않고, 랭킹(score:{game})에 이미 쌓인 기록에서 매번 계산한다.
// 그래서 관리자 페이지에서 부정 기록을 지우면 명예의 전당에서도 자동으로 사라진다.
//
// 게임마다 돌려주는 것:
//   champion   : 현재 왕좌의 주인 — 최고 기록에 "가장 최근에" 오른 사람
//                (2026-09-28 규칙 변경: 같은 기록이면 나중에 오른 사람이 왕좌를 빼앗는다.
//                 먼저 있던 사람이 내려오면서 다시 도전하게 만들려는 의도)
//   reign      : 지금 왕좌가 몇 대째인지(왕좌가 주인을 바꾼 총 횟수)
//   ascended   : 헬로타워 100층(엔딩)을 달성한 모든 사람 — 닉네임별 "첫" 달성 시각 순(제1호, 제2호…)
//   podium     : 닉네임 중복을 뺀 상위 3명(1명이 여러 번 올린 기록은 가장 좋은 것 하나만)
//   history    : 왕좌가 주인을 바꾼 순간들(신기록이거나 최고 기록과 같은 기록) — 최근 것부터 최대 10개
//   players    : 기록을 올린 서로 다른 닉네임 수
//
// 연락처는 절대 내보내지 않는다(닉네임·기록·시각만).

import { kv } from '@vercel/kv';

const GAMES = {
  hello_tower: { maxScore: 100 }, // 100층 = 천국 엔딩
  hello_run: {},
  hello_bird: {},
  hello_munch: { maxScore: 500 }, // 500m = 신들의 나라 도착
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
  if (!entries.length) return { champion: null, reign: 0, ascended: [], podium: [], history: [], players: 0 };

  // 닉네임별 최고 기록(같은 기록을 여러 번 세웠다면 가장 최근 것 — 왕좌 규칙과 맞춤)
  const best = new Map();
  // 닉네임별 최고 기록을 "처음" 세운 시각(제1호·제2호 순서용)
  const firstAtBest = new Map();
  for (const e of entries) {
    const cur = best.get(e.nickname);
    if (!cur || e.score > cur.score || (e.score === cur.score && timeOf(e) > timeOf(cur))) best.set(e.nickname, e);
  }
  for (const e of entries) {
    const b = best.get(e.nickname);
    if (e.score !== b.score) continue;
    const f = firstAtBest.get(e.nickname);
    if (!f || timeOf(e) < timeOf(f)) firstAtBest.set(e.nickname, e);
  }
  // 순위: 기록 높은 순, 같으면 최근에 오른 사람이 위
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || timeOf(b) - timeOf(a));

  // 왕좌의 역사: 시간 순으로 훑으며, 최고 기록 "이상"을 세운 순간 왕좌가 넘어간다.
  // 이미 왕좌에 있는 사람이 같은 기록을 또 세운 건 주인이 바뀐 게 아니므로 건너뜀.
  const chrono = [...entries].sort((a, b) => timeOf(a) - timeOf(b));
  const history = [];
  let top = -Infinity, holder = null;
  for (const e of chrono) {
    if (e.score > top || (e.score === top && e.nickname !== holder)) {
      top = e.score;
      holder = e.nickname;
      history.push({ ...e, reign: history.length + 1 });
    }
  }
  const current = history[history.length - 1];

  const ascended = cfg.maxScore
    ? ranked.filter((e) => e.score >= cfg.maxScore)
        .map((e) => firstAtBest.get(e.nickname))
        .sort((a, b) => timeOf(a) - timeOf(b))
    : [];

  return {
    champion: current,          // { nickname, score, at, reign }
    reign: history.length,
    ascended,
    podium: ranked.slice(0, 3),
    history: history.slice().reverse().slice(0, 10),
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
