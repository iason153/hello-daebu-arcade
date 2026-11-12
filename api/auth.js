// /api/auth.js — 카카오 로그인(회원가입 겸용)과 로그인 상태 확인
//
//   GET  /api/auth?action=login&next=/cardbook.html  → 카카오 로그인 화면으로 보냄
//   GET  /api/auth?code=…&state=…                    → 카카오가 돌려보내는 주소(Redirect URI). 회원 만들고 쿠키 발급
//   GET  /api/auth                                   → 지금 로그인 상태 { loggedIn, wid, nick }
//   POST /api/auth  { action: 'logout' }             → 로그아웃
//   POST /api/auth  { action: 'withdraw' }           → 탈퇴(회원·카드첩 데이터 삭제)
//   GET  /api/auth?fails=1  (헤더 x-admin-secret)       → 최근 로그인 실패 기록 100건(관리자)
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
  makeSessionCookie, clearSessionCookie, getCards, getNotes, countNewNotes, isAdminRequest,
} from './_session.js';

const REDIRECT_URI = `${SITE_ORIGIN}/api/auth`;

// 로그인 뒤 돌아갈 주소 — 우리 사이트 안의 경로만 허용(다른 사이트로 보내는 악용 방지)
function safeNext(n) {
  const s = String(n || '');
  return /^\/[A-Za-z0-9_\-./?=&%]*$/.test(s) && !s.startsWith('//') ? s : '/cardbook.html';
}

// (11/12) 로그인 실패를 눈에 보이게 + 기록으로 남긴다.
// 제보: 초등학생 계정이 보호자 카톡 인증을 여러 번 해도 로그인이 안 됨. 전에는 실패해도 화면에 아무 말이 없고 기록도 없어서
// 무엇 때문인지 알 수 없었다. 이제 실패하면 이유를 적은 안내 화면을 보여 주고, 이유를 최근 100건까지 남긴다.
const FAIL_TEXT = {
  state: ['로그인 확인 시간이 지났거나, 다른 브라우저(앱)에서 돌아왔어요.', '인증에 시간이 오래 걸렸거나 카카오톡·인증 앱을 다녀오면서 처음 열었던 브라우저가 아닌 곳으로 돌아오면 생겨요. 처음 게임을 연 브라우저에서 한 번만 더 눌러 주세요.'],
  token: ['카카오에서 로그인 확인을 받지 못했어요.', '잠시 뒤 다시 시도해 주세요. 계속되면 아래 문의로 알려 주세요.'],
  profile: ['카카오에서 회원 정보를 받지 못했어요.', '잠시 뒤 다시 시도해 주세요. 계속되면 아래 문의로 알려 주세요.'],
  notready: ['로그인 기능을 준비 중이에요.', '잠시 뒤 다시 시도해 주세요.'],
  kakao: ['카카오에서 로그인을 끝내지 못했어요.', '어린이(만 14세 미만) 계정은 카카오에서 보호자 동의가 끝나야 로그인돼요. 카카오톡 앱에서 보호자 동의가 완료됐는지 확인한 뒤 다시 시도해 주세요.'],
};
const esc = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function logFail(req, why, extra) {
  try {
    const row = { t: new Date().toISOString(), why, err: String((extra && extra.err) || '').slice(0, 80), desc: String((extra && extra.desc) || '').slice(0, 200), ua: String(req.headers['user-agent'] || '').slice(0, 160) };
    console.error('[auth fail]', JSON.stringify(row));
    await kv.lpush('authfail', JSON.stringify(row)); await kv.ltrim('authfail', 0, 99);
  } catch (e) { /* 기록 실패는 무시 */ }
}
function failPage(res, why, next, code) {
  const [head, body] = FAIL_TEXT[why] || FAIL_TEXT.token;
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>로그인하지 못했어요 · 헬로 대부도 오락실</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1324;color:#f4f1e8;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;padding:20px;box-sizing:border-box}
.c{max-width:360px;width:100%;background:#14223f;border:2px solid #ffd23c;border-radius:18px;padding:22px 18px;text-align:center;box-sizing:border-box}h1{font-size:20px;margin:0 0 10px;color:#ffd23c}p{font-size:15px;line-height:1.6;margin:8px 0}
a.b{display:block;margin-top:12px;border-radius:999px;padding:13px 0;font-weight:800;font-size:16px;text-decoration:none}a.y{background:#ffd23c;color:#2a1c00}a.g{background:#26365c;color:#fff}small{display:block;margin-top:14px;opacity:.65;font-size:12px;line-height:1.5}</style></head>
<body><div class="c"><h1>로그인하지 못했어요</h1><p><b>${esc(head)}</b></p><p>${esc(body)}</p>
<a class="b y" href="/api/auth?action=login&amp;next=${encodeURIComponent(next)}">다시 로그인하기</a><a class="b g" href="${esc(next)}">로그인 없이 돌아가기</a>
<small>게임은 로그인 없이도 할 수 있어요.<br>계속 안 되면 이 화면을 캡처해 문의해 주세요: <a href="https://open.kakao.com/o/s6jWLxuh" style="color:#ffd23c">오픈채팅</a><br>(확인 번호: ${esc(why)}${code ? ' · ' + esc(code) : ''})</small></div></body></html>`);
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
        `hs_state=${state}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`, // (11/12) 10분 → 1시간: 보호자 동의·인증에 시간이 걸려도 끊기지 않게
        `hs_next=${encodeURIComponent(safeNext(q.next))}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
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
      const fail = async (why, extra) => {
        res.setHeader('Set-Cookie', clear);
        if (why === 'cancel') return res.redirect(302, `${next}${next.includes('?') ? '&' : '?'}login=cancel`);
        await logFail(req, why, extra);
        return failPage(res, why, next, extra && extra.err);
      };
      // 사용자가 직접 취소한 것(access_denied)만 조용히 돌려보내고, 그 밖의 카카오 오류는 안내 화면 + 기록
      if (q.error) return fail(q.error === 'access_denied' ? 'cancel' : 'kakao', { err: q.error, desc: q.error_description });
      if (!authReady()) return fail('notready');
      if (!q.state || q.state !== cookies.hs_state) return fail('state', { err: cookies.hs_state ? 'mismatch' : 'no_cookie' });

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
      if (!tokRes.ok || !tok.access_token) return fail('token', { err: tok.error_code || tok.error || String(tokRes.status), desc: tok.error_description });

      const meRes = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const me = await meRes.json().catch(() => ({}));
      if (!meRes.ok || !me.id) return fail('profile', { err: String(me.code || meRes.status), desc: me.msg });
      const kakaoNick = (me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname)
        || (me.properties && me.properties.nickname) || '';

      await upsertUser(String(me.id), kakaoNick);
      res.setHeader('Set-Cookie', [makeSessionCookie(String(me.id)), ...clear]);
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, `${next}${next.includes('?') ? '&' : '?'}login=ok`);
    }

    // (관리자) 최근 로그인 실패 기록
    if (q.fails) {
      if (!isAdminRequest(req)) return res.status(403).json({ error: 'forbidden' });
      const rows = (await kv.lrange('authfail', 0, 99)) || [];
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ fails: rows.map((r) => { try { return typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return r; } }) });
    }

    // (3) 로그인 상태 확인
    res.setHeader('Cache-Control', 'no-store');
    const u = await sessionUser(req);
    const contactRequired = process.env.CONTACT_REQUIRED === '1'; // 랭킹 등록 때 회원에게도 연락처를 받을지(이벤트 때만 켬)
    if (!u) return res.status(200).json({ loggedIn: false, ready: authReady(), contactRequired });
    const cards = await getCards(u.wid);
    // 내 카드첩에 새로 달린 방명록 수(마지막으로 내 카드첩을 연 뒤에 남이 쓴 글)
    let newNotes = 0;
    try { newNotes = countNewNotes(await getNotes(u.wid), u.wid, u.notesSeenAt || u.createdAt); } catch (e) { /* 무시 */ }
    return res.status(200).json({ loggedIn: true, ready: true, wid: u.wid, nick: u.nick, cardCount: Object.keys(cards).length, newNotes, contactRequired });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
