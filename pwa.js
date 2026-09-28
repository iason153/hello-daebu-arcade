/*
 * 헬로 대부도 오락실 — 앱 설치(PWA) 도우미
 * Pebble/Lineup의 설치 흐름(wireInstall·Env)을 오락실용으로 옮긴 독립 스크립트.
 * 페이지에 <script src="/pwa.js" defer></script> 한 줄과, 설치 버튼을 놓고 싶은 자리에
 * <div data-pwa-install></div> 를 두면 된다(없으면 버튼 없이 안내 배너만 뜸).
 *
 * 흐름
 *  - 카카오톡 등 "앱 안 브라우저"에서 열림 → 맨 위 배너 [크롬으로 열기](아이폰은 사파리)
 *    · 안드로이드: 크롬을 직접 지정해서 연다(크롬이 없으면 기본 브라우저)
 *    · 아이폰 카카오톡: 카카오 공식 "외부 브라우저로 열기"로 사파리에서 연다
 *    · 넘어간 주소에 ?pwa=install 을 붙여서, 크롬/사파리에서 열리자마자 설치 안내가 바로 뜨게 함
 *  - 안드로이드 크롬 등: [지금 설치하기] 한 번 → 크롬 설치 창에서 [설치]
 *  - 아이폰 사파리: 애플이 "버튼 한 번 설치"를 막아 둬서, 공유 버튼 → 홈 화면에 추가 3단계를 그림으로 안내
 *  - 이미 설치된 앱으로 열었으면 설치 관련 UI는 전부 숨김
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 서비스 워커
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

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
    var u = new URL(window.location.href);
    u.searchParams.set('pwa', 'install');
    return u.toString();
  }
  function externalOpenUrl() {
    if (!env.inApp) return null;
    var target = handoffUrl();
    if (env.android) {
      var u = new URL(target);
      return 'intent://' + u.host + u.pathname + u.search +
        '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(target) + ';end';
    }
    if (env.inApp.id === 'kakao') return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(target);
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
      'background:linear-gradient(135deg,#ffc857,#ff9f45);color:#2a1a08;font-family:"Jua",sans-serif;font-size:17px;' +
      'box-shadow:0 10px 24px -12px rgba(255,160,70,.8)}' +
    '.pwa-btn img{width:26px;height:26px;border-radius:7px}' +
    '.pwa-btn.small{padding:7px 14px 7px 8px;font-size:14px}' +
    '.pwa-btn.small img{width:22px;height:22px;border-radius:6px}' +
    '.pwa-banner{position:sticky;top:0;z-index:900;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;' +
      'background:#ffc857;color:#2a1a08;font-family:"Noto Sans KR",sans-serif;font-size:13px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
    '.pwa-banner p{flex:1;margin:0}.pwa-banner b{font-weight:700}' +
    '.pwa-banner .go{flex:none;border:none;border-radius:999px;padding:9px 14px;background:#0f1a30;color:#ffc857;font-weight:700;font-size:13px;cursor:pointer}' +
    '.pwa-banner .x{flex:none;border:none;background:none;font-size:20px;line-height:1;padding:4px 6px;color:#2a1a08;cursor:pointer}' +
    '.pwa-sheet{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;justify-content:center}' +
    '.pwa-sheet[hidden]{display:none}' +
    '.pwa-sheet .bd{position:absolute;inset:0;background:rgba(5,10,25,.6)}' +
    '.pwa-sheet .panel{position:relative;width:100%;max-width:480px;background:#f6efe0;color:#1a2440;border-radius:22px 22px 0 0;' +
      'padding:10px 20px calc(20px + env(safe-area-inset-bottom,0px));font-family:"Noto Sans KR",sans-serif;max-height:88vh;overflow:auto}' +
    '.pwa-sheet .grip{width:40px;height:4px;border-radius:2px;background:#cdbf9f;margin:0 auto 14px}' +
    '.pwa-sheet .head{display:flex;gap:14px;align-items:center;margin-bottom:10px}' +
    '.pwa-sheet .head img{width:60px;height:60px;border-radius:15px;box-shadow:0 6px 14px rgba(15,26,48,.3)}' +
    '.pwa-sheet h2{font-family:"Jua",sans-serif;font-size:21px;font-weight:400;margin:0;line-height:1.3}' +
    '.pwa-sheet .desc{font-size:14px;color:#51607e;margin:2px 0 0}' +
    '.pwa-sheet ol{list-style:none;counter-reset:s;margin:14px 0 0;padding:0}' +
    '.pwa-sheet li{counter-increment:s;display:flex;gap:10px;align-items:flex-start;padding:9px 0;font-size:15px;border-top:1px solid #e6dcc6}' +
    '.pwa-sheet li::before{content:counter(s);flex:none;width:24px;height:24px;border-radius:50%;background:#0f1a30;color:#ffc857;' +
      'font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;margin-top:1px}' +
    '.pwa-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:7px;background:#fff;border:1px solid #d9ccb0;' +
      'font-weight:700;font-size:14px;vertical-align:1px;white-space:nowrap}' +
    '.pwa-chip svg{width:16px;height:16px;color:#2f7cf6}' +
    '.pwa-sheet .note{font-size:12.5px;color:#6b7690;margin:10px 0 0}' +
    '.pwa-sheet .copy{display:flex;gap:6px;margin-top:10px}' +
    '.pwa-sheet .copy input{flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:1px solid #d9ccb0;background:#fff;font-size:13px;color:#1a2440}' +
    '.pwa-sheet .copy button{border:none;border-radius:9px;padding:0 12px;background:#0f1a30;color:#fff;font-size:13px;cursor:pointer}' +
    '.pwa-sheet .acts{display:grid;gap:8px;margin-top:16px}' +
    '.pwa-sheet .primary{border:none;border-radius:14px;padding:15px;background:#ff6b4a;color:#fff;font-family:"Jua",sans-serif;font-size:19px;cursor:pointer}' +
    '.pwa-sheet .later{border:none;background:none;padding:8px;color:#6b7690;font-size:14px;cursor:pointer}' +
    '.pwa-arrow{position:fixed;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1001;' +
      'font-size:34px;animation:pwaBob 1s ease-in-out infinite;pointer-events:none}' +
    '@keyframes pwaBob{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,8px)}}' +
    '@media (prefers-reduced-motion:reduce){.pwa-arrow{animation:none}}' +
    '.pwa-toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:1100;' +
      'background:rgba(15,26,48,.95);color:#fff;padding:11px 16px;border-radius:12px;font-size:14px;font-family:"Noto Sans KR",sans-serif;max-width:calc(100% - 32px)}';
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
  function chip(label, icon) { return '<span class="pwa-chip">' + (icon || '') + label + '</span>'; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  var ICON = '/icons/icon-192.png';
  var APP_URL = 'https://daebugame.com/';

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
        steps = ['아래 ' + chip(targetRo + ' 열기') + ' 버튼을 눌러요.', target + '에서 오락실이 열리면 설치 안내가 바로 떠요.'];
      } else {
        steps = env.ios
          ? ['화면 아래(또는 위)의 ' + chip('', I.hdots) + ' 또는 ' + chip('', I.share) + ' 버튼을 눌러요.', chip('Safari로 열기') + '를 눌러요.', '사파리에서 오락실이 열리면 설치 안내가 떠요.']
          : ['화면 오른쪽 위 ' + chip('', I.dots) + ' 버튼을 눌러요.', chip('다른 브라우저로 열기') + ' 또는 ' + chip('Chrome으로 열기') + '를 눌러요.', '크롬에서 오락실이 열리면 설치 안내가 떠요.'];
      }
      note = '잘 안 되면 아래 주소를 복사해서 크롬(아이폰은 사파리) 주소창에 붙여넣어도 돼요.';
      extra = '<div class="copy"><input type="text" readonly value="' + APP_URL + '" aria-label="오락실 주소"><button type="button" data-copy>주소 복사</button></div>';
    } else if (installPrompt) {
      t = '홈 화면에 오락실 설치하기';
      d = '버튼 한 번이면 끝나요. 홈 화면에 오락실 아이콘이 생겨요.';
      primaryAction = { label: '지금 설치하기', run: promptInstall };
      steps = ['아래 ' + chip('지금 설치하기') + '를 눌러요.', '뜨는 창에서 ' + chip('설치') + '를 눌러요.'];
      note = '설치하면 주소를 칠 필요 없이 아이콘 한 번으로 바로 게임을 할 수 있어요.';
    } else if (env.ios) {
      t = '아이폰 홈 화면에 추가하기';
      d = env.browser === 'safari' ? '사파리에서 세 번만 누르면 돼요.' : '브라우저의 공유 버튼에서 추가할 수 있어요.';
      steps = env.browser === 'safari'
        ? ['화면 아래 가운데 ' + chip('', I.share) + ' 공유 버튼을 눌러요. (안 보이면 화면을 살짝 위로 올려 보세요)', '목록을 내려서 ' + chip('홈 화면에 추가', I.plus) + '를 눌러요.', '오른쪽 위 ' + chip('추가') + '를 눌러요.']
        : ['주소창 옆의 ' + chip('', I.share) + ' 공유 버튼을 눌러요.', chip('홈 화면에 추가', I.plus) + '를 눌러요.', chip('추가') + '를 눌러요.'];
      note = '아이폰은 애플 정책 때문에 버튼 한 번 설치가 안 돼서, 직접 추가하는 방법을 안내해 드려요.';
    } else if (env.android && env.browser === 'samsung') {
      t = '갤럭시 홈 화면에 추가하기';
      d = '삼성 인터넷에서 추가하는 방법이에요.';
      steps = ['화면 아래 오른쪽 ' + chip('', I.menu) + ' 메뉴를 눌러요.', chip('현재 페이지 추가') + '(또는 "페이지 추가")를 눌러요.', chip('홈 화면') + '을 고르고 ' + chip('추가') + '를 눌러요.'];
      note = '주소창에 ⬇ 모양 설치 아이콘이 보이면 그걸 눌러도 돼요.';
    } else if (env.android) {
      t = '홈 화면에 오락실 설치하기';
      d = '크롬 메뉴에서 추가할 수 있어요.';
      steps = ['화면 오른쪽 위 ' + chip('', I.dots) + ' 메뉴를 눌러요.', chip('홈 화면에 추가') + ' 또는 ' + chip('앱 설치') + '를 눌러요.', chip('설치') + '(또는 "추가")를 눌러요.'];
      note = '이미 설치했다면 홈 화면의 오락실 아이콘으로 열어 주세요.';
    } else {
      t = '휴대폰에서 하면 더 재밌어요';
      d = '오락실은 휴대폰용으로 만들었어요. 아래 주소를 휴대폰으로 보내서 열어 보세요.';
      steps = ['휴대폰 크롬(아이폰은 사파리)에서 아래 주소를 열어요.', chip('앱으로 설치하기') + '를 누르면 기기에 맞는 방법이 나와요.'];
      note = 'PC 크롬에서도 주소창 오른쪽 설치 아이콘으로 설치할 수 있어요.';
      extra = '<div class="copy"><input type="text" readonly value="' + APP_URL + '" aria-label="오락실 주소"><button type="button" data-copy>주소 복사</button></div>';
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
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(APP_URL).then(function () { done(true); }, function () { input.select(); done(false); });
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
    toast('설치됐어요! 홈 화면의 오락실 아이콘으로 열어 보세요 🎮', 5000);
  });

  // ---------------------------------------------------------------- 화면에 붙이기
  function mount() {
    document.body.appendChild(sheet);

    // 설치 버튼(페이지가 자리를 정해 둔 곳에)
    document.querySelectorAll('[data-pwa-install]').forEach(function (slot) {
      var small = slot.getAttribute('data-pwa-install') === 'small';
      var btn = el('<button type="button" class="pwa-btn' + (small ? ' small' : '') + '"><img src="' + ICON + '" alt="">' +
        (small ? '앱 설치' : '홈 화면에 오락실 설치하기') + '</button>');
      btn.addEventListener('click', function () { openSheet(small ? 'small_button' : 'hero_button'); });
      slot.appendChild(btn);
    });

    // 앱 안 브라우저 배너
    if (env.inApp) {
      var dismissed = false;
      try { dismissed = sessionStorage.getItem('arcade:inapp-dismissed') === '1'; } catch (e) {}
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
          try { sessionStorage.setItem('arcade:inapp-dismissed', '1'); } catch (e) {}
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

  window.ArcadePWA = { open: openSheet, env: env };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
