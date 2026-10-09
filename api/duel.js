// /api/duel.js — 도전장(유령 대결)과 올림포스 결투장 기록
//
//   POST { action:'create', game, seed, dist, g:{x,y,a}, nick, msg, cid, ticket, from }
//        → 도전장 만들기. 3일 뒤 자동으로 사라진다. { id, exp, link }
//   GET  ?id=도전장번호[&cid=…]   → 도전장(맵 번호·유령 길·보낸 사람·한마디) + 이 도전장 순위표 + 내 상태
//   POST { action:'play', id, dist, cid, nick, ticket }
//        → 받은 사람의 한 판 결과. 3번 안에 보낸 사람 기록을 넘으면 승, 못 넘으면 패로 확정
//   POST { action:'claim', cid }  (로그인 필요)
//        → 로그인하기 전에 이 기기(cid)로 보낸 도전장·한 도전을 내 회원 기록으로 옮기고, 승패가 난 결투는 결투장에 기록
//   GET  ?share=도전장번호         → 짧은 주소(/d/번호)용 미리보기 페이지(카톡·카페에 붙였을 때 카드가 뜸) → 게임으로 이동
//   GET  ?arena=1                  → 올림포스 결투장 서열(명성 순)            ※ 2단계 화면에서 사용
//   GET  ?arena=카드첩주소         → 그 회원의 결투장 기록(로그인 회원만)      ※ 2단계 화면에서 사용
//
// KV 저장 구조
//   duel:{id}            → { id, game, seed, dist, g, nick, msg, wid, cid, at, exp, from, card }   (3일 뒤 자동 삭제)
//   duelplay:{id} (해시) → 도전자 → { nick, wid, tries, best, result, at }                          (도전장과 함께 삭제)
//   duelticket:{서명}    → 1   (같은 확인표로 두 번 기록하지 못하게, 6시간)
//   duelrate:{cid}       → 숫자 (한 사람이 1시간에 만들 수 있는 도전장 수 제한)
//   arena:{wid}          → { r(명성), w, l, g:{게임:{w,l}}, nick, at }   (결투장 기록 — 양쪽 다 로그인했을 때만)
//   arena:ladder (정렬)  → wid ↦ 명성
//   arenam:{wid} (목록)  → 최근 대결 200개
//   arenah:{wid1}:{wid2} → { wid: 이긴 횟수 }   (상대 전적)
//   arenapair:{wid1}:{wid2}:{날짜} → 횟수  (같은 두 사람은 하루 3번까지만 명성에 반영, 대표 결정 10/9)
//   inbox:w:{wid} / inbox:c:{cid} (목록) → 내가 보낸 도전장의 결과 소식 30개(14일)  — GET ?inbox=1&cid=…
//   cidx:{cid} (해시)    → 도전장번호 → 's'(보냄) | 'p'(도전함)   (로그인 전 기록을 로그인 뒤 이어 붙이기용, 4일)
//
// 기록은 기기가 보낸 값을 믿는 구조라(오락실 전체의 알려진 한계), 아래만 확인한다.
//   ① 게임 시작 확인표(score.js와 같은 방식)  ② 유령 길이 말이 되는지(한 칸 이동 거리·끝 위치와 기록 일치)
//   ③ 같은 확인표 재사용 금지  ④ 만들기 횟수 제한

import { kv } from '@vercel/kv';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { sessionUser, cleanNick, SITE_ORIGIN } from './_session.js';
import { sendPush, moveSubs } from './_push.js';

const GAMES = {
  hello_swing: { name: '헬로 스윙', path: '/games/hello-swing/', utm: 'swing_duel', unit: 'm', max: 5000, px: 40, maxStep: 90, maxDy: 240 },
};
// 정해진 한마디(아이들도 쓰므로 자유 입력은 받지 않는다) — duel.js(화면)와 순서가 같아야 한다
export const PHRASES = ['헬로~! 한 판 붙자', '100m도 못 갈걸?', '이거 이기면 인정!', '지는 사람 아이스크림!', '내 유령 따라올 수 있어?',
  '깃발에서 기다릴게', '봐줄 생각 없음', '대부도 최강은 나야', '한 번만 이겨 봐', '괴물보다 내가 더 무섭지?'];
const TTL = 3 * 24 * 3600;      // 도전장 기한 3일(대표 결정 10/8)
const TRIES = 1;                // 단판 승부(대표 결정 10/9, 처음엔 3번이었음)
const PAIR_PER_DAY = 3;         // 같은 두 사람의 결투는 하루 3번까지 명성에 반영(대표 결정 10/9)
const MAX_SAMPLES = 12000;      // 유령 점 최대 개수(1초 20점 × 10분)
const RATE_PER_HOUR = 30;
const K = 40, START = 1000;     // 명성 점수(엘로 방식). 대표 결정 10/9: 오르내림을 화려하게 → 같은 명성끼리 ±20, 최대 ±40

// ---- 게임 시작 확인표: score.js 와 같은 비밀값·같은 형식(그 파일은 건드리지 않으려고 여기 따로 둔다)
const TICKET_TTL = 6 * 3600 * 1000;
const PACE = { hello_swing: { perSec: 30, base: 60 } };
function ticketSig(game, t) {
  const secret = process.env.SESSION_SECRET || '';
  if (!secret) return '';
  return createHmac('sha256', secret).update(`ticket|${game}|${t}`).digest('hex').slice(0, 32);
}
function checkTicket(ticket, game, score) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 3) return { ok: false, why: '확인표 없음' };
  const [g, ts, sig] = parts;
  const t = Number(ts);
  const want = ticketSig(g, t);
  if (!want || g !== game || !Number.isFinite(t)) return { ok: false, why: '확인표 오류' };
  const a = Buffer.from(want), b = Buffer.from(String(sig));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, why: '확인표 오류' };
  const ms = Date.now() - t;
  if (ms < 0 || ms > TICKET_TTL) return { ok: false, why: '확인표 만료' };
  const pace = PACE[game];
  if (pace && score > pace.base + pace.perSec * (ms / 1000)) return { ok: false, why: '너무 빠름' };
  return { ok: true, sig };
}

const ID_RE = /^[a-z0-9]{8}$/;
const CID_RE = /^[a-z0-9]{8,24}$/;
const WID_RE = /^[a-z0-9]{4,16}$/;
function newId() { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'[b[i] % 31]; return s; }
const parse = (v) => { if (!v) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return null; } } return v; };
const kstDay = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 유령 길이 말이 되는지: 정수 배열 3개, 길이 같음, 한 점 사이 이동이 너무 크지 않음, 끝 위치가 기록과 맞음
function checkGhost(g, dist, G) {
  if (!g || !Array.isArray(g.x) || !Array.isArray(g.y) || !Array.isArray(g.a)) return '유령 기록 없음';
  const n = g.x.length;
  if (n < 2 || n > MAX_SAMPLES || g.y.length !== n || g.a.length !== n) return '유령 길이 오류';
  for (let i = 0; i < n; i++) {
    const x = g.x[i], y = g.y[i], a = g.a[i];
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(a) || a < -1 || a > 100000 || Math.abs(y) > 20000) return '유령 값 오류';
    if (i && (Math.abs(x - g.x[i - 1]) > G.maxStep || Math.abs(y - g.y[i - 1]) > G.maxDy)) return '유령 이동 오류';
  }
  if (Math.abs(Math.floor(Math.max(0, g.x[n - 1]) / G.px) - dist) > 2) return '유령 끝 위치 불일치';
  return '';
}

async function getDuel(id) { return ID_RE.test(id) ? parse(await kv.get(`duel:${id}`)) : null; }
async function getPlays(id) {
  const h = (await kv.hgetall(`duelplay:${id}`)) || {};
  return Object.entries(h).map(([k, v]) => Object.assign({ k }, parse(v) || {}));
}
// 순위표: 이긴 사람 먼저, 그다음 최고 기록 순
const order = (plays) => plays.slice().sort((a, b) => ((b.result === 'win') - (a.result === 'win')) || (b.best - a.best) || (a.at - b.at));
function board(plays) {
  return order(plays).map((p) => ({ nick: p.nick, wid: p.wid || null, best: p.best, tries: p.tries, result: p.result || null }));
}
function meOf(plays, key, self, loggedIn) {
  const mine = plays.find((p) => p.k === key);
  return { self, loggedIn, tries: mine ? mine.tries : 0, best: mine ? mine.best : 0, result: mine ? mine.result || null : null,
    rank: mine ? order(plays).findIndex((p) => p.k === key) + 1 : 0 };
}
function publicDuel(d) {
  return { id: d.id, game: d.game, seed: d.seed, dist: d.dist, g: d.g, nick: d.nick, msg: d.msg, phrase: PHRASES[d.msg] || '',
    wid: d.wid || null, at: d.at, exp: d.exp, from: d.from || null, card: d.card || null, tries: TRIES };
}
function linkFor(d) {
  const G = GAMES[d.game];
  return `${SITE_ORIGIN}${G.path}?duel=${d.id}&utm_source=kakaotalk&utm_medium=messenger&utm_campaign=${G.utm}`;
}

// ---- 올림포스 결투장: 양쪽 다 로그인한 대결이 확정되면 기록한다
// 칭호: 올림포스 견습생 → 전사 → 용사 → 영웅 → 반신. 모든 게임의 대결이 명성 하나로 합쳐진다(대표 결정 10/8).
// 점수가 내려가면 칭호도 내려간다(강등 있음, 대표 결정 10/8). 처음 3판까지는 견습생.
// 영웅·반신은 판 수도 채워야 한다(몇 판 운 좋게 이긴 사람이 바로 꼭대기에 서지 않게).
export const TIERS = [
  { name: '견습생', min: 0, games: 0 },
  { name: '전사', min: 980, games: 3 },
  { name: '용사', min: 1080, games: 3 },
  { name: '영웅', min: 1180, games: 10 },
  { name: '반신', min: 1300, games: 20 },
];
const tierOf = (r, n) => { let t = TIERS[0].name; for (const T of TIERS) if (r >= T.min && n >= T.games) t = T.name; return t; };
async function arenaGet(wid) { return parse(await kv.get(`arena:${wid}`)) || { r: START, w: 0, l: 0, g: {} }; }
async function arenaRecord(d, p) {
  const s = d.wid, c = p.wid;
  if (!s || !c || s === c) return null;
  const winner = p.result === 'win' ? c : s, loser = winner === c ? s : c;
  const [A, B] = await Promise.all([arenaGet(winner), arenaGet(loser)]);
  const pair = [s, c].sort();
  const pk = `arenapair:${pair[0]}:${pair[1]}:${kstDay()}`, cnt = await kv.incr(pk);
  if (cnt === 1) await kv.expire(pk, 2 * 24 * 3600);
  const rated = cnt <= PAIR_PER_DAY;
  let dA = 0, dB = 0;
  if (rated) { const ea = 1 / (1 + Math.pow(10, (B.r - A.r) / 400)); dA = Math.round(K * (1 - ea)); dB = -dA; }
  const now = Date.now();
  const bump = (X, win, delta, nick) => {
    X.r = Math.max(0, X.r + delta); X.nick = nick; X.at = now;
    if (win) X.w++; else X.l++;
    X.g = X.g || {}; const gg = X.g[d.game] = X.g[d.game] || { w: 0, l: 0 }; if (win) gg.w++; else gg.l++;
  };
  const nickOf = (w) => (w === s ? d.nick : p.nick);
  bump(A, true, dA, nickOf(winner)); bump(B, false, dB, nickOf(loser));
  const row = (me, opp, win, delta) => JSON.stringify({ d: d.id, g: d.game, o: opp, on: nickOf(opp), me: me === s ? d.dist : p.best, op: opp === s ? d.dist : p.best, r: win ? 'w' : 'l', role: me === s ? 's' : 'c', dr: delta, at: now });
  await Promise.all([
    kv.set(`arena:${winner}`, A), kv.set(`arena:${loser}`, B),
    kv.zadd('arena:ladder', { score: A.r, member: winner }, { score: B.r, member: loser }),
    kv.lpush(`arenam:${winner}`, row(winner, loser, true, dA)), kv.lpush(`arenam:${loser}`, row(loser, winner, false, dB)),
    kv.hincrby(`arenah:${pair[0]}:${pair[1]}`, winner, 1),
  ]);
  await Promise.all([kv.ltrim(`arenam:${winner}`, 0, 199), kv.ltrim(`arenam:${loser}`, 0, 199)]);
  return { rated: !!rated, delta: p.result === 'win' ? dA : dB };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'create') return await create(req, res, b);
      if (b.action === 'play') return await play(req, res, b);
      if (b.action === 'claim') return await claim(req, res, b);
      return res.status(400).json({ error: 'unknown action' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
    const q = req.query || {};
    if (q.share) return await sharePage(res, String(q.share).toLowerCase());
    if (q.arena) return await arena(req, res, String(q.arena));
    if (q.inbox) return await inbox(req, res, q);
    const d = await getDuel(String(q.id || '').toLowerCase());
    if (!d) return res.status(404).json({ error: 'gone' });
    const me = await sessionUser(req).catch(() => null);
    const cid = CID_RE.test(String(q.cid || '')) ? String(q.cid) : '';
    const plays = await getPlays(d.id);
    const key = me ? `w:${me.wid}` : cid ? `c:${cid}` : '';
    const self = !!((me && d.wid && me.wid === d.wid) || (cid && d.cid === cid));
    return res.status(200).json({ duel: publicDuel(d), board: board(plays).slice(0, 30), count: plays.length, me: meOf(plays, key, self, !!me) });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}

async function create(req, res, b) {
  const G = GAMES[b.game];
  if (!G) return res.status(400).json({ error: 'invalid game' });
  const cid = String(b.cid || '');
  if (!CID_RE.test(cid)) return res.status(400).json({ error: 'bad cid' });
  const dist = Number(b.dist), seed = Number(b.seed), msg = Number(b.msg);
  if (!Number.isInteger(dist) || dist < 1 || dist > G.max) return res.status(400).json({ error: '기록이 올바르지 않아요' });
  if (!Number.isInteger(seed) || seed < 1 || seed > 2147483647) return res.status(400).json({ error: 'bad seed' });
  if (!Number.isInteger(msg) || msg < 0 || msg >= PHRASES.length) return res.status(400).json({ error: 'bad msg' });
  const bad = checkGhost(b.g, dist, G);
  if (bad) return res.status(400).json({ error: '기록을 확인할 수 없어요', why: bad });
  const tk = checkTicket(b.ticket, b.game, dist);
  if (!tk.ok) return res.status(400).json({ error: '기록을 확인할 수 없어요. 한 판 더 하고 보내 주세요.', why: tk.why });
  const rk = `duelrate:${cid}`, n = await kv.incr(rk);
  if (n === 1) await kv.expire(rk, 3600);
  if (n > RATE_PER_HOUR) return res.status(429).json({ error: '도전장을 너무 많이 만들었어요. 잠시 뒤에 다시 해 주세요.' });
  const me = await sessionUser(req).catch(() => null);
  const nick = me ? me.nick : (cleanNick(b.nick).slice(0, 10) || '헬로');
  const now = Date.now();
  const from = ID_RE.test(String(b.from || '')) ? String(b.from) : null;
  let id = newId();
  for (let i = 0; i < 3 && (await kv.exists(`duel:${id}`)); i++) id = newId();
  const d = { id, game: b.game, seed, dist, g: { x: b.g.x, y: b.g.y, a: b.g.a }, nick, msg, wid: me ? me.wid : null, cid, at: now, exp: now + TTL * 1000, from, card: null };
  await kv.set(`duel:${id}`, d, { ex: TTL });
  if (!me) await markCid(cid, id, 's');
  return res.status(200).json({ id, exp: d.exp, nick, link: linkFor(d), short: `${SITE_ORIGIN}/d/${id}` });
}

async function play(req, res, b) {
  const d = await getDuel(String(b.id || '').toLowerCase());
  if (!d) return res.status(404).json({ error: 'gone' });
  const me = await sessionUser(req).catch(() => null);
  const cid = CID_RE.test(String(b.cid || '')) ? String(b.cid) : '';
  if (!me && !cid) return res.status(400).json({ error: 'bad cid' });
  const dist = Number(b.dist);
  if (!Number.isInteger(dist) || dist < 0 || dist > GAMES[d.game].max) return res.status(400).json({ error: 'bad dist' });
  const self = !!((me && d.wid && me.wid === d.wid) || (cid && d.cid === cid));
  const key = me ? `w:${me.wid}` : `c:${cid}`;
  const hk = `duelplay:${d.id}`;
  const out = async (extra) => {
    const plays = await getPlays(d.id);
    return res.status(200).json(Object.assign({ board: board(plays).slice(0, 30), count: plays.length, me: meOf(plays, key, self, !!me) }, extra));
  };
  if (self) return out({ practice: true, why: 'self' });
  let rec = parse(await kv.hget(hk, key));
  if (rec && rec.result) return out({ practice: true, why: 'done' });
  const tk = checkTicket(b.ticket, d.game, dist);
  if (!tk.ok) return out({ practice: true, why: 'ticket', detail: tk.why });
  const fresh = await kv.set(`duelticket:${tk.sig}`, 1, { nx: true, ex: 6 * 3600 });
  if (!fresh) return out({ practice: true, why: 'reused' });
  rec = rec || { nick: me ? me.nick : (cleanNick(b.nick).slice(0, 10) || '손님'), wid: me ? me.wid : null, tries: 0, best: 0, result: null, at: Date.now() };
  if (me) { rec.nick = me.nick; rec.wid = me.wid; }
  rec.tries++; rec.best = Math.max(rec.best, dist); rec.at = Date.now();
  if (dist > d.dist) rec.result = 'win'; else if (rec.tries >= TRIES) rec.result = 'lose';
  let arenaRes = null;
  if (rec.result && !rec.arena) { arenaRes = await arenaRecord(d, rec).catch(() => null); if (arenaRes) rec.arena = 1; }
  await kv.hset(hk, { [key]: JSON.stringify(rec) });
  await kv.expire(hk, Math.max(60, Math.ceil((d.exp - Date.now()) / 1000)));
  if (!me) await markCid(cid, d.id, 'p');
  if (rec.result) await pushInbox(d, rec, arenaRes).catch(() => {});
  return out({ practice: false, win: dist > d.dist, arena: arenaRes });
}

// 보낸 사람에게 가는 결과 소식(보낸 사람 입장: r='w' 내가 지킴, 'l' 깨짐). 회원이면 회원 소식함, 아니면 그 기기 소식함
async function pushInbox(d, rec, arenaRes) {
  const k = d.wid ? `inbox:w:${d.wid}` : `inbox:c:${d.cid}`;
  const item = { id: d.id, g: d.game, by: rec.nick, bw: rec.wid || null, r: rec.result === 'win' ? 'l' : 'w', me: d.dist, op: rec.best,
    dr: arenaRes && arenaRes.rated ? -arenaRes.delta : null, at: Date.now() };
  await kv.lpush(k, JSON.stringify(item));
  await kv.ltrim(k, 0, 29);
  await kv.expire(k, 14 * 24 * 3600);
  // 휴대폰 알림(켜 둔 사람만). 받는 열쇠는 소식함과 같다(inbox:w:… → push:w:…)
  const G = GAMES[d.game] || { name: '', unit: 'm' }, dr = item.dr != null ? ` · 명성 ${item.dr > 0 ? '+' : ''}${item.dr}` : '';
  await sendPush(k.slice(6), {
    title: item.r === 'w' ? '🛡️ 내 도전장을 지켰어요!' : '⚔️ 내 도전장이 깨졌어요!',
    body: `${rec.nick}님이 응전했어요 · 내 ${d.dist}${G.unit} / ${rec.nick} ${rec.best}${G.unit}${dr}` + (item.r === 'l' ? ' · 반격하러 가요!' : ''),
    url: '/?utm_source=push&utm_medium=notification&utm_campaign=duel_result', tag: 'duel-' + d.id,
  }).catch(() => 0);
}
async function inbox(req, res, q) {
  const me = await sessionUser(req).catch(() => null);
  const cid = CID_RE.test(String(q.cid || '')) ? String(q.cid) : '';
  const lists = await Promise.all([me ? kv.lrange(`inbox:w:${me.wid}`, 0, 29) : [], cid ? kv.lrange(`inbox:c:${cid}`, 0, 29) : []]);
  const seen = new Set(), items = [];
  lists.flat().map(parse).filter(Boolean).sort((a, b) => b.at - a.at).forEach((x) => { const k = x.id + '|' + x.by + '|' + x.at; if (!seen.has(k)) { seen.add(k); items.push(x); } });
  return res.status(200).json({ loggedIn: !!me, items: items.slice(0, 30) });
}

async function markCid(cid, id, role) {
  const k = `cidx:${cid}`;
  await kv.hset(k, { [id]: role });
  await kv.expire(k, 4 * 24 * 3600);
}

// 로그인 뒤 이어 붙이기: 같은 기기(cid)로 로그인 전에 보낸 도전장과 한 도전을 내 회원 기록으로 옮긴다.
// 이미 승패가 난 결투는 이때 결투장에 기록한다(상대도 회원일 때). 다른 기기에서 로그인하면 이어지지 않는다.
async function claim(req, res, b) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  const cid = String(b.cid || '');
  if (!CID_RE.test(cid)) return res.status(400).json({ error: 'bad cid' });
  const idx = (await kv.hgetall(`cidx:${cid}`)) || {};
  let moved = 0, recorded = 0, waiting = 0;
  for (const [id, role] of Object.entries(idx)) {
    const d = await getDuel(id);
    if (!d) continue;
    const hk = `duelplay:${d.id}`, left = Math.max(60, Math.ceil((d.exp - Date.now()) / 1000));
    if (role === 's' && d.cid === cid && !d.wid) {
      d.wid = me.wid; await kv.set(`duel:${d.id}`, d, { ex: left }); moved++;
      // 내가 회원이 되기 전에 끝난, 회원과의 결투를 이제 기록
      const plays = await getPlays(d.id);
      for (const p of plays) {
        if (!p.result || p.arena || !p.wid || p.wid === me.wid) continue;
        const r = await arenaRecord(Object.assign({}, d, { nick: me.nick }), p).catch(() => null); // 결투장에는 회원 이름으로
        if (r) { p.arena = 1; recorded++; const { k, ...rest } = p; await kv.hset(hk, { [k]: JSON.stringify(rest) }); }
      }
    }
    if (role === 'p') {
      const ck = `c:${cid}`, wk = `w:${me.wid}`;
      const a = parse(await kv.hget(hk, ck));
      if (!a) continue;
      if (d.wid && d.wid === me.wid) { await kv.hdel(hk, ck); continue; } // 내 도전장에 손님으로 한 판은 연습으로 친다
      const w = parse(await kv.hget(hk, wk));
      const rec = w ? { nick: me.nick, wid: me.wid, tries: Math.min(TRIES, w.tries + a.tries), best: Math.max(w.best, a.best), at: Math.max(w.at, a.at),
        result: (w.result === 'win' || a.result === 'win') ? 'win' : (w.result || a.result || (w.tries + a.tries >= TRIES ? 'lose' : null)), arena: w.arena || a.arena }
        : Object.assign({}, a, { nick: me.nick, wid: me.wid });
      if (rec.result && !rec.arena && d.wid) { const r = await arenaRecord(d, rec).catch(() => null); if (r) { rec.arena = 1; recorded++; } }
      else if (rec.result && !d.wid) waiting++;
      await kv.hdel(hk, ck); await kv.hset(hk, { [wk]: JSON.stringify(rec) }); await kv.expire(hk, left);
      moved++;
    }
  }
  await kv.del(`cidx:${cid}`);
  await moveSubs(`c:${cid}`, `w:${me.wid}`).catch(() => {}); // 로그인 전에 켠 휴대폰 알림도 회원에게로
  return res.status(200).json({ ok: true, moved, recorded, waiting });
}

// 짧은 주소 /d/번호 — 카톡·카페에 주소를 붙였을 때 도전장 카드가 미리보기로 뜨고, 누르면 게임으로 간다
async function sharePage(res, id) {
  const d = await getDuel(id);
  let title = '헬로 대부도 오락실 도전장', desc = '기한이 지난 도전장이에요. 오락실에서 새로 도전해 보세요!',
    img = `${SITE_ORIGIN}/games/hello-swing/assets/thumb-helloswing-wide.jpg`, dest = `${SITE_ORIGIN}/`;
  if (d && GAMES[d.game]) {
    const G = GAMES[d.game];
    title = `🔥 ${d.nick}님의 ${G.name} 도전장 · ${d.dist}${G.unit}`;
    desc = `"${PHRASES[d.msg] || ''}" ${d.dist}${G.unit}를 넘으면 승리 · 단판 승부 · 로그인 없이 바로`;
    if (d.card) img = d.card;
    dest = `${SITE_ORIGIN}${G.path}?duel=${d.id}`;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=120');
  return res.status(200).send(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="헬로 대부도 오락실">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="600">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(dest)}">
</head><body style="background:#0e1a2b;color:#fff;font-family:sans-serif;text-align:center;padding:40px 16px">
<p>도전장을 여는 중…</p><p><a href="${esc(dest)}" style="color:#ffc857">바로 가기</a></p>
<script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
}

// 올림포스 결투장(2단계 화면용 자료) — 로그인 회원만
async function arena(req, res, who) {
  const me = await sessionUser(req).catch(() => null);
  if (!me) return res.status(401).json({ error: 'login required' });
  if (who === '1') {
    const rows = (await kv.zrange('arena:ladder', 0, 99, { rev: true, withScores: true })) || [];
    const out = [];
    for (let i = 0; i < rows.length; i += 2) out.push({ wid: rows[i], r: Number(rows[i + 1]) });
    const stats = await Promise.all(out.map((o) => arenaGet(o.wid)));
    const mine = await arenaGet(me.wid);
    return res.status(200).json({ me: me.wid, myNick: me.nick, tiers: TIERS, START,
      mine: { r: mine.r, w: mine.w, l: mine.l, games: mine.g || {}, tier: tierOf(mine.r, mine.w + mine.l), rank: out.findIndex((o) => o.wid === me.wid) + 1 },
      ladder: out.map((o, i) => ({ rank: i + 1, wid: o.wid, nick: stats[i].nick || '', r: o.r, tier: tierOf(o.r, stats[i].w + stats[i].l), w: stats[i].w, l: stats[i].l })) });
  }
  if (!WID_RE.test(who)) return res.status(400).json({ error: 'bad wid' });
  const [st, list] = await Promise.all([arenaGet(who), kv.lrange(`arenam:${who}`, 0, 49)]);
  const pair = [me.wid, who].sort();
  const h2h = who === me.wid ? null : ((await kv.hgetall(`arenah:${pair[0]}:${pair[1]}`)) || {});
  return res.status(200).json({ wid: who, isMe: who === me.wid, nick: st.nick || (who === me.wid ? me.nick : ''), tiers: TIERS, r: st.r, tier: tierOf(st.r, st.w + st.l), w: st.w, l: st.l, games: st.g || {},
    recent: (list || []).map(parse).filter(Boolean),
    vsMe: h2h ? { myWins: Number(h2h[me.wid] || 0), theirWins: Number(h2h[who] || 0) } : null });
}
