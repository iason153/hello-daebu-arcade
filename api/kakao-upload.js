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

export const config = { runtime: 'edge' };

function base64ToUint8Array(base64) {
  // "data:image/png;base64,...." 형태로 오는 경우 헤더를 떼어낸다
  const commaIdx = base64.indexOf(',');
  const raw = commaIdx >= 0 ? base64.slice(commaIdx + 1) : base64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return new Response(JSON.stringify({ error: 'imageBase64 required' }), { status: 400 });
    }

    const bytes = base64ToUint8Array(imageBase64);
    // 5MB 넘는 이미지는 거부 — 공유 카드 용도라 이 정도면 충분히 여유 있음
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'image too large' }), { status: 400 });
    }

    const filename = `kakao-cards/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const blob = await put(filename, bytes, {
      access: 'public',
      contentType: 'image/png',
      addRandomSuffix: false,
    });

    return new Response(JSON.stringify({ url: blob.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'upload failed' }), { status: 500 });
  }
}
