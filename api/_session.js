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
//   notes:{카드첩주소}     → [ { id, from, nick, text, at, reply, reports } … ]  (방명록, 최신순 50개까지)
//   members (해시)         → 카드첩주소 → { nick, gods:[…], createdAt }   (수집가 광장 — 카드가 0장이어도 모든 회원)
// 카카오 회원번호는 밖으로 절대 내보내지 않는다. 공개되는 건 무작위로 만든 카드첩 주소(wid)뿐.

import { kv } from '@vercel/kv';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

// 카드 목록과 "그 카드를 얻을 수 있는 최소 층". 1막 = 대부도 친구들 5장, 2막 = 올림포스 신 10장.
// 뒤로 갈수록 귀한 카드(순서가 곧 귀한 정도 — 대표 카드 고를 때 맨 뒤 것을 씀).
export const CARD_NEED = {
  hello: 10, starfish: 30, crab: 50, gull: 70, jellyfish: 100,
  zeus: 110, athena: 120, hermes: 130, poseidon: 140, aphrodite: 150, apollo: 160, hades: 170, artemis: 180, dionysus: 190, hera: 200,
  // 헬로먼치 "우주괴물 도감" — 도달 카드는 높이(m), 묘기·비밀 카드는 0(게임 화면이 알려 주는 대로 믿음)
  m_chomp: 0, m_sky: 60, m_cloud: 150, m_rocket: 0, m_space: 270, m_near: 0, m_gull: 0, m_gods: 500,
};
// 카드가 속한 게임(없으면 헬로타워)과 그 게임에서 나올 수 있는 최고 기록 — 터무니없는 값 걸러내기용
export const CARD_GAME = { m_chomp: 'munch', m_sky: 'munch', m_cloud: 'munch', m_rocket: 'munch', m_space: 'munch', m_near: 'munch', m_gull: 'munch', m_gods: 'munch' };
const GAME_MAX = { tower: 200, munch: 100000 };
// 등급(귀한 정도) — 대표 카드를 고를 때 씀. 적혀 있지 않으면 일반.
export const CARD_GRADE = { jellyfish: 1, apollo: 1, hades: 1, artemis: 1, dionysus: 1, hera: 2, m_space: 1, m_near: 1, m_gull: 1, m_gods: 2 };
// 가진 카드 중 가장 귀한 것(등급이 같으면 목록에서 뒤에 있는 것)
export function bestCard(owned) {
  let best = null, score = -1;
  owned.forEach((k) => { const s = (CARD_GRADE[k] || 0) * 1000 + GODS.indexOf(k); if (s > score) { score = s; best = k; } });
  return best;
}
// 아직 자랑용 가로 그림(og)이 준비되지 않은 카드 — 그림이 오면 여기서 빼면 됨
export const NO_OG = new Set([]);
export const CARD_NAME = {
  hello: '헬로', starfish: '불가사리', crab: '꽃게', gull: '갈매기', jellyfish: '해파리',
  zeus: '제우스', athena: '아테나', hermes: '헤르메스', poseidon: '포세이돈', aphrodite: '아프로디테', apollo: '아폴론', hades: '하데스', artemis: '아르테미스', dionysus: '디오니소스', hera: '헤라',
  m_chomp: '덥석!', m_sky: '하늘', m_cloud: '구름 위', m_rocket: '헬로 로켓', m_space: '우주', m_near: '아슬아슬의 달인', m_gull: '갈매기의 복수', m_gods: '신들의 나라',
};
// 자랑 글(링크 미리보기 설명)에 들어가는 한 줄
export const CARD_BRAG = {
  hello: "10층 쌓고 헬로를 데려왔어요. 시작이 반이라던데요?",
  starfish: "30층 돌파! 갯벌의 별을 주웠습니다.",
  crab: "50층 돌파! 집게 대장한테 인정받았어요.",
  gull: "70층 돌파! 이제 갈매기랑 눈높이가 같아요.",
  jellyfish: "100층 완주! 하늘나라 문지기가 문을 열어 줬어요.",
  zeus: "번개 맞을 각오로 110층을 넘었습니다.",
  athena: "120층 돌파! 지혜의 여신도 제 손놀림에 놀랐어요.",
  hermes: "130층 돌파! 택배보다 빠르게 쌓았습니다.",
  poseidon: "140층 돌파! 파도처럼 흔들려도 안 무너졌어요.",
  aphrodite: "150층 돌파! 미끄러운 사랑도 버텨 냈습니다.",
  apollo: "160층 돌파! 통통 튀는 태양신도 붙잡았어요.",
  hades: "170층 돌파! 저승의 왕도 제 탑은 못 무너뜨렸어요.",
  artemis: "180층 돌파! 달까지 얼마 안 남았어요.",
  dionysus: "190층 돌파! 축제는 이제부터입니다.",
  hera: "200층 정복! 신들의 여왕이 왕관을 씌워 줬어요.",
};
Object.assign(CARD_BRAG, {
  m_chomp: '우주괴물한테 덥석 먹혔습니다. 뱃속은 생각보다 따뜻해요.',
  m_sky: '괴물을 따돌리고 60m 하늘까지 올라왔어요.',
  m_cloud: '150m 구름 위! 비행기 옆자리에 앉았습니다.',
  m_rocket: '황금조개 10개 모아서 헬로 로켓 발사!',
  m_space: '270m, 괴물을 달고 우주까지 왔습니다.',
  m_near: '괴물 이빨 사이를 다섯 번이나 빠져나왔어요.',
  m_gull: '비밀 카드를 찾았어요. 얻는 방법은 비밀!',
  m_gods: '500m 신들의 나라 도착! 괴물도 여기까진 못 와요.',
});
export const GODS = Object.keys(CARD_NEED); // (이름은 예전 그대로 두었지만 지금은 "모든 카드" 목록)
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

// ---------- 방명록 ----------
// 글 하나 = { id, from, nick, text, at, replies: [ { id, from, nick, text, at } … ], reports: [카드첩주소 …] }
export const NOTE_MAX = 300;   // 글 글자 수(여러 줄 가능)
export const REPLY_MAX = 200;  // 답글 글자 수
const NOTE_KEEP = 100;         // 카드첩 하나에 보관하는 글 수(넘으면 오래된 것부터 사라짐)
export const REPLY_KEEP = 30;  // 글 하나에 달 수 있는 답글 수
export function cleanNote(s, max) {
  return String(s || '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' ').replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max || NOTE_MAX);
}
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export async function getNotes(wid) {
  const n = await kv.get(`notes:${wid}`);
  const arr = typeof n === 'string' ? JSON.parse(n) : n;
  if (!Array.isArray(arr)) return [];
  // 처음 버전(주인 답글 하나만 있던 때)의 글을 지금 모양으로 맞춤
  for (const x of arr) {
    if (!Array.isArray(x.replies)) x.replies = x.reply && x.reply.text ? [{ id: 'r0', from: wid, nick: '', text: x.reply.text, at: x.reply.at }] : [];
    delete x.reply;
  }
  return arr;
}
export async function saveNotes(wid, notes) {
  await kv.set(`notes:${wid}`, notes.slice(0, NOTE_KEEP));
}
// 밖으로 내보낼 모양 — 신고가 3번 이상 쌓인 글은 주인·관리자·쓴 사람이 아니면 보이지 않는다. 신고한 사람 목록은 내보내지 않는다.
export function publicNotes(notes, viewerWid, ownerWid, isAdmin, ownerNick) {
  const out = [];
  const canManage = isAdmin || (!!viewerWid && viewerWid === ownerWid);
  for (const n of notes) {
    const hidden = (n.reports || []).length >= 3;
    if (hidden && !canManage && viewerWid !== n.from) continue;
    out.push({
      id: n.id, from: n.from, nick: n.nick, text: n.text, at: n.at, hidden, isOwner: n.from === ownerWid,
      replies: (n.replies || []).map((r) => ({ id: r.id, from: r.from, nick: r.nick || ownerNick || '', text: r.text, at: r.at, isOwner: r.from === ownerWid, canDelete: canManage || (!!viewerWid && viewerWid === r.from) })),
      canDelete: canManage || (!!viewerWid && viewerWid === n.from),
      canReply: !!viewerWid && (n.replies || []).length < REPLY_KEEP,
      canReport: !!viewerWid && viewerWid !== n.from && viewerWid !== ownerWid && !(n.reports || []).includes(viewerWid), // 주인은 신고 대신 지우기
    });
  }
  return out;
}
// 내 카드첩에 "마지막으로 본 뒤" 남이 남긴 글·답글 수
export function countNewNotes(notes, myWid, seenAt) {
  const seen = Date.parse(seenAt) || 0;
  let c = 0;
  for (const n of notes) {
    if (n.from !== myWid && Date.parse(n.at) > seen) c++;
    for (const r of n.replies || []) if (r.from !== myWid && Date.parse(r.at) > seen) c++;
  }
  return c;
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
// 층수는 그 카드를 얻을 수 있는 최소 층(헬로 10 … 제우스 110, 아테나 120 …) 이상이어야 받아준다.
export async function claimCards(wid, claims) {
  const cards = await getCards(wid);
  const added = [];
  for (const c of (Array.isArray(claims) ? claims : []).slice(0, GODS.length)) {
    const god = String((c || {}).god || '');
    const idx = GODS.indexOf(god);
    if (idx < 0 || cards[god]) continue;
    const need = CARD_NEED[god];
    const floor = Math.floor(Number(c.floor));
    if (!Number.isFinite(floor) || floor < need || floor > GAME_MAX[CARD_GAME[god] || 'tower']) continue;
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
