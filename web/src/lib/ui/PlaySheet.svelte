<!-- Edit a play, or add one: after a given play, or at the end of the game. Every field a
play has, with the stat pad laid out as on the live screen. -->
<script lang="ts">
	import { FOUL_TYPES, MADE_FIELD_GOALS, type FoulType, type Stat } from '$lib/sync/basketball';
	import type { Game, Play } from '$lib/sync/types';
	import { periodLabel, positionAtEnd, positionBetween } from './basketball';
	import { getApp } from './context.svelte';
	import { changedFields, type RosterRow } from './domain';
	import { STAT_LABEL, STAT_PAD } from './live';
	import { fmtClock, parseTime } from './review';
	import HistoryPanel from './HistoryPanel.svelte';
	import Sheet from './Sheet.svelte';

	let {
		game,
		plays,
		rows,
		play = null,
		after = null,
		preset = {},
		onclose,
		onaddafter
	}: {
		game: Game;
		/** The game's plays in order, to place a new one. */
		plays: readonly Play[];
		rows: readonly RosterRow[];
		/** The play to edit, or null to add one. */
		play?: Play | null;
		/** Add the new play just after this one; otherwise at the end. */
		after?: Play | null;
		/** Starting values for a new play. */
		preset?: Partial<Play>;
		onclose: () => void;
		onaddafter?: (play: Play) => void;
	} = $props();

	const app = getApp();
	// svelte-ignore state_referenced_locally
	const start: Partial<Play> = play ?? { period: after?.period ?? plays.at(-1)?.period ?? 1, ...preset };

	let draft = $state({
		side: start.side ?? 'us',
		player: start.player_id ?? '',
		stat: start.stat ?? ('fg2_made' as Stat),
		foul_type: (start.foul_type ?? 'personal') as FoulType,
		assist: start.assist_player_id ?? '',
		drawn: start.drawn_by_player_id ?? '',
		period: start.period ?? 1,
		clock: start.clock != null ? fmtClock(start.clock) : '',
		film: start.video_at != null ? fmtClock(start.video_at) : ''
	});
	let err = $state('');
	let confirmDelete = $state(false);
	let showHistory = $state(false);

	const isMake = $derived(MADE_FIELD_GOALS.includes(draft.stat));
	// Periods to offer: regulation, any overtime already played, and one more.
	const periods = $derived.by(() => {
		const last = Math.max(game.rules.periods, draft.period, ...plays.map((p) => p.period));
		return Array.from({ length: last + 1 }, (_, i) => i + 1);
	});
	const FOUL_TYPE_LABEL: Record<FoulType, string> = {
		personal: 'Personal',
		offensive: 'Offensive',
		technical: 'Technical',
		flagrant: 'Flagrant'
	};

	async function save() {
		const clock = parseTime(draft.clock);
		const film = parseTime(draft.film);
		if (Number.isNaN(clock)) return (err = 'Clock should look like 5:07.');
		if (Number.isNaN(film)) return (err = 'Film time should look like 12:34 or 1:02:03.');

		const us = draft.side === 'us';
		// Fields that don't apply to the play as it now stands are cleared.
		const fields = {
			side: draft.side,
			player_id: us ? draft.player || null : null,
			stat: draft.stat,
			foul_type: draft.stat === 'foul' ? draft.foul_type : null,
			assist_player_id: us && isMake ? draft.assist || null : null,
			drawn_by_player_id: !us && draft.stat === 'foul' ? draft.drawn || null : null,
			period: draft.period,
			clock,
			video_at: film
		};

		let args;
		if (play) {
			args = changedFields(play, { ...play, ...fields });
			if (!args) return onclose();
		} else {
			const now = Date.now();
			const i = after ? plays.findIndex((p) => p.id === after.id) : -1;
			const position = i >= 0 ? positionBetween(after!.position, plays[i + 1]?.position ?? null) : positionAtEnd(plays, now);
			args = { id: crypto.randomUUID(), game_id: game.id, ...fields, position, recorded_at: now };
		}
		const outcome = await app.sync.engine.mutate({ name: 'play.put', args });
		if (!outcome.ok) return (err = outcome.reason);
		onclose();
	}

	async function remove() {
		if (play && (await app.mutate({ name: 'play.delete', args: { id: play.id } }))) onclose();
	}
</script>

<Sheet {onclose}>
	{#if showHistory && play}
		<HistoryPanel table="plays" key={play.id} row={app.view.plays.get(play.id) ?? play} rules={game.rules} onback={() => (showHistory = false)} />
	{:else}
	<h2>{play ? 'Edit play' : 'Add a play'}</h2>
	<div class="seg two">
		<button class:on={draft.side === 'us'} onclick={() => (draft.side = 'us')}>Us</button>
		<button class:on={draft.side === 'them'} onclick={() => (draft.side = 'them')}>Them</button>
	</div>
	{#if draft.side === 'us'}
		<label class="field">
			<span>Player</span>
			<select bind:value={draft.player}>
				<option value="">Team (no player)</option>
				{#each rows as r (r.player.id)}<option value={r.player.id}>{r.jersey ? `${r.jersey} ` : ''}{r.player.name}</option>{/each}
			</select>
		</label>
	{/if}
	<div class="field">
		<span>Stat</span>
		<div class="pad">
			{#each STAT_PAD as stat (stat)}
				<button class:on={draft.stat === stat} onclick={() => (draft.stat = stat)}>{STAT_LABEL[stat]}</button>
			{/each}
		</div>
	</div>
	{#if draft.stat === 'foul'}
		<div class="field">
			<span>Foul type</span>
			<div class="seg four">
				{#each FOUL_TYPES as t (t)}
					<button class:on={draft.foul_type === t} onclick={() => (draft.foul_type = t)}>{FOUL_TYPE_LABEL[t]}</button>
				{/each}
			</div>
		</div>
	{/if}
	{#if draft.side === 'us' && isMake}
		<label class="field">
			<span>Assist</span>
			<select bind:value={draft.assist}>
				<option value="">None</option>
				{#each rows.filter((r) => r.player.id !== draft.player) as r (r.player.id)}
					<option value={r.player.id}>{r.player.name}</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if draft.side === 'them' && draft.stat === 'foul'}
		<label class="field">
			<span>Fouled</span>
			<select bind:value={draft.drawn}>
				<option value="">Not recorded</option>
				{#each rows as r (r.player.id)}<option value={r.player.id}>{r.player.name}</option>{/each}
			</select>
		</label>
	{/if}
	<div class="three">
		<label class="field">
			<span>Period</span>
			<select bind:value={draft.period}>
				{#each periods as n (n)}<option value={n}>{periodLabel(game.rules, n)}</option>{/each}
			</select>
		</label>
		<label class="field"><span>Clock</span><input inputmode="numeric" placeholder="5:07" bind:value={draft.clock} /></label>
		<label class="field"><span>Film time</span><input inputmode="numeric" placeholder="12:34" bind:value={draft.film} /></label>
	</div>
	{#if err}<p class="err" role="alert">{err}</p>{/if}
	<button class="primary wide" onclick={save}>{play ? 'Save' : 'Add play'}</button>
	{#if play}
		{#if onaddafter}
			<button class="secondary wide" onclick={() => onaddafter(play)}>Add a play after this one</button>
		{/if}
		{#if confirmDelete}
			<button class="danger wide" onclick={remove}>Delete this play</button>
		{:else}
			<button class="danger-link" onclick={() => (confirmDelete = true)}>Delete play</button>
		{/if}
		<button class="link" onclick={() => (showHistory = true)}>History</button>
	{/if}
	{/if}
</Sheet>

<style>
	.seg.two {
		grid-template-columns: 1fr 1fr;
	}
	.seg.four {
		grid-template-columns: repeat(4, 1fr);
	}
	.pad {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 6px;
	}
	.pad button {
		border: 1px solid var(--line);
		background: var(--bg);
		border-radius: 8px;
		padding: 10px 0;
		font-family: var(--display);
		font-weight: 600;
		font-size: 17px;
	}
	.pad button.on {
		border-color: var(--accent);
		background: var(--accent-soft);
		color: var(--accent);
	}
	.three {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
	}
</style>
