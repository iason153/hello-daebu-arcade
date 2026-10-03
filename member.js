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

  // =====================================================================
  // HelloCards — 헬로타워 밖의 게임에서 쓰는 "카드 획득" 공용 부품
  //   HelloCards.earn(key, score)  게임 도중: 카드를 얻었다고 기록(처음 얻는 카드면 true). 화면은 멈추지 않는다.
  //   HelloCards.flush(opts)       게임이 끝났을 때: 이번 판에서 새로 얻은 카드를 한 장씩 화려하게 보여 준다.
  // 카드는 헬로타워와 같은 보관함(localStorage 'ht_cards')에 먼저 저장하고, 로그인한 회원이면 서버 카드첩에도 등록한다.
  // =====================================================================
  var CARDS = {
    m_chomp:  { name: '덥석!',           title: '괴물의 첫 간식',        grade: 'normal', no: '먼치 01', fb: 'm0_wide' },
    m_sky:    { name: '하늘',            title: '60m, 갈매기 눈높이',     grade: 'normal', no: '먼치 02', fb: 'hello_tall' },
    m_cloud:  { name: '구름 위',         title: '150m, 비행기 옆자리',    grade: 'normal', no: '먼치 03', fb: 'ledge_ice' },
    m_rocket: { name: '헬로 로켓',       title: '황금조개 10개의 힘',     grade: 'normal', no: '먼치 04', fb: 'shell_gold' },
    m_space:  { name: '우주',            title: '270m, 별들 사이로',      grade: 'rare',   no: '먼치 05', fb: 'hello_round' },
    m_near:   { name: '아슬아슬의 달인', title: '이빨 사이를 다섯 번',    grade: 'rare',   no: '먼치 06', fb: 'm3_closing' },
    m_gull:   { name: '갈매기의 복수',   title: '비밀 카드 발견!',        grade: 'rare',   no: '비밀',    fb: 'gull_flap' },
    m_gods:   { name: '신들의 나라',     title: '500m, 괴물도 못 온 곳',  grade: 'legend', no: '먼치 08', fb: 'god_zeus' }
  };
  var GRADE = { normal: ['일반', '#cfd6e2', '#f4f6fa', '#9aa6b8'], rare: ['희귀', '#ffc93c', '#fff3b0', '#e0a010'], legend: ['전설', '#ff7ad9', '#ff7ad9', '#8fd6ff'] };
  var queue = [], loggedIn = false, soundOn = function () { return true; };
  function load() { try { var c = JSON.parse(localStorage.getItem('ht_cards') || '{}'); return (c && typeof c === 'object') ? c : {}; } catch (e) { return {}; } }
  function save(c) { try { localStorage.setItem('ht_cards', JSON.stringify(c)); } catch (e) {} }
  function claim(list) {
    if (!loggedIn || !list.length) return;
    fetch('/api/wallet', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'claim', cards: list }) }).catch(function () {});
  }
  function earn(key, score) {
    if (!CARDS[key]) return false;
    var c = load();
    if (c[key]) return false;
    c[key] = { at: new Date().toISOString(), floor: Math.max(0, Math.floor(Number(score) || 0)), count: 1 };
    save(c);
    queue.push(key);
    claim([{ god: key, floor: c[key].floor, at: c[key].at }]);
    track('card_get', { god: key, score: c[key].floor, first: true });
    return true;
  }
  // 로그인 상태면 카드첩과 이 기기의 카드를 서로 맞춘다(이 게임의 카드만)
  function sync() {
    fetch('/api/wallet', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (w) {
      if (!w || !w.isMine) return;
      loggedIn = true;
      var c = load(), changed = false, list = [];
      Object.keys(CARDS).forEach(function (k) {
        if (w.cards[k] && !c[k]) { c[k] = { at: w.cards[k].at, floor: 0, count: 1 }; changed = true; }
        else if (c[k] && !w.cards[k]) list.push({ god: k, floor: c[k].floor || 0, at: c[k].at });
      });
      if (changed) save(c);
      claim(list);
    }).catch(function () {});
  }
  var actx = null;
  function fanfare(grade) {
    try {
      if (!soundOn()) return;
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var ac = actx, t0 = ac.currentTime + 0.02, level = grade === 'legend' ? 2 : grade === 'rare' ? 1 : 0;
      var comp = ac.createDynamicsCompressor(), master = ac.createGain(); master.gain.value = 0.85; master.connect(comp); comp.connect(ac.destination);
      var tone = function (type, f, t, dur, vol, f2) { var o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); };
      var noise = function (t, dur, vol, fFrom, fTo, q) { var len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0); for (var k = 0; k < len; k++) d[k] = Math.random() * 2 - 1; var src = ac.createBufferSource(); src.buffer = buf; var f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q || 1.2; f.frequency.setValueAtTime(fFrom, t); f.frequency.exponentialRampToValueAtTime(fTo, t + dur); var g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02); };
      var hit = t0 + 0.28;
      noise(t0, 0.3, 0.5, 300, 5200, 1.0); tone('sine', 180, t0, 0.28, 0.12, 900);
      tone('sine', 150, hit, 0.5, 0.9, 38); noise(hit, 0.18, 0.45, 2400, 500, 0.7);
      var chord = function (t, fs, dur, vol) { fs.forEach(function (f) { tone('sawtooth', f, t, dur, vol); tone('sawtooth', f * 1.006, t, dur, vol * 0.7); tone('triangle', f * 2, t, dur * 0.8, vol * 0.5); }); };
      var C = [261.6, 329.6, 392.0, 523.3], F = [349.2, 440.0, 523.3, 698.5], G = [392.0, 493.9, 587.3, 784.0], C2 = [523.3, 659.3, 784.0, 1046.5];
      if (level === 0) chord(hit, C, 1.1, 0.075);
      else if (level === 1) { chord(hit, C, 0.45, 0.075); chord(hit + 0.42, G, 0.4, 0.07); chord(hit + 0.8, C2, 1.3, 0.08); }
      else { chord(hit, C, 0.4, 0.075); chord(hit + 0.36, F, 0.36, 0.07); chord(hit + 0.7, G, 0.4, 0.075); chord(hit + 1.08, C2, 1.8, 0.09); tone('sine', 65.4, hit + 1.08, 1.6, 0.5); }
      var run = [523.3, 659.3, 784.0, 1046.5, 1318.5, 1568.0, 2093.0, 2637.0].slice(0, 5 + Math.floor(level * 1.5));
      var runAt = hit + (level === 0 ? 0.1 : level === 1 ? 0.85 : 1.12);
      run.forEach(function (f, k) { var t = runAt + k * 0.065; tone('triangle', f, t, k === run.length - 1 ? 1.1 : 0.28, 0.2); tone('sine', f * 2, t, 0.2, 0.06); });
      var n = 10 + level * 8, at = runAt + run.length * 0.065;
      for (var k = 0; k < n; k++) tone('sine', 2200 + Math.random() * 3800, at + Math.random() * (0.9 + level * 0.5), 0.14, 0.05 + Math.random() * 0.04);
    } catch (e) { /* 소리가 안 나도 게임은 그대로 */ }
  }
  var styled = false;
  function style() {
    if (styled) return; styled = true;
    var st = document.createElement('style');
    st.textContent = '#hcReveal{position:fixed;inset:0;z-index:9998;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(6,8,22,.9);overflow:hidden;font-family:sans-serif;animation:hcFade .3s ease both}' +
      '@keyframes hcFade{from{opacity:0}to{opacity:1}}@keyframes hcSpin{to{transform:rotate(360deg)}}@keyframes hcIn{0%{transform:rotateY(90deg) scale(.6);opacity:0}60%{transform:rotateY(-12deg) scale(1.06);opacity:1}100%{transform:none}}@keyframes hcSweep{0%,35%{background-position:140% 0}80%,100%{background-position:-140% 0}}@keyframes hcWarn{from{box-shadow:0 0 0 rgba(254,229,0,0)}to{box-shadow:0 0 18px rgba(254,229,0,.7)}}' +
      '#hcReveal .rays{position:fixed;left:50%;top:44%;width:220vmax;height:220vmax;margin:-110vmax 0 0 -110vmax;pointer-events:none;background:repeating-conic-gradient(from 0deg,var(--c) 0deg 6deg,transparent 6deg 18deg);-webkit-mask-image:radial-gradient(circle,#000 0%,transparent 40%);mask-image:radial-gradient(circle,#000 0%,transparent 40%);opacity:.5;animation:hcSpin 18s linear infinite}' +
      '#hcReveal .head{position:relative;color:#fff6d5;font-weight:900;font-size:24px;margin-bottom:14px;text-shadow:0 0 14px var(--c)}' +
      '#hcReveal .card{position:relative;width:232px;height:348px;border-radius:18px;padding:8px;background:linear-gradient(135deg,var(--a),var(--b),var(--a));box-shadow:0 0 30px var(--c),0 14px 30px rgba(0,0,0,.6);animation:hcIn .7s cubic-bezier(.2,.8,.2,1) .2s both}' +
      '#hcReveal .in{position:relative;width:100%;height:100%;border-radius:11px;overflow:hidden;background:radial-gradient(circle at 50% 38%,#fff 0%,var(--a) 50%,var(--b) 100%)}' +
      '#hcReveal .in img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}#hcReveal .in img.fb{object-fit:contain;inset:12% 8% 30% 8%;width:84%;height:58%}' +
      '#hcReveal .top{position:absolute;left:10px;right:10px;top:8px;display:flex;justify-content:space-between;font-size:12px;font-weight:900;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.8)}#hcReveal .gr{background:var(--c);padding:2px 9px;border-radius:999px}' +
      '#hcReveal .plate{position:absolute;left:0;right:0;bottom:0;padding:34px 8px 14px;text-align:center;background:linear-gradient(to top,rgba(16,12,36,.94) 50%,rgba(16,12,36,0))}#hcReveal .nm{font-size:24px;font-weight:900;color:#fff6d5;text-shadow:0 0 10px var(--c),0 2px 3px #000}#hcReveal .tt{font-size:13px;color:#ffe9a8;font-weight:700;margin-top:2px}' +
      '#hcReveal .shine{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;background:linear-gradient(115deg,transparent 34%,rgba(255,255,255,.75) 48%,transparent 62%);background-size:280% 100%;animation:hcSweep 3s ease-in-out infinite}' +
      '#hcReveal .hint{position:relative;margin-top:18px;color:rgba(255,255,255,.75);font-size:13px;font-weight:700}' +
      '#hcReveal .book{position:relative;margin-top:10px;max-width:300px;text-align:center;color:#ffe9a8;font-size:13px;font-weight:700;line-height:1.45}#hcReveal .book.warn{background:rgba(20,16,40,.86);border:2px solid #fee500;border-radius:14px;padding:10px 14px;color:#fff;animation:hcWarn 1.2s ease-in-out infinite alternate}#hcReveal .book b{color:#fee500}' +
      '#hcReveal .book button{display:block;margin:8px auto 0;padding:9px 16px;border:0;border-radius:999px;background:#fee500;color:#191600;font-weight:800;font-size:13px;cursor:pointer}' +
      '@media (prefers-reduced-motion:reduce){#hcReveal,#hcReveal *{animation:none!important}}';
    document.head.appendChild(st);
  }
  // opts: { path, game, getScore, soundOn, onDone }
  function flush(opts) {
    opts = opts || {};
    if (opts.soundOn) soundOn = opts.soundOn;
    if (!queue.length) { if (opts.onDone) opts.onDone(); return; }
    style();
    var keys = queue.slice(); queue = [];
    var i = 0, wrap = null, openAt = 0;
    function show() {
      var key = keys[i], c = CARDS[key], g = GRADE[c.grade];
      if (wrap) wrap.remove();
      wrap = h('div'); wrap.id = 'hcReveal';
      wrap.style.setProperty('--c', g[1]); wrap.style.setProperty('--a', g[2]); wrap.style.setProperty('--b', g[3]);
      stop(wrap);
      var img = new Image(); img.alt = '';
      img.onerror = function () { if (!img.className) { img.className = 'fb'; img.src = '/games/hello-munch/assets/' + c.fb + '.webp'; } };
      img.src = '/assets/cards/' + key + '.webp';
      var inner = h('div'); inner.className = 'in';
      var top = h('div'); top.className = 'top'; top.appendChild(h('span', '', c.no)); var gr = h('span', '', g[0]); gr.className = 'gr'; top.appendChild(gr);
      var plate = h('div'); plate.className = 'plate'; var nm = h('div', '', c.name); nm.className = 'nm'; var tt = h('div', '', c.title); tt.className = 'tt'; plate.appendChild(nm); plate.appendChild(tt);
      var shine = h('div'); shine.className = 'shine';
      inner.appendChild(img); inner.appendChild(top); inner.appendChild(plate); inner.appendChild(shine);
      var card = h('div'); card.className = 'card'; card.appendChild(inner);
      var head = h('div', '', (keys.length > 1 ? '(' + (i + 1) + '/' + keys.length + ') ' : '') + (key === 'm_gull' ? '비밀 카드 발견!' : '카드 획득!')); head.className = 'head';
      var rays = h('div'); rays.className = 'rays';
      var hint = h('div', '', '화면을 누르면 계속'); hint.className = 'hint';
      var book = h('div'); book.className = 'book';
      if (loggedIn) book.textContent = '🎴 내 올림포스 카드첩에 보관했어요';
      else {
        book.className = 'book warn';
        book.innerHTML = '⚠️ 이 카드는 아직 <b>이 기기에만</b> 있어요.<br>카카오 로그인으로 카드첩에 보관하세요!';
        if (i === keys.length - 1 && opts.path) {
          var b = h('button', '', '💬 카카오 로그인하고 보관하기'); b.type = 'button';
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            var sc = 0; try { sc = Number(opts.getScore()) || 0; } catch (err) {}
            try { if (sc > 0) sessionStorage.setItem('hello_pending', JSON.stringify({ game: opts.game, score: sc, at: Date.now() })); } catch (err) {}
            track('login_click', { from: opts.game + '_card', score: sc });
            location.href = '/api/auth?action=login&next=' + encodeURIComponent(opts.path);
          });
          book.appendChild(b);
        }
      }
      [rays, head, card, hint, book].forEach(function (x) { wrap.appendChild(x); });
      wrap.addEventListener('click', next);
      document.body.appendChild(wrap);
      openAt = Date.now();
      fanfare(c.grade);
    }
    function next() {
      if (Date.now() - openAt < 900) return; // 너무 빨리 눌러 못 보고 넘기는 것 방지
      i++;
      if (i < keys.length) show();
      else { wrap.remove(); if (opts.onDone) opts.onDone(); }
    }
    show();
  }
  if (/\/hello-munch\//.test(location.pathname)) sync(); // 카드가 있는 게임에서만 카드첩과 맞춤(불필요한 서버 호출 줄이기)
  window.HelloCards = { earn: earn, flush: flush, pending: function () { return queue.length; }, list: CARDS };
})();
