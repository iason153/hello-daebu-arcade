// /api/_session.js  (파일명이 _ 로 시작하면 Vercel이 주소로 노출하지 않는 "공용 부품"으로 취급)
// 로그인 상태(세션)와 올림포스 카드첩 데이터의 공용 함수.
//
// 세션은 서버에 따로 저장하지 않고, "회원번호.만료시각.서명" 한 줄을 쿠키에 담는다.
// 서명은 환경변수 SESSION_SECRET 으로 만든 HMAC 이라, 비밀값을 모르면 위조할 수 없다.
// 쿠키는 HttpOnly(자바스크립트가 못 읽음) + Secure(https 전용) + SameSite=Lax.
//
// KV 저장 구조
//   user:{카카오회원번호}  → { wid, nick, createdAt, lastLoginAt }
//   wid:{카드첩주소}       → 카카오회원번호          (공개 주소에서 회원을 찾는 용도)
//   cards:{카드첩주소}     → { zeus: { at, floor, serial }, ... }
//   cardserial:{신}        → 숫자                    (그 카드의 전체 획득 번호 — "전체 7번째")
//   visits:{카드첩주소}    → 숫자                    (구경 온 횟수)
//   members (해시)         → 카드첩주소 → { nick, gods:[…], createdAt }   (수집가 광장 — 카드가 0장이어도 모든 회원)
// 카카오 회원번호는 밖으로 절대 내보내지 않는다. 공개되는 건 무작위로 만든 카드첩 주소(wid)뿐.

import { kv } from '@vercel/kv';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

export const GODS = ['zeus', 'athena', 'hermes', 'poseidon', 'aphrodite', 'apollo', 'hades', 'artemis', 'dionysus', 'hera'];
export const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://daebugame.com';
const COOKIE = 'hs';
const MAX_AGE = 60 * 60 * 24 * 180; // 180일

const secret = () => process.env.SESSION_SECRET || '';
export const authReady = () => !!(secret() && process.env.KAKAO_REST_KEY);

function sign(text) {
  return createHmac('sha256', secret()).update(text).digest('base64url');
}

export function makeSessionCookie(kid) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const body = `${kid}.${exp}`;
  return `${COOKIE}=${body}.${sign(body)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}
export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

// 로그인한 회원의 카카오 회원번호를 돌려줌(없거나 위조·만료면 null)
export function sessionKid(req) {
  if (!secret()) return null;
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [kid, exp, sig] = parts;
  const expect = sign(`${kid}.${exp}`);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^\d+$/.test(kid) || Number(exp) < Date.now() / 1000) return null;
  return kid;
}

export async function getUser(kid) {
  if (!kid) return null;
  const u = await kv.get(`user:${kid}`);
  return u && typeof u === 'object' ? u : (typeof u === 'string' ? JSON.parse(u) : null);
}
export async function sessionUser(req) {
  const kid = sessionKid(req);
  if (!kid) return null;
  const u = await getUser(kid);
  return u ? { kid, ...u } : null;
}

// 관리자 확인 — 요청 헤더 x-admin-secret 이 Vercel 환경변수 ADMIN_SECRET 과 같은지(코드에는 값이 없음)
export function isAdminRequest(req) {
  const expected = process.env.ADMIN_SECRET || '';
  const given = String(req.headers['x-admin-secret'] || '');
  if (!expected || !given) return false;
  const a = Buffer.from(expected), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// 수집가 광장 명단의 한 줄을 최신 상태로 맞춘다(가입·이름 변경·카드 획득 때마다 호출)
export async function saveMemberRow(u, cards) {
  if (!u || !u.wid) return;
  const c = cards || await getCards(u.wid);
  await kv.hset('members', { [u.wid]: JSON.stringify({ nick: u.nick, gods: GODS.filter((g) => c[g]), createdAt: u.createdAt }) });
}
export async function listMembers() {
  const all = (await kv.hgetall('members')) || {};
  const rows = [];
  for (const [wid, raw] of Object.entries(all)) {
    try {
      const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
      rows.push({ wid, nick: String(r.nick || ''), gods: Array.isArray(r.gods) ? r.gods : [], count: Array.isArray(r.gods) ? r.gods.length : 0, createdAt: r.createdAt || '' });
    } catch (e) { /* 깨진 줄은 건너뜀 */ }
  }
  // 카드 많은 순, 같으면 먼저 가입한 순
  rows.sort((a, b) => b.count - a.count || String(a.createdAt).localeCompare(String(b.createdAt)));
  return rows;
}

export function cleanNick(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
}

// 처음 로그인하면 회원과 카드첩 주소를 만든다. 이미 있으면 마지막 로그인 시각만 갱신.
export async function upsertUser(kid, kakaoNick) {
  const now = new Date().toISOString();
  let u = await getUser(kid);
  if (!u) {
    let wid = '';
    for (let i = 0; i < 5; i++) {
      wid = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
      if (!(await kv.get(`wid:${wid}`))) break;
    }
    u = { wid, nick: cleanNick(kakaoNick) || '이름 없는 수집가', createdAt: now, lastLoginAt: now };
    await kv.set(`wid:${wid}`, String(kid));
  } else {
    u.lastLoginAt = now;
  }
  await kv.set(`user:${kid}`, u);
  await saveMemberRow(u);
  return u;
}

export async function getCards(wid) {
  const c = await kv.get(`cards:${wid}`);
  if (!c) return {};
  return typeof c === 'string' ? JSON.parse(c) : c;
}

// 카드 획득 등록. 이미 가진 카드는 건드리지 않는다(처음 얻은 기록을 지킴).
// 층수는 그 카드를 얻을 수 있는 최소 층(제우스 110, 아테나 120 …) 이상이어야 받아준다.
export async function claimCards(wid, claims) {
  const cards = await getCards(wid);
  const added = [];
  for (const c of (Array.isArray(claims) ? claims : []).slice(0, GODS.length)) {
    const god = String((c || {}).god || '');
    const idx = GODS.indexOf(god);
    if (idx < 0 || cards[god]) continue;
    const need = 110 + idx * 10;
    const floor = Math.floor(Number(c.floor));
    if (!Number.isFinite(floor) || floor < need || floor > 200) continue;
    const t = Date.parse(c.at);
    const at = Number.isFinite(t) && t <= Date.now() + 60000 && t > Date.parse('2026-10-01') ? new Date(t).toISOString() : new Date().toISOString();
    const serial = await kv.incr(`cardserial:${god}`);
    cards[god] = { at, floor: need, serial };
    added.push(god);
  }
  if (added.length) {
    await kv.set(`cards:${wid}`, cards);
  }
  return { cards, added };
}
