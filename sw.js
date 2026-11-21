
const CACHE = "my-schedule-cache-v4";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

// 최신 HTML 및 앱 파일 우선 가져오기
self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 다른 도메인의 요청은 처리하지 않음
  if (url.origin !== self.location.origin) return;

  const isAppShell =
    request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/manifest.json");

  if (isAppShell) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-cache" }))
        .then(response => {
          if (response.ok) {
            const copy = response.clone();

            caches.open(CACHE).then(cache =>
              cache.put(request, copy)
            );
          }

          return response;
        })
        .catch(async () => {
          return (
            await caches.match(request) ||
            caches.match("./index.html")
          );
        })
    );

    return;
  }

  // 이미지 등 나머지 파일은 기존 캐시 우선
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();

          caches.open(CACHE).then(cache =>
            cache.put(request, copy)
          );
        }

        return response;
      });
    })
  );
});

// 백그라운드 푸시 알림 수신
self.addEventListener("push", event => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = {
        title: "My Schedule",
        body: event.data.text()
      };
    }
  }

  const title = data.title || "My Schedule";

  const options = {
    body: data.body || "予定の時間です。",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: {
      url: data.url || "./"
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 알림을 누르면 앱 열기
self.addEventListener("notificationclick", event => {
  event.notification.close();

  const url = new URL(
    event.notification.data?.url || "./",
    self.location.origin
  ).href;

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(clients => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin)) {
          return client.focus();
        }
      }

      return self.clients.openWindow(url);
    })
  );
});
