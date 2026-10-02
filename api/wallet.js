// /api/wallet.js — 올림포스 카드첩
//
//   GET  /api/wallet                 → 내 카드첩(로그인 필요)
//   GET  /api/wallet?w={카드첩주소}  → 그 사람의 카드첩(누구나 구경 가능). 남이 보면 구경 횟수 +1
//   GET  /api/wallet?list=1          → 수집가 광장(카드첩을 만든 모든 회원, 카드 많은 순 100명까지)
//   POST /api/wallet { action: 'claim', cards: [{ god, floor, at }] }  → 카드 등록(로그인 필요)
//   POST /api/wallet { action: 'nick',  nick }                         → 카드첩 이름표(닉네임) 바꾸기
//   POST /api/wallet { action: 'admin_check' }  (헤더 x-admin-secret)   → 관리자 비밀번호 확인(카드 발급 실제 테스트용)
//   POST /api/wallet { action: 'admin_reset' }  (헤더 x-admin-secret)   → 로그인한 관리자 본인의 카드만 지움(다시 테스트하려고)
//
// 내보내는 정보: 닉네임, 카드첩 주소, 카드 목록(얻은 날·획득 번호), 만든 날, 구경 횟수.
// 카카오 회원번호는 절대 내보내지 않는다.

import { kv } from '@vercel/kv';
import { GODS, sessionUser, getUser, getCards, claimCards, cleanNick, isAdminRequest, saveMemberRow, listMembers } from './_session.js';

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
        if (added.length) await saveMemberRow(me, cards);
        return res.status(200).json({ ok: true, added, cards: publicCards(cards), count: Object.keys(cards).length });
      }
      if (body.action === 'nick') {
        const nick = cleanNick(body.nick);
        if (!nick) return res.status(400).json({ error: 'nick required' });
        const u = await getUser(me.kid);
        u.nick = nick;
        await kv.set(`user:${me.kid}`, u);
        await saveMemberRow(u);
        return res.status(200).json({ ok: true, nick });
      }
      if (body.action === 'admin_check') {
        return res.status(200).json({ ok: isAdminRequest(req), nick: me.nick, wid: me.wid });
      }
      if (body.action === 'admin_reset') {
        if (!isAdminRequest(req)) return res.status(403).json({ error: 'admin only' });
        const cards = await getCards(me.wid);
        // 테스트로 받은 카드가 "전체 N번째" 번호를 차지하지 않게, 마지막 번호였다면 되돌려 놓는다
        for (const g of GODS) {
          if (!cards[g]) continue;
          const cur = Number(await kv.get(`cardserial:${g}`)) || 0;
          if (cur > 0 && cur === cards[g].serial) await kv.set(`cardserial:${g}`, cur - 1);
        }
        await kv.del(`cards:${me.wid}`);
        await saveMemberRow(me, {});
        return res.status(200).json({ ok: true, removed: Object.keys(cards) });
      }
      return res.status(400).json({ error: 'unknown action' });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

    const q = req.query || {};

    if (q.list) {
      // 수집가 광장이 생기기 전에 가입한 회원도 한 번에 명단에 올린다(처음 한 번만 실행)
      if (!(await kv.get('members_backfilled'))) {
        try {
          const keys = await kv.keys('user:*');
          for (const k of keys) { const u = await getUser(String(k).slice(5)); if (u && u.wid) await saveMemberRow(u); }
          await kv.set('members_backfilled', new Date().toISOString());
        } catch (e) { /* 실패하면 다음 조회 때 다시 시도 */ }
      }
      const rows = await listMembers();
      return res.status(200).json({ total: rows.length, collectors: rows.slice(0, 100).map((r) => ({ wid: r.wid, nick: r.nick, count: r.count, gods: r.gods })) });
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
    if (isMine) await saveMemberRow(me, cards); // 예전에 가입한 회원도 카드첩을 열면 수집가 광장 명단에 올라감
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
