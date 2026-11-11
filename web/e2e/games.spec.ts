// Games end to end, on phone-sized browsers against the dev servers: live entry with
// the phone going offline and back, a film correction reaching another phone, and a
// game another phone deleted brought back with the plays recorded offline.
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

// Every game a test makes starts with this, so cleanup can find them all.
const PREFIX = 'E2E ';
const gameName = () => PREFIX + Date.now().toString(36);

async function phone(browser: Browser): Promise<Page> {
	// Each phone is a context of its own, with its own local data, like a separate device.
	const context = await browser.newContext({
		...devices['iPhone 13'],
		baseURL: process.env.COURTSIDE_URL ?? 'https://localhost:5173',
		ignoreHTTPSErrors: true
	});
	const page = await context.newPage();
	await page.goto('/');
	await expect(page.getByText('All saved')).toBeVisible();
	return page;
}

const tab = (page: Page, name: string) => page.locator('nav.tabs').getByRole('button', { name: new RegExp(`^${name}`) });

async function gamesList(page: Page) {
	await tab(page, 'Games').click();
	await page.getByRole('tab', { name: 'Games', exact: true }).click();
}

/** The Sync tab's "Simulate offline" switch. Leaves the phone on the Games list. */
async function setOffline(page: Page, on: boolean) {
	await tab(page, 'Sync').click();
	const box = page.getByLabel('Simulate offline');
	if ((await box.isChecked()) !== on) await box.click();
	await gamesList(page);
}

async function newGame(page: Page, name: string) {
	await gamesList(page);
	await page.getByRole('button', { name: '+ New game' }).click();
	await page.locator('.sheet').getByPlaceholder('Lincoln').fill(name);
	await page.locator('.sheet').getByRole('button', { name: 'Create game' }).click();
	await expect(page.getByRole('group', { name: 'Player' }).locator('.pl').first()).toBeVisible();
}

async function openGame(page: Page, name: string) {
	await gamesList(page);
	await page.locator('.card', { hasText: name }).click();
	await expect(page.locator('header.game')).toBeVisible();
}

/** Records a made free throw for the nth player on the live screen. */
async function freeThrow(page: Page, nth = 0) {
	await page.getByRole('group', { name: 'Player' }).locator('.pl').nth(nth).click();
	await page.getByRole('group', { name: 'Our stats' }).getByRole('button', { name: 'FT ✓', exact: true }).click();
}

const score = (page: Page) => page.locator('header .score');

/** Deletes every game a test made, and lets go of any refusals they left behind. */
test.afterEach(async ({ browser }) => {
	const page = await phone(browser);
	await gamesList(page);
	while (await page.locator('.lost').count()) {
		await page.locator('.lost').first().getByRole('button', { name: 'Dismiss' }).click();
		await page.locator('.lost').first().getByRole('button', { name: /^Lose/ }).click();
	}
	const cards = page.locator('.card', { hasText: PREFIX });
	while (await cards.count()) {
		await cards.first().click();
		await page.locator('header .title').click();
		await page.locator('.sheet').getByRole('button', { name: 'Delete game' }).click();
		await page.locator('.sheet').getByRole('button', { name: 'Delete game' }).click();
		await expect(page.locator('header.game')).toHaveCount(0);
		await expect(page.getByText('All saved')).toBeVisible();
	}
	await page.context().close();
});

test('live entry keeps going offline, and syncs when the phone is back', async ({ browser }) => {
	const name = gameName();
	const a = await phone(browser);
	await newGame(a, name);
	await freeThrow(a);
	await expect(a.getByText('All saved')).toBeVisible();

	await a.locator('header .back').click();
	await setOffline(a, true);
	await openGame(a, name);
	await freeThrow(a, 0);
	await freeThrow(a, 1);
	await expect(score(a)).toHaveText('3–0');

	// Leaving with plays still on the phone asks the scorer to get signal first.
	await a.locator('header .back').click();
	await expect(a.locator('.sheet')).toContainText('2 changes are saved on this phone');
	await a.locator('.sheet').getByRole('button', { name: 'Leave the game screen' }).click();
	await setOffline(a, false);
	await expect(a.getByText('All saved')).toBeVisible();

	// Another phone gets all three.
	const b = await phone(browser);
	await openGame(b, name);
	await expect(score(b)).toHaveText('3–0');
});

test('a film correction on one phone shows up on another', async ({ browser }) => {
	const name = gameName();
	const a = await phone(browser);
	await newGame(a, name);
	await freeThrow(a);
	await expect(a.getByText('All saved')).toBeVisible();

	const b = await phone(browser);
	await openGame(b, name);
	await b.getByRole('tab', { name: 'Plays' }).click();
	await expect(b.locator('main h3').first()).toHaveText(/^1st/);

	await a.getByRole('tab', { name: 'Plays' }).click();
	await a.locator('.prow-p').first().click();
	const sheet = a.locator('.sheet');
	await sheet.getByLabel('Period').selectOption({ index: 1 });
	await sheet.getByLabel('Film time').fill('12:34');
	await sheet.getByRole('button', { name: 'Save' }).click();
	await expect(a.getByText('All saved')).toBeVisible();

	// B is poked and pulls, with no reload.
	await expect(b.locator('main h3').first()).toHaveText(/^2nd/);
	await expect(b.locator('.prow-p .film').first()).toHaveText('▶ 12:34');
});

test('a game deleted on another phone comes back with the plays recorded offline', async ({ browser }) => {
	const name = gameName();
	const a = await phone(browser);
	await newGame(a, name);
	await freeThrow(a);
	await expect(a.getByText('All saved')).toBeVisible();
	await a.locator('header .back').click();

	// A goes offline and keeps recording; B deletes the game.
	await setOffline(a, true);
	await openGame(a, name);
	await freeThrow(a, 1);
	const b = await phone(browser);
	await openGame(b, name);
	await b.locator('header .title').click();
	await b.locator('.sheet').getByRole('button', { name: 'Delete game' }).click();
	await b.locator('.sheet').getByRole('button', { name: 'Delete game' }).click();
	await expect(b.getByText('All saved')).toBeVisible();

	await a.locator('header .back').click();
	await a.locator('.sheet').getByRole('button', { name: 'Leave the game screen' }).click();
	await setOffline(a, false);
	const note = a.locator('.lost');
	await expect(note).toContainText('A game was deleted on another phone. 1 change');
	await note.getByRole('button', { name: 'Restore the game' }).click();
	await expect(note).toHaveCount(0);
	await expect(a.locator('.card', { hasText: name })).toContainText('2–0');
	await expect(a.getByText('All saved')).toBeVisible();

	await b.reload();
	await openGame(b, name);
	await expect(score(b)).toHaveText('2–0');
});
