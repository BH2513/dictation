/* 데스크탑·폰에 앱으로 설치하기 위한 서비스 워커.

   **반드시 network-first 로 둔다.** 캐시를 먼저 주는 방식으로 짜면
   고친 코드가 기기에 영영 안 내려가는 덫이 된다 — 이 저장소에서 이미 두 번 겪은 문제다.
   인터넷이 되면 언제나 새로 받아오고, 캐시는 오프라인일 때만 쓴다.

   자료 파일(data/)도 같은 규칙을 탄다. 오늘 문장이 새로 올라오면 바로 보인다. */
var CACHE = 'dictation-2026-08-25';

var SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './store.js',
  './record.js',
  './icon-192.png',
  './icon-512.png',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();   // 새 워커를 기다리지 않고 바로 바꾼다
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .catch(function () { /* 하나라도 못 받으면 그냥 넘어간다. 설치가 막히면 안 된다 */ })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k === CACHE) ? null : caches['delete'](k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // 유튜브처럼 남의 주소는 건드리지 않는다
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // cache: 'no-cache' 로 브라우저 HTTP 캐시를 건너뛰고 서버에 꼭 물어본다.
  // 이게 없으면 워커가 새로 받아온다고 해 놓고 실제로는 브라우저에 남은 옛 파일을 준다.
  // 확인해 보고 알았다 — 파일을 고쳐도 새로고침에 안 내려왔다
  var fresh;
  try { fresh = new Request(req, { cache: 'no-cache' }); }
  catch (err) { fresh = req; }

  e.respondWith(
    fetch(fresh).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      // 인터넷이 없을 때만 캐시를 준다.
      // ?v= 가 붙은 주소는 값이 달라도 찾을 수 있게 물음표 뒤를 무시한다
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html', { ignoreSearch: true });
      });
    })
  );
});
