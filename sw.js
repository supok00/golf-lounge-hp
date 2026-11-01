/* 오프라인에서도 앱 화면이 열리도록 화면 파일만 캐시한다.
 * 데이터(GitHub API)는 캐시하지 않는다 — 항상 최신을 읽고, 실패하면 앱이 자체 캐시를 쓴다.
 * 화면 파일은 '캐시 먼저 보여주고 뒤에서 갱신' 방식이다. 배포할 때 js/version.js의 APP_VERSION을 올리면 캐시 이름이 바뀌어 새 서비스 워커가 설치되고,
 * 앱이 「새 버전이 있습니다 — 지금 적용」 줄을 띄워 바로 바꿀 수 있게 한다(js/app.js). */
importScripts("js/version.js");   // APP_VERSION — 버전을 올리면 캐시 이름이 바뀌어 새 버전이 설치된다
const CACHE = "hp-shell-" + APP_VERSION + "-" + (typeof APP_BUILD !== "undefined" ? APP_BUILD : "");   // 버전이 같아도 배포 번호가 바뀌면 새로 설치
const SHELL = ["./", "index.html", "js/version.js", "css/style.css", "js/localstore.js", "js/vendor/chart.umd.min.js", "js/stats.js", "js/clubs.js", "js/korea-map.js", "js/regions.js", "js/smartscore.js", "js/companions.js", "js/guide.js", "js/app.js", "manifest.webmanifest", "icons/icon-192.png",
  "data/courses.json"];   // 골프장 정보도 미리 받아 두어 필드(오프라인)에서 홀별 공략이 보이게. 홀 그림은 한 번 열면 저장됨

self.addEventListener("install", (e) => {
  // 새 버전 파일은 브라우저 HTTP 캐시를 거치지 않고 받는다(오래된 파일이 새 캐시에 들어가지 않게)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 웹판 저장소의 골프장 정보·홀 그림은 필드(오프라인)에서도 보이도록 저장한다
  const webCourse = url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith("/supok00/golf-lounge/main/data/courses");
  if (e.request.method !== "GET" || (url.origin !== location.origin && !webCourse)) return;   // 글자 인식 등 다른 사이트 요청은 그대로
  // 골프장 정보 목록(json)은 새로 등록된 골프장이 바로 보이게 네트워크 먼저, 안 되면 저장본
  if (webCourse && url.pathname.endsWith(".json")) {
    e.respondWith(caches.open(CACHE).then((c) => fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => c.match(e.request, { ignoreSearch: true }))));
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});
