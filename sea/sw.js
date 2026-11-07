'use strict';
/* 방아머리 바닷가 — 설치용 서비스 워커. 화면은 항상 네트워크 먼저(배포하면 바로 새 버전), 오프라인일 때만 캐시.
   /sea/api(물때·날씨)는 건드리지 않는다. 버전을 올릴 땐 CACHE 이름만 바꾼다. */
const CACHE = 'sea-shell-v1';
const SHELL = ['/sea/', '/sea/suncalc.js', '/sea/manifest.webmanifest', '/sea/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sea-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith('/sea/') || u.pathname.startsWith('/sea/api')) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('/sea/'))));
});
