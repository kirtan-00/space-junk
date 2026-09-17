/* SPACE JUNK service worker.
   BUILD is bumped on deploy: a new build installs a new versioned cache and the old one is dropped on activate.
   Strategies:  index.html / junk3d.html   network first, cache fallback (offline still opens the page)
                assets/*                   stale while revalidate (instant, refreshed behind)
                three.js on the CDNs, Google Fonts   cache first (versioned files never change)
                assets/music/*             one copy in its own unversioned cache, never more, never blocks a build bump */
const BUILD = '2026-09-17a';
const CACHE = 'junk3d-' + BUILD;
const MUSIC = 'junk3d-music';
const CORE = [
  './', './index.html', './junk3d.html', './manifest.webmanifest',
  './assets/copy.js', './assets/crt.js', './assets/audio.js', './assets/tunnel.js', './assets/props.js',
  './assets/projects.json', './assets/fonts/archivo.woff2',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/Pass.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/MaskPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/shaders/RGBShiftShader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/shaders/CopyShader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/shaders/LuminosityHighPassShader.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/objects/Reflector.js'
];
const isCDN = u => /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(u);
const isMusic = u => /\/assets\/music\//.test(u);
const isPage = u => /\/(index\.html|junk3d\.html)?(\?.*)?(#.*)?$/.test(u) && !/\/assets\//.test(u);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* each core file on its own: one missing file never fails the install */
    await Promise.all(CORE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('junk3d-') && k !== CACHE && k !== MUSIC).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try { const r = await fetch(req); if (r && r.ok) c.put(req, r.clone()); return r; }
  catch (err) { const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit; throw err; }
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
  return r;
}
async function musicOnce(req) {
  /* range requests stream straight through; a full fetch is kept once, and any older track is evicted */
  if (req.headers.get('range')) return fetch(req);
  const c = await caches.open(MUSIC);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) { const keys = await c.keys(); await Promise.all(keys.map(k => c.delete(k))); c.put(req, r.clone()); }
  return r;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = req.url;
  if (isMusic(u)) { e.respondWith(musicOnce(req)); return; }
  if (isCDN(u)) { e.respondWith(cacheFirst(req)); return; }
  if (u.startsWith(self.location.origin)) {
    if (/\/assets\//.test(u)) { e.respondWith(staleWhileRevalidate(req)); return; }
    if (req.mode === 'navigate' || isPage(u)) { e.respondWith(networkFirst(req)); return; }
    if (/\/(sw\.js|manifest\.webmanifest)$/.test(u)) { e.respondWith(networkFirst(req)); return; }
  }
});
