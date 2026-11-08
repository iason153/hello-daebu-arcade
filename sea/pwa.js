/*
 * 방아머리 바닷가(/sea/) — 앱 설치(PWA) 도우미. 오락실 pwa.js 흐름을 그대로 옮기고 바닷가에 맞게 바꿨다.
 *  - 카카오톡 등 앱 안 브라우저 → [크롬으로 열기](아이폰은 사파리). ?pwa=install 을 붙여 넘기면 열리자마자 설치 안내
 *  - 같이 앉은 자리가 있으면 넘길 때 자리 번호와 대화 열쇠·내 자리 번호를 # 뒤에 실어 보낸다(# 뒤는 서버로 가지 않음)
 *    · 카카오톡은 안드로이드·아이폰 모두 카카오 공식 "외부 브라우저로 열기"를 쓴다(intent:// 는 # 뒤를 실을 수 없어서)
 *  - 안드로이드 크롬: 버튼 한 번 / 아이폰 사파리: 3단계 안내 / 설치된 앱으로 열면 설치 UI 숨김
 * 페이지는 window.seaHandoffUrl() 로 넘길 주소를 정한다. 서비스 워커 등록은 페이지(index.html)가 한다.
 */
(function () {
  'use strict';

  function track(name, params) {
    try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) {}
  }

  // ---------------------------------------------------------------- 환경 판별
  var IN_APPS = [
    { id: 'kakao', name: '카카오톡', re: /KAKAOTALK/i },
    { id: 'naver', name: '네이버 앱', re: /NAVER\(inapp|NAVER\//i },
    { id: 'band', name: '밴드', re: /BAND\//i },
    { id: 'instagram', name: '인스타그램', re: /Instagram/i },
    { id: 'facebook', name: '페이스북', re: /FBAN|FBAV|FB_IAB/i },
    { id: 'line', name: '라인', re: /\bLine\//i },
    { id: 'daum', name: '다음 앱', re: /DaumApps/i },
  ];
  function detect() {
    var ua = navigator.userAgent || '';
    var ios = /iP(hone|od|ad)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var android = /Android/i.test(ua);
    var inApp = null;
    for (var i = 0; i < IN_APPS.length; i++) if (IN_APPS[i].re.test(ua)) { inApp = IN_APPS[i]; break; }
    var browser = 'other';
    if (/SamsungBrowser/i.test(ua)) browser = 'samsung';
    else if (/CriOS/i.test(ua)) browser = 'chrome-ios';
    else if (/FxiOS|Firefox/i.test(ua)) browser = 'firefox';
    else if (/Edg/i.test(ua)) browser = 'edge';
    else if (/Chrome/i.test(ua)) browser = 'chrome';
    else if (ios && /Safari/i.test(ua)) browser = 'safari';
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    return { ios: ios, android: android, platform: ios ? 'ios' : android ? 'android' : 'desktop', inApp: inApp, browser: browser, standalone: standalone };
  }
  var env = detect();

  // 바깥 브라우저로 넘길 주소 — 지금 주소(utm 포함)를 그대로 넘기고 ?pwa=install 만 덧붙임
  function handoffUrl() {
    var h = null;
    try { if (typeof window.seaHandoffUrl === 'function') h = window.seaHandoffUrl(); } catch (e) {}
    var u = new URL(h || window.location.href);
    u.searchParams.set('pwa', 'install');
    return u.toString();
  }
  function externalOpenUrl() {
    if (!env.inApp) return null;
    var target = handoffUrl();
    if (env.inApp.id === 'kakao') return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(target);
    if (env.android) {
      // intent:// 는 # 뒤를 못 싣는다. 자리 정보는 크롬에서 초대 링크를 다시 열면 이어진다
      var u = new URL(target.split('#')[0]);
      u.searchParams.delete('r');
      target = u.toString();
      return 'intent://' + u.host + u.pathname + u.search +
        '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(target) + ';end';
    }
    return null; // 아이폰의 다른 앱은 메뉴에서 "Safari로 열기"
  }

  // 설치된 앱으로 열림 — 설치 UI 없음, 실행만 기록
  if (env.standalone) {
    track('pwa_launch', { platform: env.platform });
    return;
  }

  // ---------------------------------------------------------------- 스타일
  var css = '' +
    '.pwa-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:999px;border:none;cursor:pointer;' +
      'background:rgba(251,246,236,.94);color:#2b2620;font-family:inherit;font-size:15px;font-weight:600;' +
      'box-shadow:none}' +
    '.pwa-btn img{width:26px;height:26px;border-radius:7px}' +
    '.pwa-btn.small{padding:5px 12px 5px 6px;font-size:12px;background:rgba(14,19,27,.42);color:#fbf6ec;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}' +
    '.pwa-btn.small img{width:18px;height:18px;border-radius:5px}' +
    '.pwa-banner{position:fixed;top:0;left:0;right:0;z-index:900;display:flex;align-items:center;gap:10px;padding:max(10px,env(safe-area-inset-top,0px)) max(12px,env(safe-area-inset-right,0px)) 10px max(16px,env(safe-area-inset-left,0px));' +
      'background:#fbf6ec;color:#2b2620;font-family:inherit;font-size:13px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
    '.pwa-banner p{flex:1;margin:0}.pwa-banner b{font-weight:700}' +
    '.pwa-banner .go{flex:none;border:none;border-radius:999px;padding:9px 14px;background:#1b2433;color:#fbf6ec;font-weight:700;font-size:13px;cursor:pointer}' +
    '.pwa-banner .x{flex:none;border:none;background:none;font-size:20px;line-height:1;padding:4px 6px;color:#2a1a08;cursor:pointer}' +
    '.pwa-sheet{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center}' +
    '.pwa-sheet[hidden]{display:none}' +
    '.pwa-sheet .bd{position:absolute;inset:0;background:rgba(5,10,25,.6)}' +
    '.pwa-sheet .panel{position:relative;width:100%;max-width:480px;background:#f6efe0;color:#1a2440;border-radius:22px 22px 0 0;' +
      'padding:10px 20px calc(20px + env(safe-area-inset-bottom,0px));font-family:inherit;max-height:88vh;overflow:auto}' +
    '.pwa-sheet .grip{width:40px;height:4px;border-radius:2px;background:#cdbf9f;margin:0 auto 14px}' +
    '.pwa-sheet .head{display:flex;gap:14px;align-items:center;margin-bottom:10px}' +
    '.pwa-sheet .head img{width:60px;height:60px;border-radius:15px;box-shadow:0 6px 14px rgba(15,26,48,.3)}' +
    '.pwa-sheet h2{font-weight:700;font-size:21px;font-weight:400;margin:0;line-height:1.3}' +
    '.pwa-sheet .desc{font-size:14px;color:#51607e;margin:2px 0 0}' +
    '.pwa-sheet ol{list-style:none;counter-reset:s;margin:14px 0 0;padding:0}' +
    '.pwa-sheet li{counter-increment:s;display:flex;gap:10px;align-items:flex-start;padding:9px 0;font-size:15px;border-top:1px solid #e6dcc6}' +
    '.pwa-sheet li::before{content:counter(s);flex:none;width:24px;height:24px;border-radius:50%;background:#1b2433;color:#fbf6ec;' +
      'font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;margin-top:1px}' +
    '.pwa-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:7px;background:#fff;border:1px solid #d9ccb0;' +
      'font-weight:700;font-size:14px;vertical-align:1px;white-space:nowrap}' +
    '.pwa-chip svg{width:16px;height:16px;color:#2f7cf6}' +
    '.pwa-sheet .note{font-size:12.5px;color:#6b7690;margin:10px 0 0}' +
    '.pwa-sheet .copy{display:flex;gap:6px;margin-top:10px}' +
    '.pwa-sheet .copy input{flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:1px solid #d9ccb0;background:#fff;font-size:13px;color:#1a2440}' +
    '.pwa-sheet .copy button{border:none;border-radius:9px;padding:0 12px;background:#0f1a30;color:#fff;font-size:13px;cursor:pointer}' +
    '.pwa-sheet .acts{display:grid;gap:8px;margin-top:16px}' +
    '.pwa-sheet .primary{border:none;border-radius:14px;padding:15px;background:#e76f51;color:#fff;font-weight:700;font-size:19px;cursor:pointer}' +
    '.pwa-sheet .later{border:none;background:none;padding:8px;color:#6b7690;font-size:14px;cursor:pointer}' +
    '.pwa-arrow{position:fixed;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1001;' +
      'font-size:34px;animation:pwaBob 1s ease-in-out infinite;pointer-events:none}' +
    '@keyframes pwaBob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,8px)}}' +
    '@media (prefers-reduced-motion:reduce){.pwa-arrow{animation:none}}' +
    '.pwa-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1100;' +
      'background:rgba(15,26,48,.95);color:#fff;padding:11px 16px;border-radius:12px;font-size:14px;font-family:inherit;max-width:calc(100% - 32px)}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- 아이콘·도우미
  var I = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>',
    hdots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };
  function roomCopyBox() {
    var link = '';
    try { if (typeof window.seaRoomLink === 'function') link = window.seaRoomLink() || ''; } catch (e) {}
    return link ? '<div class="copy"><input type="text" readonly value="' + link.replace(/"/g, '&quot;') + '" aria-label="초대 링크"><button type="button" data-copy>링크 복사</button></div>' : '';
  }
  function chip(label, icon) { return '<span class="pwa-chip">' + (icon || '') + label + '</span>'; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  var ICON = '/sea/icon-192.png';
  var APP_URL = 'https://daebuseatime.com/sea/';

  var toastTimer;
  function toast(msg, ms) {
    var t = document.querySelector('.pwa-toast');
    if (!t) { t = el('<div class="pwa-toast" role="status"></div>'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }

  // ---------------------------------------------------------------- 설치 시트
  var installPrompt = null;
  var sheet = el(
    '<div class="pwa-sheet" hidden>' +
      '<div class="bd" data-close></div>' +
      '<div class="panel" role="dialog" aria-modal="true" aria-labelledby="pwa-title">' +
        '<div class="grip" aria-hidden="true"></div>' +
        '<div class="head"><img src="' + ICON + '" alt=""><div><h2 id="pwa-title"></h2><p class="desc"></p></div></div>' +
        '<div class="body"></div>' +
        '<div class="acts"><button type="button" class="primary" hidden></button><button type="button" class="later" data-close>다음에 할게요</button></div>' +
      '</div>' +
    '</div>');
  var arrow = null;
  var primaryAction = null;

  function render() {
    var title = sheet.querySelector('h2'), desc = sheet.querySelector('.desc'), body = sheet.querySelector('.body');
    var primary = sheet.querySelector('.primary');
    var steps = [], note = '', extra = '', d = '', t = '';
    primaryAction = null;
    removeArrow();

    if (env.inApp) {
      var target = env.ios ? '사파리' : '크롬', targetRo = env.ios ? '사파리로' : '크롬으로';
      var ext = externalOpenUrl();
      t = '먼저 ' + targetRo + ' 열어 주세요';
      d = env.inApp.name + ' 안에서는 앱 설치가 안 돼요.';
      if (ext) {
        primaryAction = { label: targetRo + ' 열기', run: function () { track('pwa_open_external', { app: env.inApp.id, via: 'sheet' }); location.href = ext; } };
        steps = ['아래 ' + chip(targetRo + ' 열기') + ' 버튼을 눌러요.', target + '에서 바닷가가 열리면 설치 안내가 바로 떠요.'];
      } else {
        steps = env.ios
          ? ['화면 아래(또는 위)의 ' + chip('', I.hdots) + ' 또는 ' + chip('', I.share) + ' 버튼을 눌러요.', chip('Safari로 열기') + '를 눌러요.', '사파리에서 바닷가가 열리면 설치 안내가 떠요.']
          : ['화면 오른쪽 위 ' + chip('', I.dots) + ' 버튼을 눌러요.', chip('다른 브라우저로 열기') + ' 또는 ' + chip('Chrome으로 열기') + '를 눌러요.', '크롬에서 바닷가가 열리면 설치 안내가 떠요.'];
      }
      note = '잘 안 되면 아래 주소를 복사해서 크롬(아이폰은 사파리) 주소창에 붙여넣어도 돼요.';
      extra = '<div class="copy"><input type="text" readonly value="' + APP_URL + '" aria-label="바닷가 주소"><button type="button" data-copy>주소 복사</button></div>';
    } else if (installPrompt) {
      t = '홈 화면에 바닷가 설치하기';
      d = '버튼 한 번이면 끝나요. 홈 화면에 방아머리 아이콘이 생겨요.';
      primaryAction = { label: '지금 설치하기', run: promptInstall };
      steps = ['아래 ' + chip('지금 설치하기') + '를 눌러요.', '뜨는 창에서 ' + chip('설치') + '를 눌러요.'];
      note = '설치하면 아이콘 한 번으로 바다 앞, 같이 앉던 자리로 바로 돌아와요.';
    } else if (env.ios) {
      t = '아이폰 홈 화면에 추가하기';
      d = env.browser === 'safari' ? '사파리에서 세 번만 누르면 돼요.' : '브라우저의 공유 버튼에서 추가할 수 있어요.';
      steps = env.browser === 'safari'
        ? ['화면 아래 가운데 ' + chip('', I.share) + ' 공유 버튼을 눌러요. (안 보이면 화면을 살짝 위로 올려 보세요)', '목록을 내려서 ' + chip('홈 화면에 추가', I.plus) + '를 눌러요.', '오른쪽 위 ' + chip('추가') + '를 눌러요.']
        : ['주소창 옆의 ' + chip('', I.share) + ' 공유 버튼을 눌러요.', chip('홈 화면에 추가', I.plus) + '를 눌러요.', chip('추가') + '를 눌러요.'];
      note = '아이폰은 홈 화면 앱이 사파리와 저장공간을 따로 써요. 같이 앉은 자리가 있다면 설치한 앱을 처음 열 때 초대 링크를 한 번 붙여 넣어 주세요(아래 복사).';
      extra = roomCopyBox();
    } else if (env.android && env.browser === 'samsung') {
      t = '갤럭시 홈 화면에 추가하기';
      d = '삼성 인터넷에서 추가하는 방법이에요.';
      steps = ['화면 아래 오른쪽 ' + chip('', I.menu) + ' 메뉴를 눌러요.', chip('현재 페이지 추가') + '(또는 "페이지 추가")를 눌러요.', chip('홈 화면') + '을 고르고 ' + chip('추가') + '를 눌러요.'];
      note = '주소창에 ⬇ 모양 설치 아이콘이 보이면 그걸 눌러도 돼요.';
    } else if (env.android) {
      t = '홈 화면에 바닷가 설치하기';
      d = '크롬 메뉴에서 추가할 수 있어요.';
      steps = ['화면 오른쪽 위 ' + chip('', I.dots) + ' 메뉴를 눌러요.', chip('홈 화면에 추가') + ' 또는 ' + chip('앱 설치') + '를 눌러요.', chip('설치') + '(또는 "추가")를 눌러요.'];
      note = '이미 설치했다면 홈 화면의 방아머리 아이콘으로 열어 주세요.';
    } else {
      t = 'PC에도 설치할 수 있어요';
      d = '크롬·엣지 주소창 오른쪽의 설치 아이콘을 누르면 창 하나짜리 앱이 돼요. 휴대폰에서 보려면 아래 주소를 보내세요.';
      steps = ['휴대폰 크롬(아이폰은 사파리)에서 아래 주소를 열어요.', chip('앱으로 설치하기') + '를 누르면 기기에 맞는 방법이 나와요.'];
      note = '설치 아이콘이 안 보이면 크롬 메뉴 → 저장 및 공유 → 앱 설치(또는 바로가기 만들기)를 눌러요.';
      extra = '<div class="copy"><input type="text" readonly value="' + APP_URL + '" aria-label="바닷가 주소"><button type="button" data-copy>주소 복사</button></div>';
    }

    title.textContent = t;
    desc.textContent = d;
    body.innerHTML = '<ol>' + steps.map(function (s) { return '<li><span>' + s + '</span></li>'; }).join('') + '</ol>' +
      (note ? '<p class="note">' + note + '</p>' : '') + extra;
    primary.hidden = !primaryAction;
    if (primaryAction) primary.textContent = primaryAction.label;
  }
  function showArrow() {
    if (arrow) return;
    arrow = el('<div class="pwa-arrow" aria-hidden="true">👇</div>');
    document.body.appendChild(arrow);
  }
  function removeArrow() { if (arrow) { arrow.remove(); arrow = null; } }

  function openSheet(source) {
    render();
    sheet.hidden = false;
    track('pwa_install_sheet', { source: source || 'button', platform: env.platform, browser: env.browser, in_app: env.inApp ? env.inApp.id : 'none', can_prompt: !!installPrompt });
  }
  function closeSheet() { sheet.hidden = true; removeArrow(); }

  function promptInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then(function (c) {
      track('pwa_install_prompt', { outcome: (c && c.outcome) || 'unknown' });
    }).catch(function () {});
    installPrompt = null;
    if (!sheet.hidden) render();
  }

  sheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) closeSheet();
    if (e.target.closest('.primary') && primaryAction) primaryAction.run();
    var copy = e.target.closest('[data-copy]');
    if (copy) {
      var input = copy.parentElement.querySelector('input');
      var done = function (ok) { copy.textContent = ok ? '복사됨' : '길게 눌러 복사'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(input.value).then(function () { done(true); }, function () { input.select(); done(false); });
      else { input.select(); try { done(document.execCommand('copy')); } catch (er) { done(false); } }
    }
  });

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    track('pwa_install_available');
    if (!sheet.hidden) render();
  });
  window.addEventListener('appinstalled', function () {
    closeSheet();
    document.querySelectorAll('[data-pwa-install]').forEach(function (n) { n.hidden = true; });
    track('pwa_installed', { platform: env.platform });
    toast('설치됐어요! 홈 화면의 방아머리 아이콘으로 열어 보세요', 5000);
  });

  // ---------------------------------------------------------------- 화면에 붙이기
  function mount() {
    document.body.appendChild(sheet);

    // 설치 버튼(페이지가 자리를 정해 둔 곳에)
    document.querySelectorAll('[data-pwa-install]').forEach(function (slot) {
      var small = slot.getAttribute('data-pwa-install') === 'small';
      var btn = el('<button type="button" class="pwa-btn' + (small ? ' small' : '') + '"><img src="' + ICON + '" alt="">' +
        (small ? '앱 설치' : '홈 화면에 바닷가 설치하기') + '</button>');
      btn.addEventListener('click', function () { openSheet(small ? 'small_button' : 'hero_button'); });
      slot.appendChild(btn);
    });

    // 앱 안 브라우저 배너
    if (env.inApp) {
      var dismissed = false;
      try { dismissed = sessionStorage.getItem('sea:inapp-dismissed') === '1'; } catch (e) {}
      var ext = externalOpenUrl();
      var targetRo = env.ios ? '사파리로' : '크롬으로';
      if (!dismissed) {
        var banner = el('<div class="pwa-banner" role="note"><p><b>' + env.inApp.name + '</b> 안에서 열렸어요.<br>' +
          (env.ios ? '사파리' : '크롬') + '에서 열면 앱으로 설치할 수 있어요.</p>' +
          '<button type="button" class="go">' + (ext ? targetRo + ' 열기' : '여는 방법') + '</button>' +
          '<button type="button" class="x" aria-label="안내 닫기">×</button></div>');
        banner.querySelector('.go').addEventListener('click', function () {
          track('pwa_open_external', { app: env.inApp.id, via: 'banner', direct: !!ext });
          if (ext) location.href = ext; else openSheet('banner');
        });
        banner.querySelector('.x').addEventListener('click', function () {
          banner.remove();
          try { sessionStorage.setItem('sea:inapp-dismissed', '1'); } catch (e) {}
        });
        document.body.insertBefore(banner, document.body.firstChild);
      }
      track('pwa_inapp_detected', { app: env.inApp.id, platform: env.platform });
    }

    // 카톡에서 넘어온 직후(?pwa=install) — 설치 안내를 바로 띄움. 주소에서는 꼬리표를 지움
    var params = new URLSearchParams(location.search);
    if (params.get('pwa') === 'install' && !env.inApp) {
      params.delete('pwa');
      var clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
      try { history.replaceState(null, '', clean); } catch (e) {}
      // 크롬의 설치 가능 신호(beforeinstallprompt)가 조금 늦게 오는 경우가 있어 살짝 기다렸다 띄움
      setTimeout(function () { openSheet('handoff'); }, installPrompt ? 0 : 900);
    }
  }

  window.SeaPWA = { open: openSheet, env: env };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
