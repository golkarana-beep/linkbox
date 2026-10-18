const CACHE_NAME = 'linkbox-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js'
];

// نصب و ذخیره فایل‌ها در کش
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// مدیریت درخواست‌ها (آفلاین اول، سپس شبکه)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // اگر فایل در کش بود برگردان، در غیر این صورت از شبکه بگیر
        return response || fetch(event.request);
      })
  );
});