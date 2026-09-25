// /api/config.js
// 헬로 대부도 오락실 — 게임별 "운영 설정" 저장소 (관리자 페이지 /admin.html 에서 수정).
//
// 게임 코드 안에 박혀 있던 값(예: 헬로타워 말풍선 문구) 중 코드 수정·재배포 없이
// 바꾸고 싶은 것들을 여기로 뺀다. 게임은 시작할 때 GET으로 받아서 덮어쓰고,
// 못 받으면(네트워크 오류, 설정이 아직 없음) 코드에 적힌 기본값으로 그냥 돈다.
//
//   GET  /api/config?game=hello_tower          → { game, config }   (누구나, 게임이 호출)
//   POST /api/config  {game, config}           → 저장                (관리자만, 헤더 x-admin-secret)
//
// 저장 구조: Redis 문자열 키 "config:{game}" 에 JSON 한 덩어리.
//
// 새 설정 항목을 늘리려면 아래 SCHEMAS에 그 게임의 항목 검증 함수만 추가하면 된다.
// (예: 헬로런/헬로버드 애드벌룬 광고판 → ads 항목 추가 예정)

import { kv } from '@vercel/kv';
import { timingSafeEqual } from 'crypto';

function isAdminRequest(req) {
  const expected = process.env.ADMIN_SECRET || '';
  const given = String(req.headers['x-admin-secret'] || '');
  if (!expected || !given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 게임별로 "받아줄 항목"과 검증 규칙. 여기 없는 항목은 저장 시 조용히 버린다.
const SCHEMAS = {
  hello_tower: {
    // 착지 때 블록이 띄우는 말풍선 문구
    whispers(v) {
      if (!Array.isArray(v)) throw new Error('whispers는 목록이어야 해요');
      const lines = v.map((x) => String(x).trim()).filter(Boolean);
      if (lines.length === 0) throw new Error('말풍선 문구가 최소 1개는 있어야 해요');
      if (lines.length > 60) throw new Error('말풍선 문구는 60개까지 저장할 수 있어요');
      const tooLong = lines.find((x) => x.length > 30);
      if (tooLong) throw new Error(`30자를 넘는 문구가 있어요: "${tooLong}"`);
      return lines;
    },
    // 착지할 때 말풍선이 뜰 확률 (0~1)
    whisperChance(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('말풍선 확률은 0~100% 사이여야 해요');
      return n;
    },
  },
  hello_run: {},
  hello_bird: {},
};

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const game = req.query.game;
      if (!SCHEMAS[game]) return res.status(400).json({ error: 'invalid game' });
      const config = (await kv.get(`config:${game}`)) || {};
      // 게임이 켜질 때마다 호출되니 CDN에 30초 캐시(수정 후 최대 30초쯤 뒤 반영).
      // 관리자 페이지는 ?fresh=1 로 캐시 없이 받아간다.
      res.setHeader('Cache-Control', req.query.fresh ? 'no-store' : 's-maxage=30, stale-while-revalidate=300');
      return res.status(200).json({ game, config });
    }

    if (req.method === 'POST') {
      if (!isAdminRequest(req)) return res.status(403).json({ error: 'forbidden' });
      const { game, config } = req.body || {};
      const schema = SCHEMAS[game];
      if (!schema) return res.status(400).json({ error: 'invalid game' });
      if (!config || typeof config !== 'object') return res.status(400).json({ error: 'config required' });

      const current = (await kv.get(`config:${game}`)) || {};
      const next = { ...current };
      for (const key of Object.keys(config)) {
        if (!schema[key]) continue; // 모르는 항목은 무시
        if (config[key] === null) { delete next[key]; continue; } // null = 기본값으로 되돌리기
        try {
          next[key] = schema[key](config[key]);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      next.updatedAt = new Date().toISOString();
      await kv.set(`config:${game}`, next);
      return res.status(200).json({ ok: true, game, config: next });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
