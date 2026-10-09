// /duel.js — 헬로 대부도 오락실 도전장(유령 대결) 공용 화면  ·  window.HelloDuel
//
// 게임은 아래만 하면 된다(헬로 스윙 참고).
//   HelloDuel.init({ game, name, unit, bgSrc, heroSrc, getRun, onDuel, onStart, onLeave, track, statEl, titleEl, subEl, retryBtn, sendBtn })
//     getRun()      → 방금 끝난 판 { seed, dist, g:{x:[],y:[],a:[]} }  (정수 배열)
//     onDuel(duel)  → 도전장을 열었을 때: 맵 번호(duel.seed)와 유령(duel.g)을 게임에 넣고 시작 대기 상태로
//     onStart()     → [도전 시작]을 눌렀을 때 게임 시작
//     onLeave()     → [도전 없이 혼자 하기]: 유령을 지우고 평소 게임으로
//   HelloDuel.finish(score) → 판이 끝났을 때(도전 중이면 서버에 기록)
//   HelloDuel.render()      → 결과 화면을 띄울 때(도전 결과 문구·남은 기회·버튼 글자)
//   HelloDuel.openSend()    → [도전장 보내기]
//
// 받는 사람은 로그인 없이 도전한다. 이 기기를 구분하는 무작위 번호(hd_cid)만 쓴다.
(function () {
  'use strict';
  var PHRASES = ['헬로~! 한 판 붙자', '100m도 못 갈걸?', '이거 이기면 인정!', '지는 사람 아이스크림!', '내 유령 따라올 수 있어?',
    '깃발에서 기다릴게', '봐줄 생각 없음', '대부도 최강은 나야', '한 번만 이겨 봐', '괴물보다 내가 더 무섭지?']; // api/duel.js 와 같은 순서
  var TRIES = 1; // 단판 승부(대표 결정 10/9). 서버가 알려 주는 값(duel.tries)으로 덮어쓴다
  var CFG = null, D = null, last = null, busy = null, auth = { loggedIn: false, nick: '' }, sent = {}, phr = 0, openLayer = null;

  function rand(n) { var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = ''; for (var i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function cid() {
    try { var c = localStorage.getItem('hd_cid'); if (!/^[a-z0-9]{8,24}$/.test(c || '')) { c = rand(16); localStorage.setItem('hd_cid', c); } return c; }
    catch (e) { return window.__hdcid || (window.__hdcid = rand(16)); }
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function track(n, p) { try { if (CFG && CFG.track) CFG.track(n, p || {}); } catch (e) {} }
  function dots(left) { var s = ''; for (var i = 0; i < TRIES; i++) s += i < left ? '●' : '○'; return s; }
  function when(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + '시'; }
  function toast(t) {
    var n = el('div', 'hd-toast', t); document.body.appendChild(n);
    setTimeout(function () { n.classList.add('out'); setTimeout(function () { n.remove(); }, 400); }, 2600);
  }
  function api(method, body, qs) {
    return fetch('/api/duel' + (qs || ''), method === 'GET' ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.__status = r.status; return d; }); });
  }

  // ------------------------------------------------------------------ 스타일
  function style() {
    if (document.getElementById('hd-style')) return;
    var s = el('style'); s.id = 'hd-style';
    s.textContent = [
      '.hd-layer{position:fixed;inset:0;z-index:30;background:rgba(5,9,22,.8);display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:max(18px,env(safe-area-inset-top)) 14px 24px;box-sizing:border-box;font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#eef3ff;-webkit-user-select:none;user-select:none}',
      '.hd-layer[hidden]{display:none!important}',
      '.hd-card{width:min(340px,100%);margin:auto;background:linear-gradient(180deg,#14284a,#0c1730);border:2px solid #ffc857;border-radius:22px;padding:18px 16px 16px;box-shadow:0 10px 40px rgba(0,0,0,.5);text-align:center;box-sizing:border-box}',
      '.hd-tag{display:inline-block;font-size:12px;font-weight:700;color:#0c1730;background:#ffc857;border-radius:999px;padding:3px 10px}',
      '.hd-who{font-family:"Jua",sans-serif;font-size:30px;line-height:1.25;margin:10px 0 4px;color:#fff;text-wrap:balance}',
      '.hd-bub{display:inline-block;background:#fff;color:#1d2b44;font-weight:800;font-size:15px;border-radius:14px;padding:7px 12px;margin:4px 0 10px;position:relative}',
      '.hd-bub:after{content:"";position:absolute;left:22px;bottom:-7px;border:7px solid transparent;border-top-color:#fff;border-bottom:0}',
      '.hd-goal{font-family:"Jua",sans-serif;font-size:58px;line-height:1;color:#ffc857;text-shadow:0 0 18px rgba(255,200,87,.5)}',
      '.hd-goal small{display:block;font-family:"Noto Sans KR",sans-serif;font-size:14px;font-weight:700;color:#fff;text-shadow:none;margin-top:6px}',
      '.hd-chance{margin:12px 0 4px;font-size:14px;font-weight:700;color:#bfe6ff}.hd-chance b{color:#ffc857;letter-spacing:2px;font-size:16px}',
      '.hd-exp{font-size:12px;color:#9fb0d8;margin-bottom:12px}',
      '.hd-go{width:100%;border:none;border-radius:999px;padding:14px 0;font-size:20px;font-weight:900;color:#2a1c00;background:#ffc857;box-shadow:0 4px 0 #b8862b;cursor:pointer;font-family:inherit}',
      '.hd-go:active{transform:translateY(2px);box-shadow:0 2px 0 #b8862b}',
      '.hd-sub{font-size:12px;color:#c9d3f2;margin-top:8px}',
      '.hd-board{margin-top:16px;text-align:left;background:rgba(0,0,0,.25);border-radius:14px;padding:10px 12px}',
      '.hd-board h3{margin:0 0 6px;font-size:13px;color:#ffc857}',
      '.hd-row{display:grid;grid-template-columns:22px 1fr auto auto;gap:8px;align-items:center;font-size:13px;padding:4px 0;border-top:1px solid rgba(255,255,255,.08)}',
      '.hd-row:first-of-type{border-top:0}.hd-row .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.hd-row .m{font-variant-numeric:tabular-nums;color:#fff;font-weight:700}',
      '.hd-badge{font-size:11px;font-weight:800;border-radius:999px;padding:2px 7px}.hd-badge.w{background:#3ad17a;color:#04220f}.hd-badge.l{background:#5a6487;color:#fff}.hd-badge.p{background:#2b5d8f;color:#fff}',
      '.hd-empty{font-size:12px;color:#9fb0d8;padding:4px 0}',
      '.hd-solo{margin-top:12px;background:none;border:none;color:#9fb0d8;font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit}',
      '.hd-sheet{z-index:60}',
      '.hd-sheet .hd-card{text-align:left}',
      '.hd-x{float:right;background:none;border:none;color:#9fb0d8;font-size:22px;line-height:1;cursor:pointer;padding:0 2px}',
      '.hd-h{font-family:"Jua",sans-serif;font-size:24px;color:#ffc857;margin:0 0 4px}',
      '.hd-p{font-size:13px;color:#c9d3f2;margin:0 0 10px;line-height:1.5}',
      '.hd-l{font-size:12px;color:#ffc857;font-weight:700;margin:12px 0 6px}',
      '.hd-in{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:none;font-size:15px;-webkit-user-select:text;user-select:text;font-family:inherit}',
      '.hd-in[readonly]{background:#2a3658;color:#fff}',
      '.hd-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.hd-chips button{background:#22304f;color:#fff;border:1px solid #3a4c78;border-radius:999px;padding:6px 10px;font-size:12.5px;cursor:pointer;font-family:inherit}',
      '.hd-chips button[aria-pressed="true"]{background:#ffc857;color:#2a1c00;border-color:#ffc857;font-weight:700}',
      '.hd-prev{width:100%;aspect-ratio:2/1;max-width:100%;border-radius:12px;display:block;background:#0a1226}',
      '.hd-kakao{width:100%;margin-top:12px;border:none;border-radius:12px;padding:13px 0;font-size:16px;font-weight:800;background:#fee500;color:#191600;cursor:pointer;font-family:inherit}',
      '.hd-copy{width:100%;margin-top:8px;border:1px solid #3a4c78;border-radius:12px;padding:11px 0;font-size:14px;font-weight:700;background:#22304f;color:#fff;cursor:pointer;font-family:inherit}',
      '.hd-kakao:disabled,.hd-copy:disabled{opacity:.6}',
      '.hd-msg{font-size:12.5px;color:#bfe6ff;margin-top:8px;min-height:16px;line-height:1.5;word-break:break-all}',
      '.hd-note{font-size:11.5px;color:#9fb0d8;margin-top:8px;line-height:1.5}',
      '.hd-stat{margin:0 0 12px;background:rgba(10,20,44,.85);border:1.5px solid #3a4c78;border-radius:14px;padding:10px 12px;font-size:13px;line-height:1.6;text-align:left;color:#eef3ff}',
      '.hd-stat b{color:#ffc857}.hd-stat .big{font-size:15px;font-weight:800;color:#fff}.hd-stat .dim{color:#9fb0d8;font-size:12px}',
      '.hd-loginbox{margin-top:12px;background:rgba(254,229,0,.08);border:1px solid rgba(254,229,0,.4);border-radius:14px;padding:10px 12px;text-align:center}',
      '.hd-loginbox.strong{background:linear-gradient(180deg,rgba(255,200,87,.18),rgba(255,200,87,.06));border:2px solid #ffc857}',
      '.hd-loginbox .lt{font-weight:800;font-size:14px;color:#fff;text-wrap:balance;word-break:keep-all}.hd-loginbox.strong .lt{font-size:16px;color:#ffc857}.hd-loginbox .ls{font-size:12px;color:#c9d3f2;margin-top:2px;word-break:keep-all}',
      '.hd-kbtn{display:block;margin-top:8px;background:#fee500;color:#191600;font-weight:800;font-size:14px;text-decoration:none;border-radius:999px;padding:10px 0}',
      '.hd-toast{position:fixed;left:50%;bottom:12%;transform:translateX(-50%);z-index:70;background:rgba(0,0,0,.88);color:#fff;padding:11px 18px;border-radius:999px;font-size:13px;font-weight:700;max-width:86vw;text-align:center;transition:opacity .3s}',
      '.hd-toast.out{opacity:0}',
      '.hd-layer button:focus-visible,.hd-layer input:focus-visible{outline:2px solid #ffc857;outline-offset:2px}',
    ].join('\n');
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ 로그인 유도(10/8 대표: 로그인을 유도하게)
  // 로그인하면 같은 화면으로 돌아오고, 로그인 전에 이 기기로 한 도전·보낸 도전장은 claim으로 이어 붙는다.
  function loginUrl(where) {
    var next = location.pathname + (D ? '?duel=' + D.duel.id : '');
    return '/api/auth?action=login&next=' + encodeURIComponent(next);
  }
  function loginBox(title, sub, btn, where, strong) {
    var b = el('div', 'hd-loginbox' + (strong ? ' strong' : ''));
    b.appendChild(el('div', 'lt', title)); if (sub) b.appendChild(el('div', 'ls', sub));
    var a = el('a', 'hd-kbtn', btn); a.href = loginUrl(where);
    a.addEventListener('click', function () { lsSet('hd_claim', '1'); track('duel_login_click', { where: where }); });
    b.appendChild(a); return b;
  }
  var claimP = null;
  function claim() {
    if (!auth.loggedIn || lsGet('hd_claim') !== '1') return Promise.resolve(null);
    return api('POST', { action: 'claim', cid: cid() }).then(function (r) {
      if (r && r.ok) {
        lsSet('hd_claim', '');
        track('duel_claim', { moved: r.moved, recorded: r.recorded });
        if (r.recorded) toast('로그인 전 결투 ' + r.recorded + '건을 올림포스 결투장에 기록했어요 ⚔️');
        else if (r.moved) toast(r.waiting ? '내 기록으로 옮겼어요. 상대가 로그인하면 결투장에 기록돼요' : '로그인 전 도전 기록을 내 회원 기록으로 옮겼어요');
      }
      return r;
    }).catch(function () { return null; });
  }

  // ------------------------------------------------------------------ 받은 사람 첫 화면
  var intro = null;
  function layer(cls) { var L = el('div', 'hd-layer ' + (cls || '')); L.hidden = true; document.body.appendChild(L); return L; }
  function show(L) { L.hidden = false; openLayer = L; }
  function hide(L) { L.hidden = true; if (openLayer === L) openLayer = null; }
  function boardEl(rows, count, meKey) {
    var b = el('div', 'hd-board');
    b.appendChild(el('h3', '', '이 도전장 순위 · ' + count + '명 도전'));
    if (!rows.length) b.appendChild(el('div', 'hd-empty', '아직 아무도 도전하지 않았어요. 첫 도전자가 되어 보세요!'));
    rows.slice(0, 10).forEach(function (r, i) {
      var row = el('div', 'hd-row');
      row.appendChild(el('span', '', String(i + 1)));
      row.appendChild(el('span', 'n', r.nick));
      row.appendChild(el('span', 'm', r.best + (CFG.unit || 'm')));
      var bd = r.result === 'win' ? el('span', 'hd-badge w', '승') : r.result === 'lose' ? el('span', 'hd-badge l', '패') : el('span', 'hd-badge p', r.tries + '/' + TRIES);
      row.appendChild(bd); b.appendChild(row);
    });
    return b;
  }
  function renderIntro() {
    var d = D.duel, me = D.me, c = el('div', 'hd-card');
    c.appendChild(el('span', 'hd-tag', me.self ? '📨 내가 보낸 도전장' : '📨 도전장이 도착했어요'));
    c.appendChild(el('div', 'hd-who', me.self ? '내 유령이 기다리는 중' : d.nick + '님의 도전!'));
    if (d.phrase) c.appendChild(el('div', 'hd-bub', '"' + d.phrase + '"'));
    var goal = el('div', 'hd-goal', d.dist + (CFG.unit || 'm')); goal.appendChild(el('small', '', '🚩 이 기록을 넘으면 승리')); c.appendChild(goal);
    var ch = el('div', 'hd-chance'), left = TRIES - (me.tries || 0);
    if (me.self) ch.textContent = '내 도전장은 연습만 할 수 있어요';
    else if (me.result === 'win') ch.textContent = '이미 이겼어요! 🏆 지금부터는 연습판';
    else if (me.result === 'lose') ch.textContent = (TRIES === 1 ? '이미 승부가 났어요' : '기회를 다 썼어요') + ' · 지금부터는 연습판';
    else if (TRIES === 1) { ch.appendChild(el('b', '', '⚔ 단판 승부')); ch.appendChild(document.createTextNode(' · 기회는 딱 한 번!')); }
    else { ch.appendChild(document.createTextNode('도전 기회 ')); ch.appendChild(el('b', '', dots(left))); ch.appendChild(document.createTextNode(' ' + left + '번')); }
    c.appendChild(ch);
    c.appendChild(el('div', 'hd-exp', when(d.exp) + '까지 유효'));
    var go = el('button', 'hd-go', me.self || me.result ? '연습 시작' : '도전 시작!'); go.type = 'button';
    go.addEventListener('click', function () { hide(intro); track('duel_start', { practice: !!(me.self || me.result) }); CFG.onStart(); });
    c.appendChild(go);
    c.appendChild(el('div', 'hd-sub', '로그인 없이 바로 · 한 판 1분 · 같은 맵에서 유령과 겨뤄요'));
    if (!auth.loggedIn && !me.self) c.appendChild(loginBox('로그인하고 도전하면 전적이 남아요', '이긴 기록이 올림포스 결투장의 명성이 돼요', '카카오로 로그인하고 도전', 'intro', false));
    c.appendChild(boardEl(D.board || [], D.count || 0));
    var solo = el('button', 'hd-solo', '도전 없이 혼자 하기'); solo.type = 'button';
    solo.addEventListener('click', leave);
    c.appendChild(solo);
    intro.textContent = ''; intro.appendChild(c); show(intro);
    setTimeout(function () { try { go.focus({ preventScroll: true }); } catch (e) {} }, 50);
  }
  function renderGone() {
    var c = el('div', 'hd-card');
    c.appendChild(el('span', 'hd-tag', '📨 도전장'));
    c.appendChild(el('div', 'hd-who', '기한이 지난 도전장이에요'));
    c.appendChild(el('p', 'hd-p', '도전장은 3일 동안만 열려 있어요. 대신 한 판 해 보고, 내 기록으로 도전장을 보내 보세요!'));
    var go = el('button', 'hd-go', '그냥 한 판 하기'); go.type = 'button';
    go.addEventListener('click', function () { hide(intro); stripUrl(); });
    c.appendChild(go); intro.textContent = ''; intro.appendChild(c); show(intro);
  }
  function stripUrl() {
    try { var u = new URL(location.href); u.searchParams.delete('duel'); if (/^#duel-/.test(u.hash)) u.hash = ''; history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
  }
  function leave() { D = null; last = null; hide(intro); stripUrl(); try { CFG.onLeave(); } catch (e) {} track('duel_leave'); }
  function load(id) {
    return api('GET', null, '?id=' + encodeURIComponent(id) + '&cid=' + cid()).then(function (r) {
      if (!r || !r.duel) { renderGone(); track('duel_open', { ok: false }); return; }
      if (r.duel.game !== CFG.game) { renderGone(); return; }
      D = r; if (r.duel.tries) TRIES = r.duel.tries; CFG.onDuel(r.duel); renderIntro(); track('duel_open', { ok: true, self: !!r.me.self });
    }).catch(function () { renderGone(); });
  }

  // ------------------------------------------------------------------ 판이 끝났을 때
  function finish(score) {
    if (!D) { last = null; return null; }
    var d = D.duel, mine = D.me;
    last = { score: score, win: score > d.dist, pending: true, res: null };
    var mark = last;
    busy = api('POST', { action: 'play', id: d.id, dist: score, cid: cid(), nick: lsGet('hd_nick') || lsGet('hsw_nickname'),
      ticket: (window.HelloFair && HelloFair.ticket) ? HelloFair.ticket(CFG.game) : '' })
      .then(function (r) {
        if (mark !== last) return;
        last.pending = false;
        if (r && r.me) { D.me = r.me; D.board = r.board || D.board; D.count = r.count || D.count; last.res = r; if (!r.practice && !r.me.loggedIn) lsSet('hd_claim', '1'); }
        else last.res = { practice: true, why: r && r.__status === 404 ? 'gone' : 'error' };
        track('duel_result', { result: last.res.practice ? 'practice' : (last.win ? 'win' : (D.me.result === 'lose' ? 'lose' : 'miss')), tries: D.me.tries, score: score });
        render();
      }).catch(function () { if (mark !== last) return; last.pending = false; last.res = { practice: true, why: 'error' }; render(); });
    return busy;
  }
  function render() {
    if (!CFG) return;
    var st = CFG.statEl;
    if (CFG.sendBtn) CFG.sendBtn.textContent = '📨 친구에게 도전장 보내기';
    if (!D || !last) { if (st) st.hidden = true; return; }
    var d = D.duel, me = D.me, r = last.res, diff = Math.abs(last.score - d.dist), U = CFG.unit || 'm';
    st.textContent = ''; st.hidden = false;
    var add = function (cls, t) { var n = el('div', cls, t); st.appendChild(n); return n; };
    if (last.pending) { add('big', '도전 결과를 확인하는 중…'); return; }
    var left = TRIES - (me.tries || 0), title = null;
    if (r.practice) {
      add('big', r.why === 'self' ? '🧪 내 도전장 연습판' : r.why === 'done' ? '🧪 연습판이에요' : r.why === 'gone' ? '⌛ 기한이 지난 도전장이에요' : '⚠ 기록을 확인하지 못해 연습판으로 처리했어요');
      add('', (last.win ? '유령(' + d.dist + U + ')보다 ' + diff + U + ' 더 갔어요' : '유령(' + d.dist + U + ')까지 ' + diff + U + ' 모자라요'));
      if (r.why === 'done') add('dim', '이 도전장의 결과는 이미 정해졌어요.');
    } else if (r.win) {
      title = '도전 성공! 🏆';
      add('big', '🏆 ' + d.nick + '님(' + d.dist + U + ')을 ' + diff + U + ' 앞질렀어요!');
      if (r.arena && r.arena.rated) { var al = el('a', '', '⚔️ 올림포스 결투장 명성 ' + (r.arena.delta >= 0 ? '+' : '') + r.arena.delta + ' →'); al.href = '/arena.html'; al.style.cssText = 'color:#ffc857;font-weight:700'; st.appendChild(el('div')).appendChild(al); }
      if (CFG.sendBtn) CFG.sendBtn.textContent = '📨 반격 도전장 보내기';
    } else if (me.result === 'lose') {
      title = '도전 실패…';
      add('big', TRIES === 1 ? '단판 승부에서 졌어요 · ' + diff + U + ' 모자랐어요' : '기회 ' + TRIES + '번을 다 썼어요 (최고 ' + me.best + U + ')');
      add('dim', '연습은 계속할 수 있어요. 내 기록으로 도전장을 보내 복수해 보세요!');
      if (r.arena && r.arena.rated) { var al2 = el('a', '', '⚔️ 올림포스 결투장 명성 ' + r.arena.delta + ' →'); al2.href = '/arena.html'; al2.style.cssText = 'color:#9fb0d8;font-weight:700'; st.appendChild(el('div')).appendChild(al2); }
    } else {
      title = '아깝다!';
      var line = add('big', diff + U + ' 모자라요 · 남은 기회 '); line.appendChild(el('b', '', dots(left))); // 기회가 2번 이상일 때만
    }
    if (!r.practice && me.rank > 0) add('dim', '이 도전장 순위 ' + me.rank + '위 / ' + (D.count || 1) + '명');
    if (!r.practice && !me.loggedIn) {
      if (r.win) st.appendChild(loginBox('🏆 이 승리를 올림포스 결투장에 남기세요', '지금 로그인하면 방금 이긴 결투가 바로 기록돼요', '카카오로 로그인하고 승리 기록하기', 'win', true));
      else if (me.result === 'lose') st.appendChild(loginBox('로그인하고 결투장에 들어가세요', '내 도전장으로 이기면 명성이 오르고 칭호가 생겨요', '카카오로 로그인', 'lose', false));
      else st.appendChild(loginBox('로그인하면 이 도전이 결투장에 기록돼요', '남은 기회로 이기면 명성이 올라요', '카카오로 로그인', 'try', false));
    }
    if (title && CFG.titleEl) CFG.titleEl.textContent = title;
    if (CFG.retryBtn) CFG.retryBtn.textContent = (!r.practice && !me.result) ? '다시 도전 (남은 기회 ' + left + '번)' : '같은 맵에서 다시 (연습)';
  }

  // ------------------------------------------------------------------ 도전장 카드(1200×600, 카톡 미리보기용)
  var IM = {};
  function img(key, src) { if (!src) return null; if (!IM[key]) { IM[key] = new Image(); IM[key].src = src; } return IM[key]; }
  var ok = function (im) { return im && im.complete && im.naturalWidth > 0; };
  function fit(c, text, font, size, maxW) { var s = size; c.font = font.replace('$', s); while (s > 12 && c.measureText(text).width > maxW) { s -= 2; c.font = font.replace('$', s); } return s; }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function outline(c, t, x, y, fill, stroke, lw) { c.lineJoin = 'round'; c.lineWidth = lw; c.strokeStyle = stroke; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y); }
  var FONT = '"Jua","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  // 대표 그림(10/8): 왼쪽 아래 주먹 쥔 헬로, 왼쪽 위 파도 괴물, 오른쪽에 펼친 두루마리. 글자는 두루마리 위에 먹색으로 얹는다
  function buildCard(o) {
    var W = 1200, H = 600, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d'), bg = img('bg', CFG.bgSrc), hero = img('hero', CFG.heroSrc), seal = img('seal', '/assets/duel/duel-seal.png');
    var CX = 772, INK = '#3b2412', PAPER = '#f7ebcd';
    if (ok(bg)) c.drawImage(bg, 0, 0, W, H);
    else { // 그림을 못 불러왔을 때의 임시 배경(같은 배치)
      var g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2c6fd6'); g.addColorStop(1, '#0a1530'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#f1dfb8'; rr(c, 470, 20, 700, 380, 18); c.fill();
      if (ok(hero)) { var hw = 300, hh = hw * hero.naturalHeight / hero.naturalWidth; c.save(); c.translate(220, 420); c.rotate(-0.12); c.drawImage(hero, -hw / 2, -hh / 2, hw, hh); c.restore(); }
    }
    // 낙관(10/8 대표: 더 크게) — 글자보다 먼저 찍어서 기록 숫자가 가려지지 않게
    if (ok(seal)) { c.save(); c.translate(1066, 300); c.rotate(0.2); c.globalAlpha = 0.9; c.drawImage(seal, -122, -122, 244, 244); c.restore(); } // 낙관(10/8 대표: 더 크게)
    c.textBaseline = 'alphabetic'; c.textAlign = 'center'; c.lineJoin = 'round';
    // 보낸 사람
    var nm = o.nick + '님의 도전장'; fit(c, nm, '900 $px ' + FONT, 58, 500); outline(c, nm, CX, 100, INK, PAPER, 7);
    // 한마디
    var ph = '"' + o.phrase + '"'; fit(c, ph, '800 $px ' + FONT, 36, 500); outline(c, ph, CX, 152, '#7a3b16', PAPER, 6);
    // 넘어야 할 기록
    var sc = o.dist + o.unit; fit(c, sc, '900 $px ' + FONT, 150, 330);
    c.save(); c.shadowColor = 'rgba(80,20,0,.35)'; c.shadowBlur = 10; outline(c, sc, CX, 292, '#c62a1c', '#fff3d6', 10); c.restore();
    c.font = '800 46px ' + FONT; outline(c, '넘을 수 있어?', CX, 352, INK, PAPER, 7);
    // 아래 안내(파도 위 띠)
    var ft = '단판 승부 · 로그인 없이 바로 · ' + when(o.exp) + '까지 · ' + o.name; c.font = '700 26px ' + FONT;
    var fw = Math.min(560, c.measureText(ft).width + 48); fit(c, ft, '700 $px ' + FONT, 26, fw - 40);
    c.fillStyle = 'rgba(10,18,40,.84)'; rr(c, 1170 - fw, 524, fw, 56, 28); c.fill(); c.strokeStyle = '#ffc857'; c.lineWidth = 2.5; c.stroke();
    c.fillStyle = '#fff'; c.fillText(ft, 1170 - fw / 2, 561);
    c.strokeStyle = 'rgba(255,200,87,.75)'; c.lineWidth = 6; rr(c, 3, 3, W - 6, H - 6, 24); c.stroke();
    return cv;
  }
  function fontsReady() {
    try { if (document.fonts && document.fonts.load) return Promise.race([document.fonts.load('40px "Jua"'), new Promise(function (r) { setTimeout(r, 1500); })]); } catch (e) {}
    return Promise.resolve();
  }

  // ------------------------------------------------------------------ 도전장 보내기 창
  var sheet = null, ui = {};
  function openSend() {
    var run = CFG.getRun && CFG.getRun();
    if (!run || !(run.dist >= 1)) { toast('1' + (CFG.unit || 'm') + ' 이상 가야 도전장을 보낼 수 있어요'); return; }
    var c = el('div', 'hd-card'), x = el('button', 'hd-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', '닫기');
    x.addEventListener('click', function () { hide(sheet); });
    c.appendChild(x); c.appendChild(el('h2', 'hd-h', '📨 도전장 보내기'));
    c.appendChild(el('p', 'hd-p', run.dist + (CFG.unit || 'm') + ' 기록으로 도전장을 보내요. 받은 사람은 같은 맵에서 내 유령과 겨뤄요.'));
    var lab = el('label', 'hd-l', '보내는 사람 이름'); lab.htmlFor = 'hdNick'; c.appendChild(lab);
    var nk = el('input', 'hd-in'); nk.id = 'hdNick'; nk.maxLength = 10; nk.autocomplete = 'nickname';
    nk.value = auth.loggedIn ? auth.nick : (lsGet('hd_nick') || lsGet('hsw_nickname') || '');
    if (auth.loggedIn) { nk.readOnly = true; }
    c.appendChild(nk);
    if (auth.loggedIn) c.appendChild(el('div', 'hd-note', '로그인한 이름으로 보내요. 양쪽 다 로그인하면 올림포스 결투장에 전적이 남아요.'));
    c.appendChild(el('div', 'hd-l', '한마디 고르기'));
    var chips = el('div', 'hd-chips');
    PHRASES.forEach(function (p, i) { var b = el('button', '', p); b.type = 'button'; b.addEventListener('click', function () { phr = i; refresh(); }); chips.appendChild(b); });
    c.appendChild(chips);
    c.appendChild(el('div', 'hd-l', '친구가 카카오톡에서 보게 될 카드'));
    var pv = el('img', 'hd-prev'); pv.alt = '도전장 카드 미리보기'; c.appendChild(pv);
    var kb = el('button', 'hd-kakao', '💬 카카오톡으로 보내기'); kb.type = 'button';
    var cb = el('button', 'hd-copy', '🔗 링크 복사하기'); cb.type = 'button';
    var msg = el('div', 'hd-msg'); msg.setAttribute('role', 'status');
    c.appendChild(kb); c.appendChild(cb); c.appendChild(msg);
    c.appendChild(el('div', 'hd-note', '받은 사람은 로그인 없이 바로 도전해요 · 단판 승부 · 3일 동안 유효'));
    ui = { run: run, nk: nk, chips: chips, pv: pv, kb: kb, cb: cb, msg: msg };
    var t = null; nk.addEventListener('input', function () { clearTimeout(t); t = setTimeout(refresh, 250); });
    kb.addEventListener('click', function () { go('kakao'); });
    cb.addEventListener('click', function () { go('copy'); });
    sheet.textContent = ''; sheet.appendChild(c); show(sheet); refresh();
    track('duel_send_open', { score: run.dist });
  }
  function nickNow() { return (ui.nk.value || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10) || '헬로'; }
  function refresh() {
    [].forEach.call(ui.chips.children, function (b, i) { b.setAttribute('aria-pressed', i === phr ? 'true' : 'false'); });
    fontsReady().then(function () {
      var cv = buildCard({ nick: nickNow(), dist: ui.run.dist, unit: CFG.unit || 'm', phrase: PHRASES[phr], exp: Date.now() + 3 * 864e5, name: CFG.name });
      try { ui.pv.src = cv.toDataURL('image/jpeg', 0.8); } catch (e) {}
    });
  }
  function runKey(run) { return run.seed + ':' + run.dist + ':' + run.g.x.length + ':' + nickNow() + ':' + phr; }
  // 도전장 만들기 → 카드 그림 올리기(한 판·이름·한마디 조합마다 한 번만)
  function ensure() {
    var run = ui.run, key = runKey(run);
    if (sent[key]) return sent[key];
    var nick = nickNow(); if (!auth.loggedIn) lsSet('hd_nick', nick);
    var p = api('POST', { action: 'create', game: CFG.game, seed: run.seed, dist: run.dist, g: run.g, nick: nick, msg: phr, cid: cid(),
      ticket: (window.HelloFair && HelloFair.ticket) ? HelloFair.ticket(CFG.game) : '', from: D ? D.duel.id : null })
      .then(function (r) {
        if (!r || !r.id) throw new Error((r && r.error) || '도전장을 만들지 못했어요');
        track('duel_create', { score: run.dist, phrase: phr, rematch: !!D });
        if (!auth.loggedIn) lsSet('hd_claim', '1');
        return fontsReady().then(function () {
          var cv = buildCard({ nick: r.nick, dist: run.dist, unit: CFG.unit || 'm', phrase: PHRASES[phr], exp: r.exp, name: CFG.name });
          return new Promise(function (res) { cv.toBlob(res, 'image/png'); });
        }).then(function (blob) {
          if (!blob) return Object.assign({ card: null }, r);
          return new Promise(function (res) { var fr = new FileReader(); fr.onloadend = function () { res(fr.result); }; fr.readAsDataURL(blob); })
            .then(function (b64) { return fetch('/api/kakao-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: b64, kind: 'duel', id: r.id }) }); })
            .then(function (u) { return u.ok ? u.json() : {}; }).then(function (u) { return Object.assign({ card: u.url || null }, r); })
            .catch(function () { return Object.assign({ card: null }, r); });
        });
      });
    p.catch(function () { delete sent[key]; });
    sent[key] = p; return p;
  }
  function go(how) {
    ui.kb.disabled = ui.cb.disabled = true; ui.msg.textContent = '도전장을 만드는 중…';
    ensure().then(function (r) {
      var title = '🔥 ' + r.nick + '님이 ' + CFG.name + ' 도전장을 보냈어요!';
      var desc = '"' + PHRASES[phr] + '" ' + ui.run.dist + (CFG.unit || 'm') + '를 넘으면 승리 · 단판 승부 · 로그인 없이 바로';
      try { var list = JSON.parse(lsGet('hd_sent') || '[]'); if (list.indexOf(r.id) < 0) { list.unshift(r.id); lsSet('hd_sent', JSON.stringify(list.slice(0, 20))); } } catch (e) {}
      if (how === 'kakao' && window.Kakao && Kakao.isInitialized && Kakao.isInitialized() && Kakao.Share) {
        var link = { mobileWebUrl: r.link, webUrl: r.link };
        Kakao.Share.sendDefault({ objectType: 'feed',
          content: { title: title, description: desc, imageUrl: r.card || ('https://daebugame.com' + (CFG.fallbackImg || '/games/hello-swing/assets/thumb-helloswing-wide.jpg')), imageWidth: 1200, imageHeight: 600, link: link },
          buttons: [{ title: '도전 받기', link: link }] });
        ui.msg.textContent = '카카오톡 공유창을 열었어요! 내 도전장 결과는 이 주소를 다시 열면 볼 수 있어요: ' + r.short;
        track('duel_send', { method: 'kakao' });
      } else if (how === 'kakao' && navigator.share) {
        navigator.share({ title: title, text: desc, url: r.short }).catch(function () {});
        ui.msg.textContent = '공유창을 열었어요. 주소: ' + r.short; track('duel_send', { method: 'webshare' });
      } else {
        var done = function () { ui.msg.textContent = '링크를 복사했어요! 카톡이나 단톡방에 붙여 넣으세요: ' + r.short; track('duel_send', { method: 'copy' }); };
        var fail = function () { ui.msg.textContent = '아래 주소를 길게 눌러 복사해 주세요: ' + r.short; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(title + '\n' + desc + '\n' + r.short).then(done, fail); else fail();
      }
      if (window.HelloPush && !ui.pb && HelloPush.state() !== 'on') { ui.pb = HelloPush.box(); ui.msg.parentNode.insertBefore(ui.pb, ui.msg.nextSibling); }
      if (!auth.loggedIn && !ui.lb) { ui.lb = loginBox('로그인하면 이 도전장의 결과가 결투장에 남아요', '보낸 뒤에 로그인해도 이 폰이면 이어서 기록돼요', '카카오로 로그인', 'send', false); ui.msg.parentNode.insertBefore(ui.lb, ui.msg.nextSibling); }
    }).catch(function (e) { ui.msg.textContent = (e && e.message) || '도전장을 만들지 못했어요. 다시 시도해 주세요.'; })
      .then(function () { ui.kb.disabled = ui.cb.disabled = false; });
  }

  // ------------------------------------------------------------------ 시작
  function init(cfg) {
    CFG = cfg; style();
    intro = layer(''); sheet = layer('hd-sheet');
    // 창이 열려 있을 때 스페이스바가 뒤의 게임을 시작하지 않게
    window.addEventListener('keydown', function (e) { if (openLayer && (e.code === 'Space' || e.key === ' ') && e.target === document.body) e.stopImmediatePropagation(); }, true);
    [intro, sheet].forEach(function (L) { ['pointerdown', 'touchstart'].forEach(function (ev) { L.addEventListener(ev, function (e) { e.stopPropagation(); }); }); });
    sheet.addEventListener('click', function (e) { if (e.target === sheet) hide(sheet); });
    claimP = fetch('/api/auth', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.loggedIn) { auth.loggedIn = true; auth.nick = d.nick || ''; } }).catch(function () {}).then(claim);
    var id = '';
    try { id = new URLSearchParams(location.search).get('duel') || ''; } catch (e) {}
    if (!id) { var m = /^#duel-([a-z0-9]{8})$/.exec(location.hash || ''); if (m) id = m[1]; }
    id = String(id).toLowerCase();
    if (/^[a-z0-9]{8}$/.test(id)) claimP.then(function () { load(id); });
    // 내가 보낸 도전장의 결과가 새로 왔으면 알려 준다(자세한 건 오락실 첫 화면·결투장)
    claimP.then(function () { if (!window.HelloInbox) return; HelloInbox.load().then(function (r) {
      if (r.fresh.length) toast('📨 내 도전장 결과 ' + r.fresh.length + '건 · ' + HelloInbox.title(r.fresh[0]));
    }); });
    if (cfg.sendBtn) cfg.sendBtn.addEventListener('click', function (e) { e.stopPropagation(); openSend(); });
  }

  window.HelloDuel = {
    init: init, finish: finish, render: render, openSend: openSend, open: load,
    active: function () { return D ? D.duel : null; }, phrases: PHRASES, buildCard: function (o) { return buildCard(o); },
  };
})();
