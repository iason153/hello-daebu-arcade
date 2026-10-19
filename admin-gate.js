// /admin-gate.js — 게임 설정 패널(?dev=1)을 대표(관리자)만 열게 한다.
//
// ?dev=1 로 열면 관리자 비밀번호를 묻고, 서버(/api/config admin_check)가 ADMIN_SECRET과
// 맞는지 확인해 준 경우에만 true. 주소만 아는 사람은 패널도, 폰에 저장된 설정값도 못 쓴다.
// 맞은 비밀번호는 이 탭(sessionStorage)에만 기억 — 탭을 닫으면 다시 묻는다.
(function () {
  var KEY = 'arcade_admin';
  function check(pw) {
    return fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': pw },
      body: JSON.stringify({ action: 'admin_check' })
    }).then(function (r) { return r.ok ? r.json() : { ok: false }; })
      .then(function (d) { return !!(d && d.ok); })
      .catch(function () { return false; });
  }
  window.ArcadeAdmin = {
    wanted: /[?&]dev=1(&|$)/.test(location.search),
    verify: function () {
      if (!this.wanted) return Promise.resolve(false);
      var pw = '';
      try { pw = sessionStorage.getItem(KEY) || ''; } catch (e) {}
      if (!pw) pw = window.prompt('관리자 비밀번호') || '';
      if (!pw) return Promise.resolve(false);
      return check(pw).then(function (ok) {
        try { ok ? sessionStorage.setItem(KEY, pw) : sessionStorage.removeItem(KEY); } catch (e) {}
        if (!ok) window.alert('관리자 비밀번호가 맞지 않아요. 설정 패널 없이 정식 게임으로 열어요.');
        return ok;
      });
    }
  };
})();
