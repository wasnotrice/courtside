import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// A static single-page app: every route falls back to index.html, and the
		// service worker caches the shell so the app opens without signal.
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
