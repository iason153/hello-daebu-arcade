// /api/kakao-upload.js
// 카카오톡 공유 B안(진짜 개인화된 결과 카드가 카톡 미리보기에 뜨게 하기)을 위해,
// 클라이언트가 캔버스로 만든 결과 카드 이미지를 잠깐 업로드해서 공개 URL을 돌려준다.
// 이 URL을 Kakao.Share.sendDefault의 imageUrl로 넣으면 실제 결과가 담긴 카드가
// 카톡 링크 미리보기에 표시된다.
//
// Vercel Blob을 사용 — 공개 URL을 즉시 내려주고, 별도 만료 기능이 없는 대신
// api/cleanup-cards.js를 하루 한 번 크론으로 돌려서 24시간 지난 카드 이미지를 정리한다
// (vercel.json의 crons 설정 참고). 유지보수 부담을 최소화하기 위한 구조.
//
// 필요한 환경변수: Vercel 프로젝트에 Vercel Blob을 연결하면 BLOB_READ_WRITE_TOKEN이 자동으로 채워짐
//   (Vercel 대시보드 > Storage > Create Database > Blob 으로 생성 후 프로젝트에 연결)

import { put } from '@vercel/blob';

// @vercel/blob은 내부적으로 Node.js 전용 모듈을 사용해서 Edge 런타임과 호환이
// 안 된다. 웹 표준 Request/Response 방식으로 함수를 짜면 Vercel이 이걸 Edge
// Function으로 잘못 판단하는 경우가 있어서, score.js와 같은 전통적인
// (req, res) 방식으로 작성해 Node.js 런타임임을 명확히 한다.

function base64ToUint8Array(base64) {
  const commaIdx = base64.indexOf(',');
  const raw = commaIdx >= 0 ? base64.slice(commaIdx + 1) : base64;
  return Buffer.from(raw, 'base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 required' });
    }

    const bytes = base64ToUint8Array(imageBase64);
    // 5MB 넘는 이미지는 거부 — 공유 카드 용도라 이 정도면 충분히 여유 있음
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'image too large' });
    }

    const filename = `kakao-cards/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const blob = await put(filename, bytes, {
      access: 'public',
      contentType: 'image/png',
      addRandomSuffix: false,
    });

    return res.status(200).json({ url: blob.url });
  } catch (e) {
    return res.status(500).json({ error: 'upload failed' });
  }
}
