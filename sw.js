'use strict';
/**
 * 헬로 대부도 오락실 — Service Worker
 * 목적은 "앱으로 설치 가능하게 하는 것"이 먼저이고, 캐시는 최소한만 한다.
 *  - 화면(HTML)·코드: 항상 네트워크 먼저 → 배포하면 바로 새 버전이 보임. 오프라인일 때만 캐시.
 *  - 아이콘·작은 이미지: 캐시 먼저(빠름), 뒤에서 조용히 최신화.
 *  - 건드리지 않는 것: /api/ (랭킹·신전·날씨는 항상 최신), 음악·효과음(mp3 — 재생 중
 *    구간 요청이 들어와서 서비스 워커가 끼면 아이폰에서 소리가 안 나는 경우가 있음),
 *    다른 사이트(구글 애널리틱스, 카카오, 폰트 등).
 * 버전을 올릴 때는 CACHE_NAME 숫자만 바꾸면 이전 캐시가 자동 정리된다.
 */
const CACHE_NAME = 'arcade-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/hall-of-fame.html',
  '/manifest.webmanifest',
  '/pwa.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // 하나가 실패해도 설치 자체는 계속
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (req.headers.has('range') || /\.(mp3|m4a|ogg|wav|mp4)$/i.test(url.pathname)) return;

  const putInCache = (res) => {
    if (res && res.status === 200 && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, copy));
    }
    return res;
  };

  const fresh = req.mode === 'navigate' || ['document', 'script', 'style', 'manifest'].includes(req.destination);
  if (fresh) {
    event.respondWith(
      fetch(req).then(putInCache).catch(() =>
        caches.match(req).then((c) => c || (req.mode === 'navigate' ? caches.match('/') : undefined))
      )
    );
    return;
  }

  // 이미지는 아이콘 폴더와 작은 공용 이미지만 캐시(게임 에셋 수백 장이 폰 저장공간을 차지하지 않게)
  if (req.destination === 'image' && url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then(putInCache).catch(() => cached);
        return cached || network;
      })
    );
  }
});
