<!-- Recording a game as it happens: a player (or Team), then a stat; the other team's
plays below; a skippable follow-up question after some plays; the last few plays. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { FOUL_TYPES, type FoulType, type Stat } from '$lib/sync/basketball';
	import type { Play, Player } from '$lib/sync/types';
	import {
		bonusFor,
		boxScore,
		foulTrouble,
		periodLabel,
		playsOf,
		positionAtEnd,
		positionBetween,
		teamFouls,
		type Bonus
	} from './basketball';
	import { getApp } from './context.svelte';
	import GameHeader from './GameHeader.svelte';
	import { playersForGame } from './games';
	import {
		blockable,
		currentPeriod,
		describePlay,
		followUpFor,
		pairedPlay,
		reboundPlay,
		shortNames,
		STAT_LABEL,
		STAT_PAD,
		type FollowUp,
		type Rebounder
	} from './live';
	import RejectionNote from './RejectionNote.svelte';
	import Sheet from './Sheet.svelte';

	let { gameId }: { gameId: string } = $props();

	const app = getApp();
	const view = $derived(app.view);
	const snap = $derived(app.sync.snapshot);
	// App closes this screen when the game disappears, so it's always set while mounted.
	const game = $derived(view.games.get(gameId)!);
	const rules = $derived(game.rules);
	const plays = $derived(playsOf(view, gameId));
	const box = $derived(boxScore(plays));

	// Who can be tapped: the team's roster, then anyone else with a play in this game or
	// picked from the program for it (call-ups).
	let added = $state<string[]>([]);
	const rows = $derived(playersForGame(view, game, plays, added));
	const names = $derived(shortNames(rows));
	const nameOf = (id: string) => names.get(id) ?? view.players.get(id)?.name ?? 'Player';

	let period = $state(1);
	/** A player's id, 'team', or nothing yet. Stays selected after a stat, for and-ones. */
	let selected = $state<string | null>(null);
	/**
	 * The open question and the play it's about. For a rebound, `blocked` means the block
	 * is recorded (or being asked about: `askBlocker`). For a block, `shooter` is our
	 * player whose shot it was, once picked (null for Team).
	 */
	let followUp = $state<{
		kind: FollowUp;
		play: Play;
		blocked?: boolean;
		askBlocker?: boolean;
		shooter?: string | null;
	} | null>(null);

	onMount(() => {
		period = currentPeriod(plays);
		keepAwake();
	});

	const us = $derived({ fouls: teamFouls(plays, rules, 'us', period), bonus: bonusFor(plays, rules, 'them', period) });
	const them = $derived({ fouls: teamFouls(plays, rules, 'them', period), bonus: bonusFor(plays, rules, 'us', period) });
	const BONUS_LABEL: Record<Bonus, string> = { none: '', one_and_one: '1-and-1', two_shots: 'Bonus' };

	// --- recording ------------------------------------------------------------------------

	async function record(
		side: Play['side'],
		stat: Stat,
		playerId: string | null,
		position?: string
	): Promise<Play | null> {
		followUp = null;
		const now = Date.now();
		const play: Play = {
			id: crypto.randomUUID(),
			game_id: gameId,
			side,
			player_id: playerId,
			stat,
			foul_type: null,
			assist_player_id: null,
			drawn_by_player_id: null,
			period,
			clock: null,
			video_at: null,
			position: position ?? positionAtEnd(plays, now),
			recorded_at: now
		};
		const { foul_type: _f, assist_player_id: _a, drawn_by_player_id: _d, clock: _c, video_at: _v, ...args } = play;
		return (await app.mutate({ name: 'play.put', args })) ? play : null;
	}

	/** Records a play, then asks its follow-up question. */
	async function recordAndAsk(side: Play['side'], stat: Stat, playerId: string | null) {
		const play = await record(side, stat, playerId);
		const kind = play && followUpFor(play);
		followUp = play && kind ? { kind, play } : null;
	}

	const ours = (stat: Stat) => selected && recordAndAsk('us', stat, selected === 'team' ? null : selected);
	const theirs = (stat: Stat) => recordAndAsk('them', stat, null);

	/** Answers the follow-up by changing the play it asked about. */
	async function amend(change: { assist_player_id?: string; foul_type?: FoulType; drawn_by_player_id?: string }) {
		if (!followUp) return;
		const id = followUp.play.id;
		followUp = null;
		await app.mutate({ name: 'play.put', args: { id, ...change } });
	}

	async function rebound(by: Rebounder) {
		if (!followUp) return;
		const r = reboundPlay(followUp.play.side, by);
		await record(r.side, r.stat, r.player_id);
	}

	/** The other half of a steal or turnover: their steal, or our player's turnover. */
	async function pair(player: string | null = null) {
		if (!followUp) return;
		const p = pairedPlay(followUp.play, player);
		await record(p.side, p.stat, p.player_id);
	}

	/** "Blocked" on a missed shot: records the block, then goes on asking for the rebound. */
	async function block(player: string | null = null) {
		if (!followUp) return;
		const miss = followUp.play;
		const p = pairedPlay(miss, player);
		if (await record(p.side, p.stat, p.player_id)) followUp = { kind: 'rebound', play: miss, blocked: true };
	}

	/** The shot a block stopped: recorded just before the block, then the rebound question. */
	async function blockedShot(shot: 'fg2_missed' | 'fg3_missed') {
		if (!followUp) return;
		const blk = followUp.play;
		const p = pairedPlay(blk, followUp.shooter ?? null, shot);
		const i = plays.findIndex((x) => x.id === blk.id);
		const position = i < 0 ? undefined : positionBetween(plays[i - 1]?.position ?? null, blk.position);
		const miss = await record(p.side, p.stat, p.player_id, position);
		if (miss) followUp = { kind: 'rebound', play: miss, blocked: true };
	}

	async function remove(play: Play) {
		if (followUp?.play.id === play.id) followUp = null;
		await app.mutate({ name: 'play.delete', args: { id: play.id } });
	}

	// --- the rest of the screen -------------------------------------------------------------

	const rejections = $derived(
		snap.rejections.filter((r) => {
			const args = r.args as Record<string, unknown>;
			return args.game_id === gameId || (r.name === 'game.put' && args.id === gameId);
		})
	);

	let sheet = $state<'player' | null>(null);

	const others = $derived.by(() => {
		const shown = new Set(rows.map((r) => r.player.id));
		const programId = view.teams.get(game.team_id)?.program_id;
		return [...view.players.values()]
			.filter((p) => p.program_id === programId && !shown.has(p.id))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	function pickOther(player: Player) {
		added = [...added, player.id];
		selected = player.id;
		sheet = null;
	}

	// Screen wake lock, so the phone doesn't sleep during the game.
	let wakeLock: WakeLockSentinel | null = null;
	async function keepAwake() {
		try {
			if (navigator.wakeLock && !wakeLock) {
				wakeLock = await navigator.wakeLock.request('screen');
				wakeLock.addEventListener('release', () => (wakeLock = null));
			}
		} catch {
			// Not supported or not allowed; the screen works without it.
		}
	}
	$effect(() => () => void wakeLock?.release());

	const FOUL_TYPE_LABEL: Record<FoulType, string> = {
		personal: 'Personal',
		offensive: 'Offensive',
		technical: 'Technical',
		flagrant: 'Flagrant'
	};
	const recent = $derived(plays.slice(-5).reverse());
	const shooterOf = $derived(followUp?.play.player_id ?? null);
</script>

<svelte:window onvisibilitychange={() => document.visibilityState === 'visible' && keepAwake()} />

<GameHeader {game} score={box.score}>
	<div class="row">
		<div class="period" role="group" aria-label="Period">
			<button aria-label="Previous period" disabled={period <= 1} onclick={() => period--}>‹</button>
			<b>{periodLabel(rules, period)}</b>
			<button aria-label="Next period" onclick={() => period++}>›</button>
		</div>
		<span class="fouls">
			Fouls: us {us.fouls}{#if us.bonus !== 'none'}<span class="bonus">{BONUS_LABEL[us.bonus]}</span>{/if}
			· them {them.fouls}{#if them.bonus !== 'none'}<span class="bonus">{BONUS_LABEL[them.bonus]}</span>{/if}
		</span>
	</div>
</GameHeader>

<main class="live">
	{#each rejections as r (r.mutation_id)}<RejectionNote rejection={r} standalone />{/each}

	<div class="players" role="group" aria-label="Player">
		{#each rows as r (r.player.id)}
			{@const t = foulTrouble(plays, rules, r.player.id)}
			<button class="pl" class:on={selected === r.player.id} aria-pressed={selected === r.player.id} onclick={() => (selected = r.player.id)}>
				<span class="jn">{r.jersey || '–'}</span>
				<span class="nm">{names.get(r.player.id)}</span>
				{#if t.ejected}<span class="pf out">EJ</span>
				{:else if t.fouledOut}<span class="pf out">OUT</span>
				{:else if t.fouls}<span class="pf" class:warn={t.fouls >= rules.foul_out_at - 1}>{t.fouls}F</span>{/if}
			</button>
		{/each}
		<button class="pl team" class:on={selected === 'team'} aria-pressed={selected === 'team'} onclick={() => (selected = 'team')}>
			<span class="nm">Team</span>
		</button>
		{#if others.length}
			<button class="pl more" onclick={() => (sheet = 'player')}><span class="nm">+ Player</span></button>
		{/if}
	</div>

	<div class="pad" role="group" aria-label="Our stats">
		{#each STAT_PAD as stat (stat)}
			<button class="k st" class:make={stat.endsWith('_made')} disabled={!selected} onclick={() => ours(stat)}>
				{STAT_LABEL[stat]}
			</button>
		{/each}
	</div>
	{#if !selected}<p class="hint">Tap a player, or Team, then the stat.</p>{/if}

	<h3>Them</h3>
	<div class="pad" role="group" aria-label="Their stats">
		{#each STAT_PAD as stat (stat)}
			<button class="k st" class:make={stat.endsWith('_made')} onclick={() => theirs(stat)}>{STAT_LABEL[stat]}</button>
		{/each}
	</div>

	{#if followUp}
		<div class="follow" role="group" aria-label="Follow-up">
			{#if followUp.kind === 'assist'}
				<b>Assist?</b>
				{#each rows.filter((r) => r.player.id !== shooterOf) as r (r.player.id)}
					<button onclick={() => amend({ assist_player_id: r.player.id })}>{nameOf(r.player.id)}</button>
				{/each}
			{:else if followUp.kind === 'rebound' && followUp.askBlocker}
				<b>Blocked by?</b>
				{#each rows as r (r.player.id)}
					<button onclick={() => block(r.player.id)}>{nameOf(r.player.id)}</button>
				{/each}
			{:else if followUp.kind === 'rebound'}
				<b>Rebound?</b>
				{#each rows as r (r.player.id)}
					<button onclick={() => rebound({ player: r.player.id })}>{nameOf(r.player.id)}</button>
				{/each}
				<button onclick={() => rebound('team')}>Team</button>
				<button onclick={() => rebound('them')}>Them</button>
				{#if blockable(followUp.play) && !followUp.blocked}
					{@const f = followUp}
					<button class="alt" onclick={() => (f.play.side === 'us' ? block() : (followUp = { ...f, askBlocker: true }))}>
						Blocked
					</button>
				{/if}
			{:else if followUp.kind === 'foul_type'}
				<b>Foul type?</b>
				{#each FOUL_TYPES.filter((t) => t !== 'personal') as t (t)}
					<button onclick={() => amend({ foul_type: t })}>{FOUL_TYPE_LABEL[t]}</button>
				{/each}
			{:else if followUp.kind === 'drawn'}
				<b>Fouled?</b>
				{#each rows as r (r.player.id)}
					<button onclick={() => amend({ drawn_by_player_id: r.player.id })}>{nameOf(r.player.id)}</button>
				{/each}
			{:else if followUp.kind === 'steal'}
				<b>Stolen?</b>
				<button onclick={() => pair()}>Steal by them</button>
			{:else if followUp.kind === 'turnover_by'}
				<b>Turnover by?</b>
				{#each rows as r (r.player.id)}
					<button onclick={() => pair(r.player.id)}>{nameOf(r.player.id)}</button>
				{/each}
				<button onclick={() => pair(null)}>Team</button>
			{:else if followUp.play.side === 'them' && followUp.shooter === undefined}
				{@const f = followUp}
				<b>Whose shot?</b>
				{#each rows as r (r.player.id)}
					<button onclick={() => (followUp = { ...f, shooter: r.player.id })}>{nameOf(r.player.id)}</button>
				{/each}
				<button onclick={() => (followUp = { ...f, shooter: null })}>Team</button>
			{:else}
				<b>
					{followUp.play.side === 'us'
						? 'Their shot?'
						: `${followUp.shooter ? nameOf(followUp.shooter) : 'Team'}'s shot?`}
				</b>
				<button onclick={() => blockedShot('fg2_missed')}>2 ✗</button>
				<button onclick={() => blockedShot('fg3_missed')}>3 ✗</button>
			{/if}
			<button class="skip" onclick={() => (followUp = null)}>Skip</button>
		</div>
	{/if}

	{#if recent.length}
		<ul class="recent" aria-label="Recent plays">
			{#each recent as p (p.id)}
				<li>
					<span class="per">{periodLabel(rules, p.period)}</span>
					<span>{describePlay(p, nameOf)}</span>
					<button class="del" aria-label="Delete play: {describePlay(p, nameOf)}" onclick={() => remove(p)}>✕</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#if sheet === 'player'}
	<Sheet onclose={() => (sheet = null)}>
		<h2>Another player</h2>
		<p class="hint">Players in the program who aren't on this team's roster.</p>
		<ul class="dlist">
			{#each others as p (p.id)}
				<li><button class="drow" onclick={() => pickOther(p)}><span>{p.name}</span></button></li>
			{/each}
		</ul>
	</Sheet>
{/if}

<style>
	.period {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.period b {
		font-family: var(--display);
		font-size: 22px;
		min-width: 92px;
		white-space: nowrap;
		text-align: center;
	}
	.period button {
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 8px;
		width: 40px;
		height: 36px;
		font-size: 20px;
		font-weight: 700;
	}
	.period button:disabled {
		opacity: 0.4;
	}
	.fouls {
		font-size: 14px;
		color: var(--muted);
		font-weight: 600;
		text-align: right;
	}
	.bonus {
		margin-left: 4px;
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		background: var(--warn-soft);
		color: var(--warn);
		border-radius: 4px;
		padding: 1px 5px;
	}
	main.live {
		gap: 10px;
		padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
	}
	main.live h3 {
		margin: 4px 0 0;
	}
	.players {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}
	.pl {
		position: relative;
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 0;
		min-height: 58px;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--surface);
		padding: 4px 2px;
		touch-action: manipulation;
	}
	.pl .jn {
		width: auto;
		height: auto;
		background: none;
		font-size: 22px;
		line-height: 1;
	}
	.pl .nm {
		font-size: 13px;
		font-weight: 600;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pl.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
		outline: 2px solid var(--accent);
	}
	.pl.team .nm,
	.pl.more .nm {
		font-size: 15px;
	}
	.pl.more {
		border-style: dashed;
		color: var(--muted);
	}
	.pf {
		position: absolute;
		top: 3px;
		right: 4px;
		font-size: 11px;
		font-weight: 700;
		color: var(--muted);
	}
	.pf.warn,
	.pf.out {
		color: var(--bad);
	}
	.pad {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 6px;
	}
	.st {
		height: 50px;
		font-size: 19px;
	}
	.st.make {
		background: var(--good-soft);
		color: var(--good);
	}
	.follow {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		background: var(--accent-soft);
		border: 1px solid var(--accent);
		border-radius: 10px;
		padding: 10px;
	}
	.follow b {
		width: 100%;
	}
	.follow button {
		border: 1px solid var(--line);
		background: var(--surface);
		border-radius: 999px;
		padding: 8px 12px;
		font-weight: 600;
	}
	.follow .alt {
		border-style: dashed;
	}
	.follow .skip {
		margin-left: auto;
		background: none;
		border: 0;
		color: var(--muted);
	}
	.recent {
		display: grid;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		overflow: hidden;
	}
	.recent li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 8px;
		padding: 6px 6px 6px 12px;
	}
	.recent li + li {
		border-top: 1px solid var(--line);
	}
	.per {
		color: var(--muted);
		font-weight: 600;
		font-size: 14px;
	}
	.del {
		border: 0;
		background: none;
		color: var(--muted);
		width: 40px;
		height: 36px;
		font-size: 16px;
	}
</style>
