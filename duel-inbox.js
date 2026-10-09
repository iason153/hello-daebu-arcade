// /duel-inbox.js — 내가 보낸 도전장의 결과 소식(window.HelloInbox)
// 친구가 내 도전장에 응전해서 승부가 나면 서버(api/duel.js)가 보낸 사람의 소식함에 한 줄을 넣는다.
// 회원은 회원 소식함, 로그인하지 않고 보냈으면 그 기기(hd_cid) 소식함. 둘 다 합쳐서 보여 준다.
// 어디까지 봤는지는 이 기기에만 기억한다(hd_inbox_seen).
//   HelloInbox.load()        → Promise<{ loggedIn, items, fresh }>
//   HelloInbox.markSeen()    → 지금까지 온 소식을 읽음으로
//   HelloInbox.itemEl(x, isNew, loggedIn) → 소식 한 줄(요소)
(function () {
  'use strict';
  var GAME = { hello_swing: { name: '헬로 스윙', unit: 'm', url: '/games/hello-swing/' }, hello_munch: { name: '헬로 먼치', unit: 'm', url: '/games/hello-munch/' } };
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function seenAt() { return Number(ls('hd_inbox_seen')) || 0; }
  function markSeen() { try { localStorage.setItem('hd_inbox_seen', String(Date.now())); } catch (e) {} }
  function load() {
    var c = ls('hd_cid'); if (!/^[a-z0-9]{8,24}$/.test(c)) c = '';
    return fetch('/api/duel?inbox=1' + (c ? '&cid=' + c : ''), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) { var s = seenAt(), items = (d && d.items) || []; return { loggedIn: !!(d && d.loggedIn), items: items, fresh: items.filter(function (x) { return x.at > s; }) }; })
      .catch(function () { return { loggedIn: false, items: [], fresh: [] }; });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function day(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + '시'; }
  function title(x) { return x.r === 'w' ? x.by + '님이 도전했지만 내가 지켰어요!' : x.by + '님이 내 도전장을 깼어요'; }
  function itemEl(x, isNew, loggedIn) {
    var G = GAME[x.g] || { name: x.g, unit: '', url: '/' }, row = el('div', 'hi-item ' + (x.r === 'w' ? 'w' : 'l') + (isNew ? ' new' : ''));
    row.appendChild(el('span', 'hi-ic', x.r === 'w' ? '🛡️' : '⚔️'));
    var mid = el('div', 'hi-mid');
    mid.appendChild(el('b', '', title(x)));
    mid.appendChild(el('small', '', G.name + ' · 내 ' + x.me + G.unit + ' / ' + x.by + ' ' + x.op + G.unit + ' · ' + day(x.at)));
    row.appendChild(mid);
    var right = el('div', 'hi-r');
    if (x.dr != null) right.appendChild(el('span', 'hi-dr ' + (x.dr > 0 ? 'up' : x.dr < 0 ? 'down' : ''), '명성 ' + (x.dr > 0 ? '+' : '') + x.dr));
    var a = el('a', 'hi-go', x.r === 'l' ? '반격하러 가기 →' : '또 보내기 →'); a.href = G.url; right.appendChild(a);
    row.appendChild(right);
    return row;
  }
  // 공용 모양(허브·결투장·게임 어디서나 같은 모양)
  (function style() {
    var s = document.createElement('style');
    s.textContent = '.hi-item{display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);text-align:left}' +
      '.hi-item.new{border-color:#ffc857;background:rgba(255,200,87,.1)}.hi-ic{font-size:20px;text-align:center}' +
      '.hi-mid{min-width:0}.hi-mid b{display:block;font-size:13.5px;line-height:1.35;word-break:keep-all}.hi-mid small{display:block;font-size:11.5px;opacity:.75;margin-top:2px}' +
      '.hi-r{text-align:right;display:grid;gap:3px;justify-items:end}.hi-dr{font-weight:800;font-size:12.5px;white-space:nowrap}.hi-dr.up{color:#4fd18b}.hi-dr.down{color:#ff8f86}' +
      '.hi-go{font-size:11.5px;font-weight:700;color:#ffc857;text-decoration:none;white-space:nowrap}.hi-go:hover{text-decoration:underline}';
    (document.head || document.documentElement).appendChild(s);
  })();
  window.HelloInbox = { load: load, markSeen: markSeen, itemEl: itemEl, title: title };
})();
