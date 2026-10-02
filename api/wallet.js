// /api/wallet.js — 올림포스 카드첩
//
//   GET  /api/wallet                 → 내 카드첩(로그인 필요)
//   GET  /api/wallet?w={카드첩주소}  → 그 사람의 카드첩(누구나 구경 가능). 남이 보면 구경 횟수 +1
//   GET  /api/wallet?list=1          → 수집가 순위(카드 많은 순 상위 30명)
//   POST /api/wallet { action: 'claim', cards: [{ god, floor, at }] }  → 카드 등록(로그인 필요)
//   POST /api/wallet { action: 'nick',  nick }                         → 카드첩 이름표(닉네임) 바꾸기
//
// 내보내는 정보: 닉네임, 카드첩 주소, 카드 목록(얻은 날·획득 번호), 만든 날, 구경 횟수.
// 카카오 회원번호는 절대 내보내지 않는다.

import { kv } from '@vercel/kv';
import { GODS, sessionUser, getUser, getCards, claimCards, cleanNick } from './_session.js';

const publicCards = (cards) => {
  const out = {};
  for (const g of GODS) if (cards[g]) out[g] = { at: cards[g].at, serial: cards[g].serial };
  return out;
};

export default async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const me = await sessionUser(req);

    if (req.method === 'POST') {
      if (!me) return res.status(401).json({ error: 'login required' });
      const body = req.body || {};
      if (body.action === 'claim') {
        const { cards, added } = await claimCards(me.wid, body.cards);
        return res.status(200).json({ ok: true, added, cards: publicCards(cards) });
      }
      if (body.action === 'nick') {
        const nick = cleanNick(body.nick);
        if (!nick) return res.status(400).json({ error: 'nick required' });
        const u = await getUser(me.kid);
        u.nick = nick;
        await kv.set(`user:${me.kid}`, u);
        return res.status(200).json({ ok: true, nick });
      }
      return res.status(400).json({ error: 'unknown action' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

    const q = req.query || {};

    if (q.list) {
      const wids = await kv.zrange('collectors', 0, 29, { rev: true });
      const list = [];
      for (const wid of wids) {
        const kid = await kv.get(`wid:${wid}`);
        const u = kid ? await getUser(String(kid)) : null;
        if (!u) continue;
        const cards = await getCards(wid);
        list.push({ wid, nick: u.nick, count: Object.keys(cards).length, gods: GODS.filter((g) => cards[g]) });
      }
      return res.status(200).json({ collectors: list });
    }

    let wid = String(q.w || '').toLowerCase();
    if (wid && !/^[a-z0-9]{4,16}$/.test(wid)) return res.status(400).json({ error: 'bad wallet' });
    if (!wid) {
      if (!me) return res.status(200).json({ loggedIn: false });
      wid = me.wid;
    }
    const isMine = !!me && me.wid === wid;
    let owner = isMine ? me : null;
    if (!owner) {
      const kid = await kv.get(`wid:${wid}`);
      owner = kid ? await getUser(String(kid)) : null;
    }
    if (!owner) return res.status(404).json({ error: 'not found' });

    const cards = await getCards(wid);
    let visits = Number(await kv.get(`visits:${wid}`)) || 0;
    if (!isMine) visits = await kv.incr(`visits:${wid}`);
    return res.status(200).json({
      loggedIn: !!me, isMine, wid, nick: owner.nick, createdAt: owner.createdAt,
      cards: publicCards(cards), count: Object.keys(cards).length, total: GODS.length, visits,
      myWid: me ? me.wid : null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
}
