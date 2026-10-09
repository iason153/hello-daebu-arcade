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
