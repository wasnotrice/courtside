import { sveltekit } from '@sveltejs/kit/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

const api = process.env.COURTSIDE_API ?? 'http://localhost:4000';

export default defineConfig({
	// HTTPS with a self-signed certificate, so a phone on the LAN gets a secure
	// context: service workers (the offline app shell) and crypto.randomUUID
	// only exist on HTTPS pages or localhost. Accept the certificate warning once.
	plugins: [sveltekit(), basicSsl({ name: 'courtside-dev' })],
	server: {
		// Same origin as the app, so there's no CORS to configure. Phoenix
		// itself stays on plain HTTP behind the proxy.
		proxy: {
			'/api': api,
			'/socket': { target: api, ws: true }
		}
	},
	test: {
		include: ['src/**/*.test.ts']
	}
});
