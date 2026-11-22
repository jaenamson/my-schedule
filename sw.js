
const CACHE = "my-schedule-cache-v11";

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

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // 外部 API 요청은 서비스 워커 캐시를 사용하지 않음
  if (url.origin !== self.location.origin) {
    return;
  }

  const isMainFile =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/index.html") ||
    event.request.mode === "navigate";

  if (isMainFile) {
    // メインファイルはネットワーク優先
    event.respondWith(
      fetch(new Request(event.request, { cache: "no-store" }))
        .then(response => {
          if (response.ok) {
            const copy = response.clone();

            caches.open(CACHE).then(cache =>
              cache.put(event.request, copy)
            );
          }

          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);

          return cached || caches.match("./index.html");
        })
    );

    return;
  }

  // CSS・画像などはキャッシュ優先
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();

          caches.open(CACHE).then(cache =>
            cache.put(event.request, copy)
          );
        }

        return response;
      })
    )
  );
});
