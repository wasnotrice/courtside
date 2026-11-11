// End-to-end tests: real browsers against the dev servers (Phoenix and Vite, see the
// README). They write to the dev database and delete what they create. Run with
// `npm run test:e2e`; PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of
// Playwright's own Chromium (`npx playwright install chromium`).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	// The tests share one organization's data, so they run one at a time.
	workers: 1,
	timeout: 60_000,
	use: {
		...devices['iPhone 13'],
		defaultBrowserType: 'chromium',
		channel: process.env.PLAYWRIGHT_CHANNEL,
		baseURL: process.env.COURTSIDE_URL ?? 'https://localhost:5173',
		ignoreHTTPSErrors: true
	}
});
