// 헬로 대부도 오락실 — 기록 확인표(조작 방지) 공용 모듈
// 게임을 시작할 때 서버에서 확인표를 받아 두었다가, 기록을 등록할 때(/api/score) 자동으로 함께 보낸다.
// 게임 코드는 HelloFair.start(게임키) 만 부르면 된다(각 게임의 track('game_start') 에 연결돼 있음).
(function () {
  'use strict';
  var me = document.currentScript;
  var pageGame = me && me.getAttribute('data-game') || '';
  var KEY = 'hf_ticket_';
  function put(game, t) { try { sessionStorage.setItem(KEY + game, t); } catch (e) {} mem[game] = t; }
  function get(game) { if (mem[game]) return mem[game]; try { return sessionStorage.getItem(KEY + game) || ''; } catch (e) { return ''; } }
  var mem = {};
  var rawFetch = window.fetch.bind(window);

  function start(game) {
    game = game || pageGame;
    if (!game) return;
    return rawFetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', game: game }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ticket) put(game, d.ticket); })
      .catch(function () {});
  }

  function note(text) {
    var n = document.createElement('div');
    n.textContent = text;
    n.style.cssText = 'position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:99999;max-width:86vw;background:#1d2b44;color:#fff;font:600 14px/1.5 system-ui,sans-serif;padding:12px 16px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.35);text-align:center';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 6000);
  }

  // /api/score 로 기록을 보낼 때 확인표를 자동으로 붙인다
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (init && String(init.method || '').toUpperCase() === 'POST' && url.split('?')[0].replace(location.origin, '') === '/api/score' && typeof init.body === 'string') {
        var body = JSON.parse(init.body);
        if (body && !body.action && body.game && !body.ticket) {
          body.ticket = get(body.game);
          init = Object.assign({}, init, { body: JSON.stringify(body) });
          return rawFetch(input, init).then(function (res) {
            res.clone().json().then(function (d) {
              if (d && d.pending) note('기록을 확인하고 있어요. 운영자 확인 후 랭킹에 올라가요.');
            }).catch(function () {});
            return res;
          });
        }
      }
    } catch (e) {}
    return rawFetch(input, init);
  };

  window.HelloFair = { start: start };
  // 페이지를 열 때도 한 장 받아 둔다(게임 시작 신호를 놓쳐도 확인표가 비지 않게). 이미 있으면 그대로 둔다 —
  // 로그인하고 돌아와 이어서 등록하는 기록은 그 판의 확인표를 써야 하기 때문.
  if (pageGame && !get(pageGame)) start(pageGame);
})();
