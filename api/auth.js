// /api/auth.js — 카카오 로그인(회원가입 겸용)과 로그인 상태 확인
//
//   GET  /api/auth?action=login&next=/cardbook.html  → 카카오 로그인 화면으로 보냄
//   GET  /api/auth?code=…&state=…                    → 카카오가 돌려보내는 주소(Redirect URI). 회원 만들고 쿠키 발급
//   GET  /api/auth                                   → 지금 로그인 상태 { loggedIn, wid, nick }
//   POST /api/auth  { action: 'logout' }             → 로그아웃
//   POST /api/auth  { action: 'withdraw' }           → 탈퇴(회원·카드첩 데이터 삭제)
//
// 필요한 환경변수(Vercel)
//   KAKAO_REST_KEY       카카오 개발자 사이트 > 내 애플리케이션 > 앱 키 > REST API 키
//   KAKAO_CLIENT_SECRET  (선택) 카카오 로그인 > 보안 > Client Secret 을 켰다면 그 값
//   SESSION_SECRET       아무도 모르는 긴 무작위 문자열(로그인 쿠키 서명용)
//   SITE_ORIGIN          (선택) 기본 https://daebugame.com
// 카카오에 등록할 Redirect URI:  https://daebugame.com/api/auth
//
// 카카오에서 받는 정보는 회원번호와 닉네임뿐(동의항목: 닉네임). 이메일·전화번호는 받지 않는다.

import { kv } from '@vercel/kv';
import { randomBytes } from 'crypto';
import {
  SITE_ORIGIN, authReady, parseCookies, sessionKid, sessionUser, getUser, upsertUser,
  makeSessionCookie, clearSessionCookie, getCards, getNotes, countNewNotes,
} from './_session.js';

const REDIRECT_URI = `${SITE_ORIGIN}/api/auth`;

// 로그인 뒤 돌아갈 주소 — 우리 사이트 안의 경로만 허용(다른 사이트로 보내는 악용 방지)
function safeNext(n) {
  const s = String(n || '');
  return /^\/[A-Za-z0-9_\-./?=&%]*$/.test(s) && !s.startsWith('//') ? s : '/cardbook.html';
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const action = (req.body || {}).action;
      if (action === 'logout') {
        res.setHeader('Set-Cookie', clearSessionCookie());
        return res.status(200).json({ ok: true });
      }
      if (action === 'withdraw') {
        const kid = sessionKid(req);
        if (!kid) return res.status(401).json({ error: 'login required' });
        const u = await getUser(kid);
        if (u) {
          await kv.del(`cards:${u.wid}`);
          await kv.del(`wid:${u.wid}`);
          await kv.del(`visits:${u.wid}`);
          await kv.del(`notes:${u.wid}`);
          await kv.hdel('members', u.wid);
          await kv.del(`user:${kid}`);
        }
        res.setHeader('Set-Cookie', clearSessionCookie());
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: 'unknown action' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

    const q = req.query || {};

    // (1) 로그인 시작
    if (q.action === 'login') {
      if (!authReady()) return res.status(503).send('로그인 기능을 준비 중이에요.');
      const state = randomBytes(12).toString('base64url');
      res.setHeader('Set-Cookie', [
        `hs_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
        `hs_next=${encodeURIComponent(safeNext(q.next))}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      ]);
      const url = 'https://kauth.kakao.com/oauth/authorize?response_type=code'
        + `&client_id=${encodeURIComponent(process.env.KAKAO_REST_KEY)}`
        + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
        + `&state=${state}`;
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, url);
    }

    // (2) 카카오에서 돌아옴
    if (q.code || q.error) {
      const cookies = parseCookies(req);
      const next = safeNext(decodeURIComponent(cookies.hs_next || ''));
      const clear = ['hs_state=; Path=/; Max-Age=0', 'hs_next=; Path=/; Max-Age=0'];
      const fail = (why) => {
        res.setHeader('Set-Cookie', clear);
        return res.redirect(302, `${next}${next.includes('?') ? '&' : '?'}login=${why}`);
      };
      if (q.error) return fail('cancel');
      if (!authReady()) return fail('notready');
      if (!q.state || q.state !== cookies.hs_state) return fail('state');

      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KAKAO_REST_KEY,
        redirect_uri: REDIRECT_URI,
        code: String(q.code),
      });
      if (process.env.KAKAO_CLIENT_SECRET) form.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
      const tokRes = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: form.toString(),
      });
      const tok = await tokRes.json().catch(() => ({}));
      if (!tokRes.ok || !tok.access_token) return fail('token');

      const meRes = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const me = await meRes.json().catch(() => ({}));
      if (!meRes.ok || !me.id) return fail('profile');
      const kakaoNick = (me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname)
        || (me.properties && me.properties.nickname) || '';

      await upsertUser(String(me.id), kakaoNick);
      res.setHeader('Set-Cookie', [makeSessionCookie(String(me.id)), ...clear]);
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `${next}${next.includes('?') ? '&' : '?'}login=ok`);
    }

    // (3) 로그인 상태 확인
    res.setHeader('Cache-Control', 'no-store');
    const u = await sessionUser(req);
    if (!u) return res.status(200).json({ loggedIn: false, ready: authReady() });
    const cards = await getCards(u.wid);
    // 내 카드첩에 새로 달린 방명록 수(마지막으로 내 카드첩을 연 뒤에 남이 쓴 글)
    let newNotes = 0;
    try { newNotes = countNewNotes(await getNotes(u.wid), u.wid, u.notesSeenAt || u.createdAt); } catch (e) { /* 무시 */ }
    return res.status(200).json({ loggedIn: true, ready: true, wid: u.wid, nick: u.nick, cardCount: Object.keys(cards).length, newNotes });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
