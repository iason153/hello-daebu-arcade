// /api/cleanup-cards.js
// vercel.json의 crons 설정으로 하루 한 번 자동 호출되어, kakao-upload.js가 올린
// 카드 이미지 중 24시간이 지난 것들을 Vercel Blob에서 삭제한다.
// (카카오톡 공유 B안의 유지보수 부담을 최소화하기 위한 최소한의 정리 로직)

import { list, del } from '@vercel/blob';

// @vercel/blob의 list/del은 내부적으로 Node.js 전용 모듈(stream 등)을 사용해서
// Edge 런타임에서는 빌드/배포가 실패한다 — 그래서 여기서는 edge 지정을 빼고
// 기본값인 Node.js 런타임으로 돌린다.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req) {
  // Vercel Cron이 아닌 외부에서의 호출을 막기 위한 간단한 가드.
  // (Vercel이 크론 호출 시 자동으로 붙이는 Authorization 헤더를 확인)
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    let cursor;
    let deleted = 0;
    const now = Date.now();
    do {
      const { blobs, cursor: nextCursor } = await list({ prefix: 'kakao-cards/', cursor, limit: 1000 });
      const stale = blobs.filter((b) => now - new Date(b.uploadedAt).getTime() > ONE_DAY_MS);
      if (stale.length) {
        await del(stale.map((b) => b.url));
        deleted += stale.length;
      }
      cursor = nextCursor;
    } while (cursor);

    return new Response(JSON.stringify({ ok: true, deleted }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'cleanup failed' }), { status: 500 });
  }
}
