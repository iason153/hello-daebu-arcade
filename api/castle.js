// /api/castle.js — 헬로 캐슬(성 짓기·남의 성 공략·오늘의 신들의 성·신의 시험)
//
//   GET  ?me=1                 → 내 성·명성·등급·성 규칙·신 함정 열림·오늘 남은 공략·소식함·복수 명단 (로그인)
//   GET  ?targets=1            → 공략할 성 4~5곳(내 명성 ±100) + 복수 칸 (로그인)
//   GET  ?castle={wid}         → 그 사람의 공개된 성(누구나 — "내 성 도전장"으로 받은 사람이 연습으로 해 본다, 명성 없음)
//   GET  ?raid={id}            → 공략 다시보기(누구나, 로그인 없이)
//   GET  ?gods=1               → 오늘의 신들의 성 순위·정상 명단·왕좌 + 내 기록
//   GET  ?ghost={id}           → 신들의 성 도전장(유령 길). 그날 자정(한국 시간)에 사라진다
//   GET  ?tshare={id}          → 신의 시험 공유(받은 사람은 그 시험을 한 번 공짜로 해 본다)
//   GET  ?share={종류+번호}    → 짧은 주소 /k/… 용 미리보기 페이지 → 게임으로 이동
//   POST { action:'save', lanes, capt }             → 내 성 설계 저장(아직 공개 아님)
//   POST { action:'publish', t, inputs }            → 저장한 성을 내가 직접 깼다 → 공개(깃발도 내려감)
//   POST { action:'raid_start', target, rev }       → 공략 시작(같은 성은 하루 한 번, 복수는 따로 한 번)
//   POST { action:'raid_end', id, ok, row, t, inputs } → 공략 결과 → 명성·알림·깃발
//   POST { action:'gods', row, t, summit, shells }  → 오늘의 신들의 성 기록(로그인)
//   POST { action:'ghost', row, t, g:{r,x}, nick, cid } → 신들의 성 도전장 만들기(로그인 없이도)
//   POST { action:'trial', god, ok, t, inputs, free } → 신의 시험 결과(통과하면 카드·신 함정·가호)
//   POST { action:'tshare', god, t, nick, cid }     → 신의 시험 공유 주소 만들기
//
// KV
//   castle:{wid}          → { nick, pub:{lanes,capt,len,at,fame}, draft:{lanes,capt,at}, flag:{by,bw,until}, wall, dw, dl, basic }
//   castle:pool (정렬)    → wid ↦ 공개할 때의 명성(공략 상대 고르기)
//   cday:{wid}:{날짜}     → { lost, gained, r:{대상wid}:1 }  하루 제한(이틀 뒤 삭제)
//   crev:{wid} (해시)     → 나를 함락한 사람 wid → { nick, until }  복수 한 번(3일)
//   craidp:{id}           → 공략 시작 기록(성 그대로 복사, 40분)
//   craid:{id}            → 공략 결과·입력 기록(다시보기, 14일)
//   cinbox:{wid} (목록)   → 내 성 소식 30개(14일)
//   cgods:{날짜} (정렬)   → wid ↦ 오늘 최고 줄,  cgodsn:{날짜} (해시) → wid → { nick, row, t, at }   (3일)
//   cgbest (해시)         → wid → 신들의 성 역대 최고 줄(신의 시험 구역 열림용)
//   ctrial:{wid} (해시)   → 신 → { at, t }   신의 시험 통과
//   cghost:{id}           → 신들의 성 도전장(그날 자정까지)
//   ctshare:{id}          → 신의 시험 공유(3일)
//   arena:{wid} 등        → 결투장과 같은 명성(duel.js와 같은 저장 구조를 그대로 쓴다)
//
// 기록은 기기가 보낸 값을 믿는 구조라(오락실 전체의 알려진 한계) 지금은 기본 검사만 한다:
//   입력 기록의 모양·개수, 앞으로 간 횟수와 성 길이, 게임 시간과 실제로 흐른 시간. 입력을 서버에서 끝까지 다시 돌려 보는 검사는 다음 단계.

import { kv } from '@vercel/kv';
import { randomBytes } from 'crypto';
import { sessionUser, cleanNick, SITE_ORIGIN, getCards, saveMemberRow, CARD_NEED } from './_session.js';
import { sendPush } from './_push.js';
import { TIERS } from './duel.js';

const parse = (v) => { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const kstDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
const kstMidnight = () => { const d = new Date(Date.now() + 9 * 3600 * 1000); d.setUTCHours(24, 0, 0, 0); return d.getTime() - 9 * 3600 * 1000; };
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function newId() { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'[b[i] % 31]; return s; }
const ID_RE = /^[a-z0-9]{8}$/, WID_RE = /^[a-z0-9]{4,16}$/, CID_RE = /^[a-z0-9]{8,24}$/;
const PATH = '/games/hello-castle/';
const START = 1000;

// =============================================================== 성 규칙 (게임 화면 index.html의 "성 규칙"과 같아야 한다)
// 명성 10점 = ★1 = 성 1줄. 성 길이 최대 = 예산 = (명성 − 700) ÷ 10, 아무리 낮아도 20줄. (대표 결정 10/12)
export const PIECES = {
  grass: 0, log: 1, soldier: 1, patrol: 2, water: 1, cannon: 2, wave: 3, bolt: 3, guard: 3,
  octo: 2, jelly: 2, bomb: 2, tide: 1, cart: 1, star: 1, tiller: 2, whirl: 2, rock: 2,
};
const SPEEDY = new Set(['log', 'soldier', 'patrol', 'water', 'cannon', 'jelly', 'bomb', 'tide', 'cart', 'star', 'tiller', 'whirl', 'rock']);
const TWO = new Set(['patrol', 'jelly', 'rock']);
const GODP = { wave: 'poseidon', bolt: 'zeus', guard: 'munch' };
const CAPT_COST = 3, MIN_LEN = 20, COLS = 7;
// 등급별(결투장 칭호 그대로): 뒤쪽 절반에서 함정을 몇 줄까지 연달아 · 가장 빠른 속도(0 느림 1 보통 2 빠름) · 경비대장
export const CT = [
  { run: 2, spd: 0, capt: false },  // 견습생
  { run: 2, spd: 1, capt: false },  // 전사
  { run: 3, spd: 2, capt: true },   // 용사
  { run: 4, spd: 2, capt: true },   // 영웅
  { run: 5, spd: 2, capt: true },   // 반신
];
const eun = (w) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? '은' : '는');
const tierIdx = (r, n) => { let k = 0; TIERS.forEach((T, j) => { if (r >= T.min && n >= T.games) k = j; }); return k; };
export const maxLen = (fame) => Math.max(MIN_LEN, Math.floor((fame - 700) / 10));
function rulesFor(fame, games) { const ti = tierIdx(fame, games), c = CT[ti]; return { tier: TIERS[ti].name, ti, len: maxLen(fame), bud: maxLen(fame), run: c.run, spd: c.spd, capt: c.capt, minLen: MIN_LEN }; }
export function costOf(lanes, capt) { let u = capt ? CAPT_COST : 0; lanes.forEach((l, i) => { if (i > 0 && TWO.has(lanes[i - 1].t)) return; u += PIECES[l.t] + (SPEEDY.has(l.t) && l.s === 2 ? 1 : 0); }); return u; }
// 길이 남아 있나: 성문(가운데)에서 보물방까지 나무·바위를 피해 갈 수 있는지
function pathOk(lanes) {
  const R = lanes.length + 2, bl = (r, c) => r >= 1 && r <= lanes.length && (lanes[r - 1].b || []).includes(c);
  const seen = new Set(['0:3']), q = [[0, 3]];
  while (q.length) { const [r, c] = q.shift(); if (r === R - 1) return true;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr < 0 || nr >= R || nc < 0 || nc >= COLS || bl(nr, nc)) continue; const k = nr + ':' + nc; if (!seen.has(k)) { seen.add(k); q.push([nr, nc]); } } }
  return false;
}
// 성 설계 검사. 틀린 곳이 있으면 한국어 이유를 돌려준다(없으면 null)
export function checkCastle(lanes, capt, R, unlock) {
  if (!Array.isArray(lanes)) return '성 모양이 올바르지 않아요';
  const n = lanes.length;
  if (n < MIN_LEN) return `성은 ${MIN_LEN}줄 이상이어야 해요`;
  if (n > R.len) return `지금 명성으로는 ${R.len}줄까지 지을 수 있어요`;
  if (capt && !R.capt) return '경비대장은 용사부터 둘 수 있어요';
  const half = Math.floor(n / 2), god = {};
  let blocks = 0;
  for (let i = 0; i < n; i++) {
    const l = lanes[i] || {}, t = l.t, part = i > 0 && TWO.has(lanes[i - 1].t);
    if (!(t in PIECES)) return `${i + 1}줄: 모르는 함정이에요`;
    if (part && t !== 'grass') return `${i + 1}줄: 두 줄짜리 함정이 쓰는 줄이에요`;
    const s = l.s || 0;
    if (![0, 1, 2].includes(s) || (s && !SPEEDY.has(t))) return `${i + 1}줄: 속도가 올바르지 않아요`;
    if (s > R.spd) return `${i + 1}줄: ${eun(R.tier)} ${['느림', '보통', '빠름'][R.spd]}까지만 고를 수 있어요`;
    if (TWO.has(t) && i === n - 1) return '맨 위 줄에는 두 줄짜리 함정을 둘 수 없어요';
    if (GODP[t]) { if (!unlock[GODP[t]]) return `${i + 1}줄: 아직 열지 않은 신의 함정이에요`; if (god[t]) return '신의 함정은 신마다 한 줄만 둘 수 있어요'; god[t] = 1; }
    // 앞쪽 절반: 함정 다음 줄은 꼭 풀밭(번갈아)
    const trapPrev = i > 0 && (lanes[i - 1].t !== 'grass' || (i > 1 && TWO.has(lanes[i - 2].t)));
    if (i < half && t !== 'grass' && trapPrev) return `${i + 1}줄: 앞쪽 절반은 함정과 풀밭을 번갈아 놓아야 해요`;
    const b = l.b || [];
    if (!Array.isArray(b) || b.length > 3 || new Set(b).size !== b.length || b.some((c) => !Number.isInteger(c) || c < 0 || c >= COLS)) return `${i + 1}줄: 나무·바위는 한 줄에 3개까지예요`;
    if (b.length && (t !== 'grass' || part)) return `${i + 1}줄: 나무·바위는 풀밭에만 놓아요`;
    blocks += b.length;
  }
  if (blocks > Math.floor(n / 3)) return `나무·바위는 모두 ${Math.floor(n / 3)}개까지예요`;
  // 뒤쪽 절반: 연달아 놓을 수 있는 함정 줄 수
  let cur = 0;
  for (let i = half; i < n; i++) { const trap = lanes[i].t !== 'grass' || (i > 0 && TWO.has(lanes[i - 1].t)); cur = trap ? cur + 1 : 0; if (cur > R.run) return `${eun(R.tier)} 뒤쪽 절반에서 함정을 ${R.run}줄까지만 연달아 놓을 수 있어요`; }
  if (costOf(lanes, capt) > R.bud) return `예산(★${R.bud})을 넘었어요`;
  if (!pathOk(lanes)) return '나무·바위로 길이 막혔어요. 보물방까지 갈 길을 남겨 주세요';
  return null;
}
const cleanLanes = (lanes) => (Array.isArray(lanes) ? lanes.slice(0, 200) : []).map((l) => { const o = { t: String((l || {}).t || '') }; if (l && l.s) o.s = Number(l.s); if (l && Array.isArray(l.b) && l.b.length) o.b = l.b.map(Number); return o; });
// 처음 온 회원에게 주는 견습생 기본 성(20줄, 느린 함정과 풀밭이 번갈아). 회원마다 함정 순서만 다르다
function basicCastle(wid) {
  let h = 7; for (const ch of String(wid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const pick = ['log', 'soldier', 'cart', 'star', 'water', 'tide', 'log', 'cart'], lanes = [];
  for (let i = 0; i < MIN_LEN; i++) { if (i % 2) lanes.push({ t: 'grass' }); else { h = (h * 1103515245 + 12345) >>> 0; lanes.push({ t: pick[h % pick.length] }); } }
  return lanes;
}

// =============================================================== 기본 검사(입력 기록)
// 입력 한 개 = [몇 번째 계산(1초 60번), 동작] — 동작: 0 앞 1 뒤 2 왼쪽 3 오른쪽 4 헬로~! 5 날개
function checkInputs(inputs, t, needRows, ok, opt) {
  opt = opt || {};
  if (!Number.isFinite(t) || t < 0.5 || t > 3600) return 'time';
  if (!Array.isArray(inputs) || inputs.length > 6000) return 'inputs';
  let last = 0, up = 0, down = 0, sh = 0, wing = 0;
  for (const p of inputs) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[1] < 0 || p[1] > 5) return 'shape';
    if (p[0] < last || p[0] > Math.round(t * 60) + 3) return 'order';
    last = p[0];
    if (p[1] === 0) up++; else if (p[1] === 1) down++; else if (p[1] === 4) sh++; else if (p[1] === 5) wing++;
  }
  if (sh > (opt.shouts || 3)) return 'shout';
  if (ok && up - down + wing * 12 < needRows) return 'short';
  if (ok && t < needRows * 0.14 * 0.9 - (wing ? wing * 12 * 0.14 : 0)) return 'fast';
  return null;
}

// =============================================================== 명성(결투장과 같은 기록)
async function arenaGet(wid) { return parse(await kv.get(`arena:${wid}`)) || { r: START, w: 0, l: 0, g: {} }; }
const games = (a) => (a.w || 0) + (a.l || 0);
async function myState(me) {
  const [a, c] = await Promise.all([arenaGet(me.wid), getCastle(me.wid, me.nick)]);
  return { a, c, R: rulesFor(a.r, games(a)) };
}
async function getCastle(wid, nick) {
  let c = parse(await kv.get(`castle:${wid}`));
  if (!c) {
    // 신규 회원: 견습생 기본 성을 바로 공개해 준다(직접 깨지 않아도 됨)
    const a = await arenaGet(wid);
    const lanes = basicCastle(wid);
    c = { nick: nick || '', pub: { lanes, capt: false, len: lanes.length, at: Date.now(), fame: a.r }, draft: null, flag: null, wall: 0, dw: 0, dl: 0, basic: true };
    await kv.set(`castle:${wid}`, c);
    await kv.zadd('castle:pool', { score: a.r, member: wid });
  }
  return c;
}
async function unlocks(wid) {
  const [cards, tr] = await Promise.all([getCards(wid), kv.hgetall(`ctrial:${wid}`)]);
  const trials = tr || {};
  return {
    // 신 함정과 가호는 신의 시험을 통과해야 열린다. 우주괴물 수문장은 헬로먼치 카드가 한 장이라도 있으면
    poseidon: !!trials.poseidon, zeus: !!trials.zeus, munch: Object.keys(cards).some((k) => k.startsWith('m_')),
    cards: { poseidon: !!cards.poseidon, zeus: !!cards.zeus }, trials,
  };
}
async function dayGet(wid) { return (await kv.hgetall(`cday:${wid}:${kstDay()}`)) || {}; }
async function dayAdd(wid, field, n) { const k = `cday:${wid}:${kstDay()}`; const v = await kv.hincrby(k, field, n); await kv.expire(k, 2 * 24 * 3600); return v; }
async function daySet(wid, field) { const k = `cday:${wid}:${kstDay()}`; await kv.hset(k, { [field]: 1 }); await kv.expire(k, 2 * 24 * 3600); }
const OWNER_LOSS_CAP = 40, OWNER_GAIN_CAP = 30, RK = 32;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
async function fameApply(wid, nick, delta, win) {
  const a = await arenaGet(wid);
  a.r = Math.max(0, a.r + delta); a.nick = nick || a.nick; a.at = Date.now();
  if (win === true) a.w = (a.w || 0) + 1; else if (win === false) a.l = (a.l || 0) + 1;
  if (win != null) { a.g = a.g || {}; const g = a.g.hello_castle = a.g.hello_castle || { w: 0, l: 0 }; if (win) g.w++; else g.l++; }
  await kv.set(`arena:${wid}`, a);
  await kv.zadd('arena:ladder', { score: a.r, member: wid });
  return a;
}

// =============================================================== 처리
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      const fn = { save, publish, raid_start: raidStart, raid_end: raidEnd, gods, ghost, trial, tshare }[b.action];
      if (!fn) return res.status(400).json({ error: 'unknown action' });
      return await fn(req, res, b);
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
    const q = req.query || {};
    if (q.share) return await sharePage(res, String(q.share));
    if (q.raid) { const r = ID_RE.test(String(q.raid)) ? parse(await kv.get(`craid:${q.raid}`)) : null; return r ? res.status(200).json({ raid: r }) : res.status(404).json({ error: 'gone' }); }
    if (q.ghost) { const g = ID_RE.test(String(q.ghost)) ? parse(await kv.get(`cghost:${q.ghost}`)) : null; return g ? res.status(200).json({ ghost: g }) : res.status(404).json({ error: 'gone' }); }
    if (q.tshare) { const g = ID_RE.test(String(q.tshare)) ? parse(await kv.get(`ctshare:${q.tshare}`)) : null; return g ? res.status(200).json({ tshare: g }) : res.status(404).json({ error: 'gone' }); }
    if (q.castle) return await publicCastle(res, String(q.castle));
    if (q.gods) return await godsBoard(req, res);
    const me = await sessionUser(req).catch(() => null);
    if (q.me) return await mine(res, me);
    if (q.targets) return await targets(res, me);
    return res.status(400).json({ error: 'bad request' });
  } catch (e) {
    console.error('[castle]', e && e.message);
    return res.status(500).json({ error: 'server error' });
  }
}

async function mine(res, me) {
  if (!me) return res.status(200).json({ loggedIn: false });
  const [{ a, c, R }, U, day, inbox, rev, best] = await Promise.all([myState(me), unlocks(me.wid), dayGet(me.wid), kv.lrange(`cinbox:${me.wid}`, 0, 29), kv.hgetall(`crev:${me.wid}`), kv.hget('cgbest', me.wid)]);
  if (c.nick !== me.nick) { c.nick = me.nick; await kv.set(`castle:${me.wid}`, c); }
  const now = Date.now();
  const flag = c.flag && c.flag.until > now ? c.flag : null;
  return res.status(200).json({
    loggedIn: true, wid: me.wid, nick: me.nick, fame: a.r, games: games(a), rules: R, tiers: TIERS,
    castle: { pub: c.pub, draft: c.draft, flag, wall: c.wall || 0, dw: c.dw || 0, dl: c.dl || 0, basic: !!c.basic },
    unlock: U, best: Number(best || 0),
    today: { raided: Object.keys(day).filter((k) => k.startsWith('r:')).map((k) => k.slice(2)), lost: Number(day.lost || 0), gained: Number(day.gained || 0) },
    inbox: (inbox || []).map(parse).filter(Boolean),
    revenge: Object.entries(rev || {}).map(([wid, v]) => Object.assign({ wid }, parse(v))).filter((x) => x.until > now),
  });
}

async function save(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const { c, R } = await myState(me), U = await unlocks(me.wid);
  const lanes = cleanLanes(b.lanes), capt = !!b.capt;
  const bad = checkCastle(lanes, capt, R, U);
  if (bad) return res.status(400).json({ error: bad });
  c.draft = { lanes, capt, at: Date.now() }; c.nick = me.nick;
  await kv.set(`castle:${me.wid}`, c);
  return res.status(200).json({ ok: true, draft: c.draft });
}

async function publish(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const { a, c } = await myState(me);
  if (!c.draft) return res.status(400).json({ error: '저장한 성이 없어요' });
  const why = checkInputs(b.inputs, Number(b.t), c.draft.lanes.length + 1, true);
  if (why) return res.status(400).json({ error: '깬 기록을 확인할 수 없어요. 한 번 더 깨 주세요.', why });
  c.pub = { lanes: c.draft.lanes, capt: c.draft.capt, len: c.draft.lanes.length, at: Date.now(), fame: a.r, t: Number(b.t) };
  c.draft = null; c.flag = null; c.basic = false; c.nick = me.nick;
  await kv.set(`castle:${me.wid}`, c);
  await kv.zadd('castle:pool', { score: a.r, member: me.wid });
  return res.status(200).json({ ok: true, pub: c.pub });
}

async function publicCastle(res, wid) {
  if (!WID_RE.test(wid)) return res.status(400).json({ error: 'bad wid' });
  const c = parse(await kv.get(`castle:${wid}`));
  if (!c || !c.pub) return res.status(404).json({ error: 'gone' });
  const a = await arenaGet(wid);
  return res.status(200).json({ castle: { wid, nick: c.nick, fame: a.r, tier: TIERS[tierIdx(a.r, games(a))].name, lanes: c.pub.lanes, capt: c.pub.capt, len: c.pub.len, flag: c.flag && c.flag.until > Date.now() ? c.flag : null, wall: c.wall || 0 } });
}

// 공략 상대: 내 명성 ±100 안에서 4~5곳(오늘 이미 간 성은 빼고). 모자라면 가까운 명성 순으로 채운다
async function targets(res, me) {
  if (!me) return res.status(401).json({ error: 'login required' });
  const [a, day, rev] = await Promise.all([arenaGet(me.wid), dayGet(me.wid), kv.hgetall(`crev:${me.wid}`)]);
  await getCastle(me.wid, me.nick);
  const raw = (await kv.zrange('castle:pool', 0, 1999, { withScores: true })) || [];
  const pool = [];
  for (let i = 0; i < raw.length; i += 2) if (raw[i] !== me.wid) pool.push({ wid: String(raw[i]), f: Number(raw[i + 1]) });
  const done = new Set(Object.keys(day).filter((k) => k.startsWith('r:')).map((k) => k.slice(2)));
  // 하루 동안은 같은 목록이 보이게(새로고침으로 쉬운 성 고르기 방지): 날짜+회원으로 섞는다
  let h = 0; for (const ch of me.wid + kstDay()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { h = (h * 1103515245 + 12345) >>> 0; return h / 4294967296; };
  const near = pool.filter((p) => Math.abs(p.f - a.r) <= 100).map((p) => Object.assign(p, { k: rnd() })).sort((x, y) => x.k - y.k);
  const far = pool.filter((p) => Math.abs(p.f - a.r) > 100).sort((x, y) => Math.abs(x.f - a.r) - Math.abs(y.f - a.r));
  const pick = near.concat(far).slice(0, 5);
  const now = Date.now();
  const revs = Object.entries(rev || {}).map(([wid, v]) => Object.assign({ wid }, parse(v))).filter((x) => x.until > now);
  const want = pick.map((p) => p.wid).concat(revs.map((r) => r.wid));
  const cs = await Promise.all(want.map((w) => kv.get(`castle:${w}`).then(parse)));
  const as = await Promise.all(want.map((w) => arenaGet(w)));
  const row = (w, i, extra) => { const c = cs[i], aa = as[i]; if (!c || !c.pub) return null;
    return Object.assign({ wid: w, nick: c.nick, fame: aa.r, tier: TIERS[tierIdx(aa.r, games(aa))].name, len: c.pub.len, capt: !!c.pub.capt, wall: c.wall || 0,
      flag: c.flag && c.flag.until > now ? { by: c.flag.by } : null, done: done.has(w) }, extra); };
  const list = pick.map((p, i) => row(p.wid, i)).filter(Boolean);
  const revList = revs.map((r, j) => row(r.wid, pick.length + j, { rev: true, until: r.until })).filter(Boolean);
  return res.status(200).json({ fame: a.r, list, revenge: revList });
}

async function raidStart(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const target = String(b.target || '');
  if (!WID_RE.test(target) || target === me.wid) return res.status(400).json({ error: '공략할 수 없는 성이에요' });
  const c = parse(await kv.get(`castle:${target}`));
  if (!c || !c.pub) return res.status(404).json({ error: '성이 없어요' });
  const day = await dayGet(me.wid);
  let rev = false;
  if (day['r:' + target]) {
    // 오늘 이미 갔다 — 복수 한 번은 따로 된다
    const rv = parse(await kv.hget(`crev:${me.wid}`, target));
    if (!b.rev || !rv || rv.until < Date.now()) return res.status(400).json({ error: '이 성은 오늘 이미 공략했어요. 내일 다시 와요!' });
    rev = true;
  } else if (b.rev) {
    const rv = parse(await kv.hget(`crev:${me.wid}`, target));
    rev = !!(rv && rv.until > Date.now());
  }
  if (rev) await kv.hdel(`crev:${me.wid}`, target); else await daySet(me.wid, 'r:' + target);
  const [aA, aO, U] = await Promise.all([arenaGet(me.wid), arenaGet(target), unlocks(me.wid)]);
  const id = newId();
  const snap = { id, a: me.wid, an: me.nick, af: aA.r, o: target, on: c.nick, of: aO.r, lanes: c.pub.lanes, capt: !!c.pub.capt, len: c.pub.len, rev, at: Date.now(),
    guard: { poseidon: U.poseidon, zeus: U.zeus, munch: U.munch } };
  await kv.set(`craidp:${id}`, snap, { ex: 40 * 60 });
  return res.status(200).json({ id, castle: { wid: target, nick: c.nick, fame: aO.r, lanes: snap.lanes, capt: snap.capt, len: snap.len }, guard: snap.guard, rev });
}

async function raidEnd(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const id = String(b.id || '');
  const s = ID_RE.test(id) ? parse(await kv.get(`craidp:${id}`)) : null;
  if (!s || s.a !== me.wid) return res.status(404).json({ error: '공략 기록이 없어요' });
  await kv.del(`craidp:${id}`); // 한 번만
  const t = Number(b.t), ok = !!b.ok, row = Math.max(0, Math.min(s.len + 1, Math.floor(Number(b.row) || 0)));
  let why = checkInputs(b.inputs, t, s.len + 1, ok);
  if (!why && t > (Date.now() - s.at) / 1000 + 3) why = 'clock';  // 게임 시간이 실제로 흐른 시간보다 길 수 없다
  const win = ok && !why;
  // 명성: 엘로(K=32) — 같은 명성끼리 ±16, 최대 30, 최소 5. 실패하면 공략한 사람이 절반을 잃고 주인이 절반을 얻는다
  const [A, O] = await Promise.all([arenaGet(s.a), arenaGet(s.o)]);
  const ea = 1 / (1 + Math.pow(10, (O.r - A.r) / 400));
  let dA, dO;
  const od = await dayGet(s.o);
  if (win) {
    const d = clamp(Math.round(RK * (1 - ea)), 5, 30);
    const lossLeft = Math.max(0, OWNER_LOSS_CAP - Number(od.lost || 0));
    dA = d; dO = -Math.min(d, lossLeft);
  } else {
    const d = clamp(Math.round(RK * ea), 5, 30), half = Math.max(2, Math.round(d / 2));
    const gainLeft = Math.max(0, OWNER_GAIN_CAP - Number(od.gained || 0));
    dA = -half; dO = Math.min(half, gainLeft);
  }
  if (why) { dA = Math.min(0, dA); }
  const [nA] = await Promise.all([
    fameApply(s.a, me.nick, dA, win),
    fameApply(s.o, s.on, dO, !win),
    dO < 0 ? dayAdd(s.o, 'lost', -dO) : dO > 0 ? dayAdd(s.o, 'gained', dO) : null,
  ]);
  const c = parse(await kv.get(`castle:${s.o}`));
  if (c) {
    if (win) { c.flag = { by: me.nick, bw: me.wid, until: Date.now() + 24 * 3600 * 1000, raid: id }; c.dl = (c.dl || 0) + 1; }
    else { c.wall = (c.wall || 0) + 1; c.dw = (c.dw || 0) + 1; }
    await kv.set(`castle:${s.o}`, c);
  }
  // 다시보기(입력 기록) — 14일
  const inputs = Array.isArray(b.inputs) ? b.inputs.slice(0, 6000) : [];
  const rec = { id, a: s.a, an: me.nick, o: s.o, on: s.on, lanes: s.lanes, capt: s.capt, len: s.len, guard: s.guard, ok: win, row, t: Math.round(t * 100) / 100, inputs, dA, dO, rev: s.rev, at: Date.now(), why: why || null };
  await kv.set(`craid:${id}`, rec, { ex: 14 * 24 * 3600 });
  // 성 주인에게 소식 + 휴대폰 알림. 함락당하면 복수 한 번(3일)
  const item = { k: 'raid', id, by: me.nick, bw: me.wid, r: win ? 'l' : 'w', row, len: s.len, dr: dO, t: rec.t, at: Date.now() };
  await kv.lpush(`cinbox:${s.o}`, JSON.stringify(item)); await kv.ltrim(`cinbox:${s.o}`, 0, 29); await kv.expire(`cinbox:${s.o}`, 14 * 24 * 3600);
  if (win) { await kv.hset(`crev:${s.o}`, { [s.a]: JSON.stringify({ nick: me.nick, until: Date.now() + 3 * 24 * 3600 * 1000 }) }); await kv.expire(`crev:${s.o}`, 3 * 24 * 3600); }
  await sendPush('w:' + s.o, {
    title: win ? '🏴 내 성이 함락됐어요!' : '🛡️ 내 성이 막아 냈어요!',
    body: win ? `${me.nick}님이 보물방까지 왔어요 · 명성 ${dO} · 다시보기·복수하러 가요!` : `${me.nick}님이 ${Math.max(0, row - 1)}줄까지 왔다가 막혔어요 · 명성 +${dO} · 🛡철벽 +1`,
    url: `${PATH}?raid=${id}&utm_source=push&utm_medium=notification&utm_campaign=castle_raid`, tag: 'castle-' + id,
  }).catch(() => 0);
  return res.status(200).json({ ok: true, win, why: why || null, dA, dO, fame: nA.r, id, flag: win });
}

async function godsBoard(req, res) {
  const me = await sessionUser(req).catch(() => null);
  const day = kstDay();
  const [top, info] = await Promise.all([kv.zrange(`cgods:${day}`, 0, 29, { rev: true, withScores: true }), kv.hgetall(`cgodsn:${day}`)]);
  const I = info || {}, list = [];
  for (let i = 0; i < (top || []).length; i += 2) { const w = String(top[i]), x = parse(I[w]) || {}; list.push({ rank: list.length + 1, wid: w, nick: x.nick || '', row: Number(top[i + 1]), t: x.t || 0 }); }
  const summit = Object.entries(I).map(([w, v]) => Object.assign({ wid: w }, parse(v))).filter((x) => x.summitAt).sort((a, b) => a.summitAt - b.summitAt).slice(0, 50).map((x) => ({ wid: x.wid, nick: x.nick, at: x.summitAt }));
  const mine = me ? parse(I[me.wid]) : null;
  let myRank = 0; if (mine) myRank = list.findIndex((x) => x.wid === me.wid) + 1;
  return res.status(200).json({ day, list, summit, throne: list[0] && list[0].row > 100 ? list[0] : null, me: me ? { wid: me.wid, row: mine ? mine.row : 0, rank: myRank } : null });
}

async function gods(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const row = Math.floor(Number(b.row)), t = Number(b.t);
  if (!Number.isInteger(row) || row < 0 || row > 2000 || !Number.isFinite(t) || t < 0 || t > 7200) return res.status(400).json({ error: 'bad record' });
  if (row > 5 && t < row * 0.14 * 0.5) return res.status(400).json({ error: 'bad record' });
  const day = kstDay(), k = `cgodsn:${day}`;
  const prev = parse(await kv.hget(k, me.wid)) || { row: 0 };
  const rec = { nick: me.nick, row: Math.max(prev.row, row), t: row > prev.row ? Math.round(t) : prev.t, at: Date.now(), summitAt: prev.summitAt || (row >= 100 ? Date.now() : 0) };
  await kv.hset(k, { [me.wid]: JSON.stringify(rec) }); await kv.expire(k, 3 * 24 * 3600);
  if (row > prev.row) { await kv.zadd(`cgods:${day}`, { score: row, member: me.wid }); await kv.expire(`cgods:${day}`, 3 * 24 * 3600); }
  const best = Number(await kv.hget('cgbest', me.wid) || 0);
  if (row > best) await kv.hset('cgbest', { [me.wid]: row });
  return res.status(200).json({ ok: true, best: Math.max(best, row), day: rec });
}

async function ghost(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  const cid = String(b.cid || '');
  if (!me && !CID_RE.test(cid)) return res.status(400).json({ error: 'bad cid' });
  const rk = `crate:${me ? me.wid : cid}`, n = await kv.incr(rk); if (n === 1) await kv.expire(rk, 3600);
  if (n > 30) return res.status(429).json({ error: '너무 많이 만들었어요. 잠시 뒤에 해 주세요.' });
  const row = Math.floor(Number(b.row)), t = Number(b.t), g = b.g || {};
  if (!Number.isInteger(row) || row < 1 || row > 2000 || !Number.isFinite(t) || t <= 0 || t > 7200) return res.status(400).json({ error: 'bad record' });
  const R = Array.isArray(g.r) ? g.r : null, X = Array.isArray(g.x) ? g.x : null;
  if (!R || !X || R.length !== X.length || R.length > 12000 || R.some((v) => !Number.isInteger(v) || v < 0 || v > 2100) || X.some((v) => !Number.isInteger(v) || v < -10 || v > 70)) return res.status(400).json({ error: 'bad ghost' });
  if (Math.max(0, ...R) !== row) return res.status(400).json({ error: 'bad ghost' });
  const id = newId(), exp = kstMidnight(), left = Math.max(60, Math.ceil((exp - Date.now()) / 1000));
  const nick = me ? me.nick : (cleanNick(b.nick).slice(0, 10) || '헬로');
  const d = { id, day: kstDay(), nick, wid: me ? me.wid : null, row, t: Math.round(t * 10) / 10, g: { r: R, x: X }, summit: row >= 100, exp };
  await kv.set(`cghost:${id}`, d, { ex: left });
  return res.status(200).json({ id, exp, nick, link: `${SITE_ORIGIN}${PATH}?ghost=${id}`, short: `${SITE_ORIGIN}/k/g${id}` });
}

const TRIAL_GODS = { poseidon: { zone: 50, name: '포세이돈' }, zeus: { zone: 75, name: '제우스' } };
async function trial(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const god = String(b.god || ''), G = TRIAL_GODS[god];
  if (!G) return res.status(400).json({ error: 'bad god' });
  const [cards, best, done] = await Promise.all([getCards(me.wid), kv.hget('cgbest', me.wid), kv.hget(`ctrial:${me.wid}`, god)]);
  let open = !!cards[god] || Number(best || 0) >= G.zone || !!done;
  if (!open && ID_RE.test(String(b.free || ''))) { const sh = parse(await kv.get(`ctshare:${b.free}`)); if (sh && sh.god === god) open = !!(await kv.set(`ctfree:${me.wid}:${god}`, 1, { nx: true, ex: 30 * 24 * 3600 })); }
  if (!open) return res.status(403).json({ error: `${G.name}의 시험은 아직 닫혀 있어요` });
  if (!b.ok) return res.status(200).json({ ok: true, passed: false });
  const t = Number(b.t), why = checkInputs(b.inputs, t, 41, true);
  if (why) return res.status(400).json({ error: '통과 기록을 확인할 수 없어요. 한 번 더 해 주세요.', why });
  const first = !done;
  if (first) { await kv.hset(`ctrial:${me.wid}`, { [god]: JSON.stringify({ at: Date.now(), t: Math.round(t * 10) / 10 }) }); }
  let card = false;
  if (!cards[god]) {
    const serial = await kv.incr(`cardserial:${god}`);
    cards[god] = { at: new Date().toISOString(), floor: CARD_NEED[god], serial, via: 'castle' };
    await kv.set(`cards:${me.wid}`, cards);
    await saveMemberRow(me, cards).catch(() => {});
    card = true;
  }
  return res.status(200).json({ ok: true, passed: true, first, card, unlock: await unlocks(me.wid) });
}

async function tshare(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  const cid = String(b.cid || '');
  if (!me && !CID_RE.test(cid)) return res.status(400).json({ error: 'bad cid' });
  const god = String(b.god || '');
  if (!TRIAL_GODS[god]) return res.status(400).json({ error: 'bad god' });
  const rk = `crate:${me ? me.wid : cid}`, n = await kv.incr(rk); if (n === 1) await kv.expire(rk, 3600);
  if (n > 30) return res.status(429).json({ error: '너무 많이 만들었어요. 잠시 뒤에 해 주세요.' });
  const id = newId(), nick = me ? me.nick : (cleanNick(b.nick).slice(0, 10) || '헬로');
  const d = { id, god, nick, t: Math.round(Number(b.t) * 10) / 10 || 0, at: Date.now() };
  await kv.set(`ctshare:${id}`, d, { ex: 3 * 24 * 3600 });
  return res.status(200).json({ id, link: `${SITE_ORIGIN}${PATH}?trial=${id}`, short: `${SITE_ORIGIN}/k/t${id}` });
}

// 짧은 주소 /k/{종류}{번호}: g 신들의 성 도전장 · t 신의 시험 · r 공략 다시보기 · c 내 성 도전장
async function sharePage(res, key) {
  const kind = key[0], id = key.slice(1);
  let title = '🏰 헬로 캐슬 · 헬로 대부도 오락실', desc = '몰래 들어가 보물을 털어라! 오락실에서 바로 해 보세요.', img = `${SITE_ORIGIN}${PATH}share/card_gods.jpg`, dest = `${SITE_ORIGIN}${PATH}`;
  if (kind === 'g' && ID_RE.test(id)) { const g = parse(await kv.get(`cghost:${id}`));
    if (g) { title = g.summit ? `🏛 ${g.nick}님이 올림포스 정상에 올랐어요! · ${g.row}줄` : `⛅ ${g.nick}님의 신들의 성 도전장 · ${g.row}줄`; desc = '오늘 자정까지 · 유령을 넘으면 승리 · 로그인 없이 바로'; img = `${SITE_ORIGIN}${PATH}share/${g.summit ? 'card_summit' : 'card_gods'}.jpg`; dest = `${SITE_ORIGIN}${PATH}?ghost=${id}`; }
    else desc = '기한이 지난 도전장이에요. 오늘의 신들의 성에 도전해 보세요!'; }
  if (kind === 't' && ID_RE.test(id)) { const g = parse(await kv.get(`ctshare:${id}`));
    if (g) { const nm = (TRIAL_GODS[g.god] || {}).name || ''; title = `${g.god === 'zeus' ? '⚡' : '🔱'} ${g.nick}님이 ${nm}의 시험을 통과했어요!`; desc = '이 주소로 들어오면 시험을 한 번 공짜로 받아 볼 수 있어요'; img = `${SITE_ORIGIN}${PATH}share/card_trial.jpg`; dest = `${SITE_ORIGIN}${PATH}?trial=${id}`; } }
  if (kind === 'r' && ID_RE.test(id)) { const r = parse(await kv.get(`craid:${id}`));
    if (r) { title = r.ok ? `🏴 ${r.an}님이 ${r.on}님의 성을 털었어요!` : `🛡️ ${r.on}님의 성이 ${r.an}님을 막아 냈어요`; desc = '공략 다시보기 · 로그인 없이 바로 보기'; img = `${SITE_ORIGIN}${PATH}share/card_raid.jpg`; dest = `${SITE_ORIGIN}${PATH}?raid=${id}`; } }
  if (kind === 'c' && WID_RE.test(id)) { const c = parse(await kv.get(`castle:${id}`));
    if (c && c.pub) { title = `🏰 ${c.nick}님의 성 · ${c.pub.len}줄 — 깨 봐!`; desc = '들어올 테면 와 봐 · 로그인 없이 바로 도전'; img = `${SITE_ORIGIN}${PATH}share/card_mycastle.jpg`; dest = `${SITE_ORIGIN}${PATH}?castle=${id}`; } }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=120');
  return res.status(200).send(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="헬로 대부도 오락실">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1122"><meta property="og:image:height" content="1402">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(dest)}">
</head><body style="background:#0b1a33;color:#fff;font-family:sans-serif;text-align:center;padding:40px 16px">
<p>헬로 캐슬을 여는 중…</p><p><a href="${esc(dest)}" style="color:#ffd23c">바로 가기</a></p>
<script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
}
