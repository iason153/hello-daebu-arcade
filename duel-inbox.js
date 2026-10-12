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

  // ---- 휴대폰 알림 켜기(window.HelloPush) — 내 도전장의 승부가 나면 폰으로 알림
  // 안드로이드 크롬: 사이트에서 바로 / 아이폰: 홈 화면에 오락실을 설치한 경우에만 / 카톡 안 브라우저: 안 됨
  var UA = navigator.userAgent || '';
  function pushState() {
    if (/KAKAOTALK/i.test(UA)) return 'kakao';
    var ios = /iPhone|iPad|iPod/i.test(UA), standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (ios && !standalone) return 'ios'; // 아이폰은 홈 화면에 설치한 오락실에서만 알림이 된다
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'no';
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted' && ls('hd_push') === '1') return 'on';
    return 'off';
  }
  function b64(s) { var p = '='.repeat((4 - s.length % 4) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; }
  function post(body) { return fetch('/api/push', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (d) { d.__s = r.status; return d; }); }); }
  function enable() {
    var reg;
    return navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; })
      .then(function (r) { reg = r; return Notification.requestPermission(); })
      .then(function (perm) {
        if (perm !== 'granted') return 'denied';
        return fetch('/api/push', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (k) {
          if (!k || !k.key || !k.ready) return 'notready';
          return reg.pushManager.getSubscription().then(function (old) { return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.key) }); })
            .then(function (sub) { var c = ls('hd_cid'); return post({ action: 'subscribe', sub: sub.toJSON ? sub.toJSON() : sub, cid: /^[a-z0-9]{8,24}$/.test(c) ? c : '' }); })
            .then(function (r) { if (r && r.ok) { try { localStorage.setItem('hd_push', '1'); } catch (e) {} post({ action: 'test', cid: ls('hd_cid') }).catch(function () {}); return 'on'; } return 'error'; });
        });
      }).catch(function () { return 'error'; });
  }
  var MSG = { on: '🔔 알림이 켜져 있어요. 내 도전장의 승부가 나면 폰으로 알려 드려요.', kakao: '카톡 안에서는 알림을 켤 수 없어요. 오른쪽 위 메뉴에서 "다른 브라우저로 열기"를 눌러 주세요.',
    ios: '아이폰은 오락실을 홈 화면에 설치한 뒤에 알림을 켤 수 있어요. 공유 버튼 → "홈 화면에 추가".', no: '이 브라우저는 알림을 지원하지 않아요.',
    denied: '알림이 꺼져 있어요. 휴대폰 설정에서 이 사이트의 알림을 허용해 주세요.', notready: '알림 기능을 준비하고 있어요. 잠시 뒤에 다시 해 주세요.', error: '알림을 켜지 못했어요. 다시 해 주세요.' };
  // 알림 켜기 상자(보내기 창·결투장에서 씀)
  function box() {
    var w = el('div', 'hp-box'), st = pushState(), t = el('div', 'hp-t'), btn;
    w.appendChild(el('b', '', '🔔 결과를 휴대폰 알림으로 받기'));
    if (st === 'off') {
      t.textContent = '친구가 응전해서 승부가 나면 바로 알려 드려요.';
      btn = el('button', 'hp-btn', '알림 켜기'); btn.type = 'button';
      btn.addEventListener('click', function () { btn.disabled = true; btn.textContent = '켜는 중…'; enable().then(function (r) { t.textContent = MSG[r] || MSG.error; btn.remove(); try { if (typeof gtag === 'function') gtag('event', 'push_enable', { result: r }); } catch (e) {} }); });
      w.appendChild(t); w.appendChild(btn);
    } else { t.textContent = MSG[st]; w.appendChild(t); }
    return w;
  }
  (function () { var s2 = document.createElement('style'); s2.textContent = '.hp-box{margin-top:12px;padding:10px 12px;border-radius:14px;background:rgba(127,211,255,.1);border:1px solid rgba(127,211,255,.45);text-align:left}.hp-box b{display:block;font-size:14px}.hp-t{font-size:12.5px;opacity:.85;margin-top:3px;line-height:1.5;word-break:keep-all}.hp-btn{margin-top:8px;width:100%;border:none;border-radius:999px;padding:10px 0;font:inherit;font-weight:800;font-size:14px;background:#7fd3ff;color:#06243d;cursor:pointer}.hp-btn:disabled{opacity:.6}'; (document.head || document.documentElement).appendChild(s2); })();
  window.HelloPush = { state: pushState, enable: enable, box: box };
})();

// ---- 오락실 안에서 회원끼리 도전장 보내기(window.HelloMail) — 대표 결정 10/12
//   HelloMail.button(부모, { kind, getRef })  → "📮 오락실 친구에게 보내기" 버튼(로그인 회원에게만 붙인다)
//        kind: 'duel'(헬로 스윙·먼치) · 'ghost'(헬로 캐슬 신들의 성) · 'castle'(내 성),  getRef() → Promise<도전장 번호>
//   HelloMail.load()      → Promise<{ items, unread, seen }>  (로그인 안 했으면 items: [])
//   HelloMail.cardEl(x, isNew, onBlock) → 받은 도전장 한 장(요소)
//   HelloMail.markSeen()
// 받는 사람은 최근 상대(결투장·내 성) 또는 닉네임으로 찾는다. 하루 10통, 같은 사람에게 3통(서버가 지킨다).
(function () {
  'use strict';
  function api(q, body) {
    return fetch('/api/mail' + (body ? '' : '?' + q), body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.__s = r.status; return d; }); })
      .catch(function () { return { __s: 0, error: '인터넷 연결을 확인해 주세요' }; });
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function track(n, p) { try { if (typeof gtag === 'function') gtag('event', n, p || {}); } catch (e) {} }
  (function () { var s = document.createElement('style'); s.textContent =
    '.hm-btn{width:100%;margin-top:8px;border:2px solid #ffc857;border-radius:999px;padding:11px 0;font:inherit;font-weight:800;font-size:15px;background:rgba(255,200,87,.12);color:#ffe7a6;cursor:pointer}' +
    '.hm-layer{position:fixed;inset:0;z-index:9990;background:rgba(5,9,22,.82);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:24px 14px;box-sizing:border-box;font-family:inherit}' +
    '.hm-card{width:min(360px,100%);margin:auto;background:linear-gradient(180deg,#14284a,#0c1730);border:2px solid #ffc857;border-radius:20px;padding:16px;color:#fff;text-align:left;box-sizing:border-box}' +
    '.hm-card h3{margin:0 0 4px;font-size:19px;color:#ffc857}.hm-card p{margin:0 0 8px;font-size:12.5px;opacity:.82;line-height:1.5;word-break:keep-all}' +
    '.hm-sec{font-size:12px;font-weight:800;color:#ffc857;margin:12px 0 6px}' +
    '.hm-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.06);margin-top:6px}' +
    '.hm-row b{display:block;font-size:14.5px}.hm-row small{display:block;font-size:11.5px;opacity:.7}' +
    '.hm-row button{flex:0 0 auto;border:none;border-radius:999px;padding:7px 13px;font:inherit;font-weight:800;font-size:13px;background:#ffc857;color:#2a1c00;cursor:pointer}.hm-row button:disabled{opacity:.6}' +
    '.hm-find{display:flex;gap:6px}.hm-find input{flex:1;min-width:0;padding:9px 10px;border-radius:10px;border:none;font:inherit;font-size:15px;-webkit-user-select:text;user-select:text}' +
    '.hm-find button{border:none;border-radius:10px;padding:0 14px;font:inherit;font-weight:800;background:#2b5d8f;color:#fff}' +
    '.hm-msg{min-height:18px;font-size:13px;color:#9dffb0;margin-top:8px}.hm-msg.bad{color:#ff9a9a}' +
    '.hm-x{width:100%;margin-top:12px;border:none;border-radius:999px;padding:11px 0;font:inherit;font-weight:800;background:#2b4a80;color:#fff}' +
    '.hm-item{display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:center;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);text-align:left;margin-top:6px;color:inherit}' +
    '.hm-item.new{border-color:#ffc857;background:rgba(255,200,87,.1)}.hm-item .ic{font-size:21px;text-align:center}' +
    '.hm-item b{display:block;font-size:13.5px;line-height:1.35;word-break:keep-all}.hm-item small{display:block;font-size:11.5px;opacity:.75;margin-top:2px}' +
    '.hm-item .acts{grid-column:1/-1;display:flex;gap:6px;justify-content:flex-end}' +
    '.hm-item .go{border-radius:999px;padding:6px 13px;font-weight:800;font-size:13px;background:#ffc857;color:#2a1c00;text-decoration:none}' +
    '.hm-item .blk{border:none;background:none;color:inherit;opacity:.6;font:inherit;font-size:12px;text-decoration:underline;cursor:pointer}';
    (document.head || document.documentElement).appendChild(s); })();

  function pick(opt) {
    var layer = el('div', 'hm-layer'), card = el('div', 'hm-card'); layer.appendChild(card);
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) { layer.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    card.appendChild(el('h3', '', '📮 오락실 친구에게 보내기'));
    card.appendChild(el('p', '', '받은 사람의 오락실 첫 화면에 도전장이 도착해요(알림을 켠 사람은 휴대폰 알림도). 하루 10통, 같은 사람에게는 3통까지예요.'));
    var msg = el('div', 'hm-msg'), ref = null;
    function row(u, parent) {
      var r = el('div', 'hm-row'), info = el('div'); info.appendChild(el('b', '', u.nick)); if (u.why) info.appendChild(el('small', '', u.why)); r.appendChild(info);
      var b = el('button', '', '보내기'); b.type = 'button'; r.appendChild(b);
      b.addEventListener('click', function () {
        b.disabled = true; b.textContent = '보내는 중…'; msg.className = 'hm-msg'; msg.textContent = '';
        (ref ? Promise.resolve(ref) : Promise.resolve().then(opt.getRef)).then(function (id) { ref = id; return api(null, { action: 'send', to: u.wid, kind: opt.kind, ref: id || '' }); })
          .then(function (d) {
            if (d && d.ok) { b.textContent = '보냈어요 ✓'; msg.textContent = d.to + '님에게 보냈어요! 오늘 ' + d.left + '통 더 보낼 수 있어요.'; track('mail_send', { kind: opt.kind }); }
            else { b.disabled = false; b.textContent = '보내기'; msg.className = 'hm-msg bad'; msg.textContent = (d && d.error) || '보내지 못했어요'; }
          }).catch(function (e) { b.disabled = false; b.textContent = '보내기'; msg.className = 'hm-msg bad'; msg.textContent = (e && e.message) || '도전장을 만들지 못했어요'; });
      });
      parent.appendChild(r);
    }
    card.appendChild(el('div', 'hm-sec', '닉네임으로 찾기'));
    var f = el('div', 'hm-find'), inp = el('input'); inp.placeholder = '닉네임'; inp.maxLength = 12; var fb = el('button', '', '찾기'); fb.type = 'button'; f.appendChild(inp); f.appendChild(fb); card.appendChild(f);
    var found = el('div'); card.appendChild(found);
    function search() { var q = inp.value.trim(); if (!q) return; found.textContent = '찾는 중…';
      api('find=' + encodeURIComponent(q)).then(function (d) { found.textContent = ''; var l = (d && d.list) || []; if (!l.length) found.appendChild(el('p', '', '그런 닉네임의 회원이 없어요.')); l.forEach(function (u) { row(u, found); }); }); }
    fb.addEventListener('click', search); inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    card.appendChild(el('div', 'hm-sec', '최근 상대'));
    var rec = el('div', '', ''); rec.appendChild(el('p', '', '불러오는 중…')); card.appendChild(rec);
    api('recent=1').then(function (d) { rec.textContent = ''; var l = (d && d.list) || []; if (!l.length) rec.appendChild(el('p', '', '아직 겨뤄 본 상대가 없어요. 위에서 닉네임으로 찾아보세요.')); l.forEach(function (u) { row(u, rec); }); });
    card.appendChild(msg);
    var x = el('button', 'hm-x', '닫기'); x.type = 'button'; x.addEventListener('click', function () { layer.remove(); }); card.appendChild(x);
    document.body.appendChild(layer); track('mail_open', { kind: opt.kind });
  }
  function button(parent, opt) { var b = el('button', 'hm-btn', '📮 오락실 친구에게 보내기'); b.type = 'button'; b.addEventListener('click', function (e) { e.stopPropagation(); pick(opt); }); parent.appendChild(b); return b; }
  function load() { return api('box=1').then(function (d) { return { items: (d && d.items) || [], unread: (d && d.unread) || 0, seen: (d && d.seen) || 0, ok: d && d.__s === 200 }; }); }
  function left(ms) { var h = Math.max(0, Math.floor((ms - Date.now()) / 3600e3)); return h >= 24 ? Math.floor(h / 24) + '일 남음' : h + '시간 남음'; }
  function cardEl(x, isNew, onBlock) {
    var n = el('div', 'hm-item' + (isNew ? ' new' : ''));
    n.appendChild(el('span', 'ic', x.kind === 'castle' ? '🏰' : x.kind === 'ghost' ? '⛅' : '📮'));
    var mid = el('div'); mid.appendChild(el('b', '', x.from + '님의 ' + x.title)); mid.appendChild(el('small', '', (x.sub ? '"' + x.sub + '" · ' : '') + left(x.exp))); n.appendChild(mid);
    var acts = el('div', 'acts'), go = el('a', 'go', '도전하기 →'); go.href = x.link; go.addEventListener('click', function () { track('mail_open_challenge', { kind: x.kind }); });
    var blk = el('button', 'blk', '이 사람 도전장 안 받기'); blk.type = 'button';
    blk.addEventListener('click', function () { if (!confirm(x.from + '님의 도전장을 더 이상 받지 않을까요?')) return; api(null, { action: 'block', wid: x.fw }).then(function () { n.remove(); if (onBlock) onBlock(x); }); });
    acts.appendChild(blk); acts.appendChild(go); n.appendChild(acts); return n;
  }
  function markSeen() { return api(null, { action: 'seen' }); }
  window.HelloMail = { button: button, pick: pick, load: load, cardEl: cardEl, markSeen: markSeen };
})();
