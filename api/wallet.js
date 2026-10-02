// /api/wallet.js — 올림포스 카드첩
//
//   GET  /api/wallet                 → 내 카드첩(로그인 필요)
//   GET  /api/wallet?w={카드첩주소}  → 그 사람의 카드첩(누구나 구경 가능). 남이 보면 구경 횟수 +1
//   GET  /api/wallet?list=1          → 수집가 광장(카드첩을 만든 모든 회원, 카드 많은 순 100명까지)
//   GET  /api/wallet?share={카드첩주소}[&g=카드]  → 자랑용 주소(/c/카드첩주소). 카톡·네이버 카페에 붙이면 그 사람의
//                                                 이름과 카드 그림이 미리보기로 뜨고, 누르면 카드첩으로 이동한다.
//   POST /api/wallet { action: 'claim', cards: [{ god, floor, at }] }  → 카드 등록(로그인 필요)
//   POST /api/wallet { action: 'nick',  nick }                         → 카드첩 이름표(닉네임) 바꾸기
//   POST /api/wallet { action: 'admin_check' }  (헤더 x-admin-secret)   → 관리자 비밀번호 확인(카드 발급 실제 테스트용)
//   POST /api/wallet { action: 'admin_reset' }  (헤더 x-admin-secret)   → 로그인한 관리자 본인의 카드만 지움(다시 테스트하려고)
//
// 내보내는 정보: 닉네임, 카드첩 주소, 카드 목록(얻은 날·획득 번호), 만든 날, 구경 횟수.
// 카카오 회원번호는 절대 내보내지 않는다.

import { kv } from '@vercel/kv';
import { GODS, CARD_NAME, SITE_ORIGIN, sessionUser, getUser, getCards, claimCards, cleanNick, isAdminRequest, saveMemberRow, listMembers } from './_session.js';

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

    // 자랑용 주소 — 링크 미리보기(오픈그래프)를 그 사람 카드로 만들어 주는 아주 작은 페이지
    if (q.share) {
      const swid = String(q.share).toLowerCase();
      const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      let title = '올림포스 카드첩', desc = '헬로타워에서 만난 대부도 친구들과 올림포스 신들의 카드를 모아 보세요.', img = `${SITE_ORIGIN}/assets/cards/share.jpg`;
      let dest = `${SITE_ORIGIN}/cardbook.html`;
      if (/^[a-z0-9]{4,16}$/.test(swid)) {
        const kid = await kv.get(`wid:${swid}`);
        const owner = kid ? await getUser(String(kid)) : null;
        if (owner) {
          const cards = await getCards(swid);
          const owned = GODS.filter((g) => cards[g]);
          const pick = GODS.includes(String(q.g)) && cards[String(q.g)] ? String(q.g) : owned[owned.length - 1];
          dest = `${SITE_ORIGIN}/cardbook.html?w=${swid}`;
          if (q.g && pick === String(q.g)) {
            title = `${owner.nick}님이 '${CARD_NAME[pick]}' 카드를 얻었어요!`;
            desc = `전체 ${cards[pick].serial}번째로 얻은 ${CARD_NAME[pick]} 카드 · 지금까지 ${owned.length}/${GODS.length}장 — 카드첩 구경하러 오세요.`;
          } else {
            title = `${owner.nick}님의 올림포스 카드첩 (${owned.length}/${GODS.length}장)`;
            desc = '헬로타워에서 모은 카드를 구경하러 오세요. 나도 카드첩을 만들 수 있어요!';
          }
          if (pick) img = `${SITE_ORIGIN}/assets/cards/og/${pick}.jpg`;
        }
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=300');
      return res.status(200).send(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="헬로 대부도 오락실">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(dest)}">
</head><body style="background:#0b0f24;color:#fff6d5;font-family:sans-serif;text-align:center;padding:40px 16px">
<p>카드첩으로 이동하는 중…</p><p><a href="${esc(dest)}" style="color:#f2c14e">바로 가기</a></p>
<script>location.replace(${JSON.stringify(dest)});</script></body></html>`);
    }

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
