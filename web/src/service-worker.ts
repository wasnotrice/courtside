/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Caches the app shell so Courtside opens with no signal. Adapted from the
// SvelteKit docs example. API requests are never cached: sync handles data.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `cache-${version}`;
// '/' is the SPA fallback page, cached as the shell for every route.
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([...ASSETS, '/'])));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			for (const key of keys) if (key !== CACHE) await caches.delete(key);
		})
	);
});

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;
	if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket')) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Build output and static files never change for a given version.
			if (ASSETS.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			// Everything else (including SPA routes): network first, then cache,
			// then the app shell, so deep links still open offline.
			try {
				const response = await fetch(event.request);
				if (response.status === 200) cache.put(event.request, response.clone());
				return response;
			} catch (err) {
				const cached = (await cache.match(event.request)) ?? (await cache.match('/'));
				if (cached) return cached;
				throw err;
			}
		})()
	);
});
