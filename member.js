/* /member.js — 게임 화면 공용 "오락실 회원" 도우미 (헬로버드·헬로런·헬로먼치에서 사용)
 *
 * 하는 일
 *  1) 게임오버의 랭킹 등록 칸 맨 위에 회원 안내를 넣는다.
 *     - 로그인 전: 혜택 안내 + "카카오 로그인" 버튼
 *     - 로그인 후: "OO님으로 로그인됨" + 닉네임 자동 입력
 *  2) 로그인하러 다녀오면 게임 화면이 새로 열려 방금 기록이 사라지므로,
 *     로그인 버튼을 누를 때 방금 기록을 잠깐 적어 두었다가 돌아와서 "기록 등록" 창을 띄운다.
 *
 * 사용법(각 게임의 index.html):
 *   <script src="/member.js"></script>
 *   HelloMember.init({ game: 'hello_bird', unit: '점', path: '/games/hello-bird/', getScore: () => score, keys: ['hb_nickname', 'hb_contact'] });
 */
(function () {
  var KAKAO = '#fee500';
  function track(name, params) { try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) {} }
  function h(tag, css, text) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (text != null) n.textContent = text; return n; }
  function stop(n) { ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(function (ev) { n.addEventListener(ev, function (e) { e.stopPropagation(); }); }); }

  function init(cfg) {
    var panel = document.getElementById('rankPanel');
    if (!panel) return;
    var box = h('div', 'margin:0 0 8px;padding:8px;border-radius:10px;background:rgba(255,255,255,0.08);font-size:11px;line-height:1.45;color:#fff6d5;text-align:center;font-family:sans-serif;');
    panel.insertBefore(box, panel.firstChild);
    stop(box);
    var member = null;

    function render() {
      box.textContent = '';
      if (member) {
        box.appendChild(h('div', 'font-weight:bold;', '✅ ' + member.nick + '님으로 로그인됨'));
        box.appendChild(h('div', 'opacity:.85;', '등록하면 랭킹에서 이름 옆에 🎴가 붙고 내 카드첩으로 연결돼요.'));
        var n = document.getElementById('rankNickname');
        if (n && !n.value) n.value = member.nick;
        return;
      }
      box.appendChild(h('div', 'font-weight:bold;color:#ffe9a8;', '오락실 회원 혜택'));
      box.appendChild(h('div', 'opacity:.9;', '랭킹 이름 옆 🎴 표시 · 닉네임 자동 입력 · 올림포스 카드첩'));
      var b = h('button', 'margin-top:6px;width:100%;padding:8px;border:0;border-radius:999px;background:' + KAKAO + ';color:#191600;font-weight:bold;font-size:12px;cursor:pointer;', '💬 카카오 로그인하고 등록하기');
      b.type = 'button';
      b.addEventListener('click', function () {
        var s = 0; try { s = Number(cfg.getScore()) || 0; } catch (e) {}
        try { if (s > 0) sessionStorage.setItem('hello_pending', JSON.stringify({ game: cfg.game, score: s, at: Date.now() })); } catch (e) {}
        track('login_click', { from: cfg.game, score: s });
        location.href = '/api/auth?action=login&next=' + encodeURIComponent(cfg.path);
      });
      box.appendChild(b);
    }

    function pendingModal(p) {
      var wrap = h('div', 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(10,12,30,0.88);font-family:sans-serif;');
      var card = h('div', 'background:#1b2249;color:#fff6d5;border:2px solid #f2c14e;border-radius:18px;padding:18px;width:300px;max-width:92vw;text-align:center;');
      stop(wrap);
      card.appendChild(h('div', 'font-size:14px;', '로그인 완료! 방금 기록을 등록하세요'));
      card.appendChild(h('div', 'font-size:34px;font-weight:900;color:#ffd76a;margin:4px 0 10px;', p.score + cfg.unit));
      var inCss = 'width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border-radius:10px;border:0;font-size:15px;';
      var nick = h('input', inCss); nick.placeholder = '닉네임'; nick.maxLength = 12;
      var cont = h('input', inCss); cont.placeholder = '카카오톡 ID (당첨 연락용)'; cont.maxLength = 30;
      try { nick.value = localStorage.getItem(cfg.keys[0]) || member.nick; cont.value = localStorage.getItem(cfg.keys[1]) || ''; } catch (e) { nick.value = member.nick; }
      var go = h('button', 'margin-top:10px;padding:11px 18px;border-radius:999px;border:0;font-weight:800;font-size:15px;background:#ffd76a;color:#3a2a10;cursor:pointer;', '기록 등록하기'); go.type = 'button';
      var msg = h('div', 'margin-top:8px;font-size:13px;min-height:18px;');
      var close = h('button', 'margin-top:6px;background:transparent;border:0;color:#9aa3c7;font-size:13px;cursor:pointer;', '닫고 새 게임 하기'); close.type = 'button';
      close.addEventListener('click', function () { wrap.remove(); });
      go.addEventListener('click', async function () {
        var n = nick.value.trim(), c = cont.value.trim();
        if (!n || !c) { msg.textContent = '닉네임과 연락처를 모두 입력해주세요.'; return; }
        try { localStorage.setItem(cfg.keys[0], n); localStorage.setItem(cfg.keys[1], c); } catch (e) {}
        msg.textContent = '등록 중...';
        try {
          var res = await fetch('/api/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: cfg.game, nickname: n, contact: c, meters: p.score }) });
          if (!res.ok) { msg.textContent = '등록에 실패했어요. 다시 시도해주세요.'; return; }
          var d = await res.json().catch(function () { return {}; });
          msg.textContent = d.lower ? '이미 더 높은 기록(' + d.best + cfg.unit + ')이 랭킹에 있어요. 최고 기록만 남겨요.' : '등록됐어요! 🎉 랭킹에서 이름 옆 🎴를 확인해 보세요.';
          track('score_submit', { score: p.score, after_login: true });
          go.style.display = 'none'; close.textContent = '닫기';
        } catch (e) { msg.textContent = '네트워크 오류예요. 다시 시도해주세요.'; }
      });
      [nick, cont, go, msg, close].forEach(function (x) { card.appendChild(x); });
      wrap.appendChild(card); document.body.appendChild(wrap);
    }

    render();
    var back = false;
    try { var q = new URLSearchParams(location.search); if (q.has('login')) { back = q.get('login') === 'ok'; q.delete('login'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '')); } } catch (e) {}
    fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.loggedIn) { member = { nick: d.nick, wid: d.wid }; render(); }
      else if (d && d.ready === false) { box.style.display = 'none'; } // 로그인 기능이 꺼져 있으면 안내도 숨김
      if (back && member) {
        var p = null;
        try { p = JSON.parse(sessionStorage.getItem('hello_pending') || 'null'); sessionStorage.removeItem('hello_pending'); } catch (e) {}
        if (p && p.game === cfg.game && p.score > 0 && Date.now() - p.at < 15 * 60 * 1000) pendingModal(p);
      }
    }).catch(function () { box.style.display = 'none'; });
  }
  window.HelloMember = { init: init };
})();
