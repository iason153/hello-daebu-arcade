// /api/cleanup-cards.js
// vercel.json의 crons 설정으로 하루 한 번 자동 호출되어, kakao-upload.js가 올린
// 카드 이미지 중 24시간이 지난 것들을 Vercel Blob에서 삭제한다.
// (카카오톡 공유 B안의 유지보수 부담을 최소화하기 위한 최소한의 정리 로직)

import { list, del } from '@vercel/blob';

// @vercel/blob의 list/del은 내부적으로 Node.js 전용 모듈(stream 등)을 사용해서
// Edge 런타임에서는 빌드/배포가 실패한다. 웹 표준 Request/Response 방식으로
// 짜면 Vercel이 Edge Function으로 잘못 판단하는 경우가 있어서, score.js와
// 같은 전통적인 (req, res) 방식으로 작성해 Node.js 런타임임을 명확히 한다.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  // Vercel Cron이 아닌 외부에서의 호출을 막기 위한 간단한 가드.
  // (Vercel이 크론 호출 시 자동으로 붙이는 Authorization 헤더를 확인)
  const authHeader = req.headers['authorization'];
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('unauthorized');
  }

  try {
    let cursor;
    let deleted = 0;
    const now = Date.now();
    do {
      const { blobs, cursor: nextCursor } = await list({ prefix: 'kakao-cards/', cursor, limit: 1000, token: process.env.BLOBPUBLIC_READ_WRITE_TOKEN });
      const stale = blobs.filter((b) => now - new Date(b.uploadedAt).getTime() > ONE_DAY_MS);
      if (stale.length) {
        await del(stale.map((b) => b.url), { token: process.env.BLOBPUBLIC_READ_WRITE_TOKEN });
        deleted += stale.length;
      }
      cursor = nextCursor;
    } while (cursor);

    return res.status(200).json({ ok: true, deleted });
  } catch (e) {
    return res.status(500).json({ error: 'cleanup failed' });
  }
}
