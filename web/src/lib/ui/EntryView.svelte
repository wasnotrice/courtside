<script lang="ts">
	import { onMount } from 'svelte';
	import { getApp } from './context.svelte';
	import {
		beats,
		bestFor,
		effSetup,
		entry,
		fmtDate,
		fmtScore,
		fmtValue,
		KINDS,
		pct,
		readSetup,
		playersForRun,
		results,
		score,
		setupText,
		summary,
		teamsOf
	} from './domain';
	import RejectionNote from './RejectionNote.svelte';
	import Sheet from './Sheet.svelte';
	import SetupField from './SetupField.svelte';
	import StatusPill from './StatusPill.svelte';
	import type { Rejection } from '$lib/sync/types';

	let { runId }: { runId: string } = $props();

	const app = getApp();
	const view = $derived(app.view);
	const snap = $derived(app.sync.snapshot);
	// App closes this screen when the run disappears, so these are always set while mounted.
	const run = $derived(view.runs.get(runId)!);
	const drill = $derived(view.drills.get(run.drill_id)!);
	const K = $derived(KINDS[drill.kind]);
	const rs = $derived(results(view, runId));
	// Everyone on the program's rosters this season, or one team's, plus anyone with a result.
	const teams = $derived(teamsOf(view, run.program_id));
	let team = $state<string | null>(null);
	const rows = $derived(playersForRun(view, run, team));
	const list = $derived(rows.map((r) => r.player));
	const jerseyOf = $derived(new Map(rows.map((r) => [r.player.id, r.jersey])));

	// Rejections and locally-skipped mutations, matched to the row they affect.
	const argsOf = (a: unknown) => a as Record<string, unknown>;
	const playerRejections = $derived.by(() => {
		const out = new Map<string, Rejection[]>();
		for (const r of snap.rejections) {
			const args = argsOf(r.args);
			if (args.drill_run_id === runId && typeof args.player_id === 'string') {
				out.set(args.player_id, [...(out.get(args.player_id) ?? []), r]);
			}
		}
		return out;
	});
	const runRejections = $derived(snap.rejections.filter((r) => argsOf(r.args).id === runId));
	const skipped = $derived.by(() => {
		const out = new Map<string, string>();
		for (const m of snap.pending) {
			const reason = snap.skipped.get(m.id);
			const args = argsOf(m.args);
			if (reason && args.drill_run_id === runId) out.set(args.player_id as string, reason);
		}
		return out;
	});

	// Number pad state.
	let sel = $state<string | null>(null);
	let buf = $state('');
	let target = $state<'value' | 'setup'>('value');
	const selected = $derived(sel ? view.players.get(sel) : undefined);

	onMount(() => {
		sel = list.find((p) => !rs.has(p.id))?.id ?? null;
		keepAwake();
	});

	/** Saves what's typed for the selected player. False if it was refused. */
	async function commit(): Promise<boolean> {
		if (!sel || buf === '') return true;
		const key = { drill_run_id: runId, player_id: sel };

		if (target === 'setup') {
			const res = readSetup(drill.kind, buf);
			if ('err' in res || res.v === null) {
				app.showToast('err' in res ? res.err : 'Enter a number above zero.');
				return false;
			}
			const ok = await app.mutateUndoable(scope, `${nameOf(sel)}'s ${K.setupWord}`, {
				name: 'result.set_setup',
				args: { ...key, setup: res.v === run.setup ? null : res.v }
			});
			if (ok) buf = '';
			return ok;
		}

		const v = Number(buf);
		if (!Number.isFinite(v)) {
			app.showToast('That number is not valid.');
			return false;
		}
		const ok = await app.mutateUndoable(scope, `${nameOf(sel)} ${fmtValue(drill.kind, v)}`, {
			name: 'result.set_value',
			args: { ...key, value: v }
		});
		if (ok) buf = '';
		return ok;
	}

	// Undo for this run's results, newest first.
	const scope = $derived(`run:${runId}`);
	const lastUndo = $derived(app.lastUndo(scope));
	const nameOf = (id: string) => view.players.get(id)?.name ?? 'Player';

	async function clear() {
		if (!sel) return;
		const raw = entry(view, runId, sel);
		const key = { drill_run_id: runId, player_id: sel };
		buf = '';
		if (!raw) return;
		if (target === 'setup') {
			if (raw.setup !== null) {
				await app.mutateUndoable(scope, `${nameOf(sel)}'s ${K.setupWord}`, { name: 'result.set_setup', args: { ...key, setup: null } });
			}
		} else if (raw.value !== null) {
			// result.clear drops the whole row, so put back a per-player setup if there was one.
			await app.mutateUndoable(
				scope,
				`clear ${nameOf(sel)}`,
				{ name: 'result.clear', args: key },
				...(raw.setup !== null ? [{ name: 'result.set_setup' as const, args: { ...key, setup: raw.setup } }] : [])
			);
		}
	}

	function moveNext() {
		const i = list.findIndex((p) => p.id === sel);
		sel = list[i + 1]?.id ?? null;
		buf = '';
		target = 'value';
		scrollToSel();
	}

	async function press(k: string) {
		if (!sel) return;
		if (k === 'bs') buf = buf.slice(0, -1);
		else if (k === 'clear') await clear();
		else if (k === 'setup') {
			if (!(await commit())) return;
			target = target === 'setup' ? 'value' : 'setup';
			buf = '';
		} else if (k === 'next') {
			if (await commit()) moveNext();
		} else if (k === '.') {
			if (!buf.includes('.') && buf.length < 6) buf = (buf || '0') + '.';
		} else if (buf.length < 6) buf = (buf === '0' ? '' : buf) + k;
	}

	async function select(id: string) {
		if (sel && sel !== id && !(await commit())) return;
		if (sel !== id) {
			sel = id;
			buf = '';
			target = 'value';
		}
	}

	async function back() {
		if (await commit()) app.runId = null;
	}

	function scrollToSel() {
		requestAnimationFrame(() => {
			const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
			document.querySelector('.prow.sel')?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
		});
	}

	function onkeydown(e: KeyboardEvent) {
		if (sheet) return;
		if (/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement as HTMLElement | null)?.tagName ?? '')) return;
		if (/^[0-9.]$/.test(e.key)) {
			e.preventDefault();
			void press(e.key);
		} else if (e.key === 'Backspace') {
			e.preventDefault();
			void press('bs');
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			void press('next');
		}
	}

	// Screen wake lock, so the phone doesn't sleep between players.
	let wakeLock: WakeLockSentinel | null = null;
	async function keepAwake() {
		try {
			if (navigator.wakeLock && !wakeLock) {
				wakeLock = await navigator.wakeLock.request('screen');
				wakeLock.addEventListener('release', () => (wakeLock = null));
			}
		} catch {
			// Not supported or not allowed; the app works without it.
		}
	}
	$effect(() => () => void wakeLock?.release());

	// Sheets: change everyone's setup, or remove the run.
	let sheet = $state<'setup' | 'delete' | null>(null);
	let setupDraft = $state('');
	let err = $state('');

	async function openSetup() {
		if (!(await commit())) return;
		setupDraft = String(run.setup ?? '');
		err = '';
		sheet = 'setup';
	}

	async function saveSetup() {
		const res = readSetup(drill.kind, setupDraft);
		if ('err' in res) return (err = res.err);
		const outcome = await app.sync.engine.mutate({ name: 'run.set_setup', args: { id: runId, setup: res.v } });
		if (!outcome.ok) return (err = outcome.reason);
		sheet = null;
	}

	async function removeRun() {
		sheet = null;
		if (await app.mutate({ name: 'run.delete', args: { id: runId } })) {
			app.runId = null;
			app.showToast('Drill removed from this practice.');
		}
	}

	const dotOK = $derived(!!selected && drill.kind !== 'makes');
</script>

<svelte:window {onkeydown} onvisibilitychange={() => document.visibilityState === 'visible' && keepAwake()} />

<header class="top">
	<div class="row"><button class="back" onclick={back}>‹ Practice</button><StatusPill /></div>
	<h1>{drill.name}</h1>
	<div class="row wrap">
		<button class="chip" onclick={openSetup}>{setupText(drill.kind, run.setup)} · Change</button>
		<span class="muted">{fmtDate(run.date)}</span>
	</div>
	{#if teams.length > 1}
		<div class="chips" role="tablist" aria-label="Team">
			<button class:on={team === null} onclick={() => (team = null)}>Everyone</button>
			{#each teams as t (t.id)}
				<button class:on={team === t.id} onclick={() => (team = t.id)}>{t.name}</button>
			{/each}
		</div>
	{/if}
	<p class="sum"><b>{list.filter((p) => rs.has(p.id)).length}</b> of {list.length} entered · {summary(view, drill, run)}</p>
	{#each runRejections as r (r.mutation_id)}
		<RejectionNote rejection={r} standalone />
	{/each}
</header>

<main class="entrylist">
	{#if list.length}
		<ul class="plist">
			{#each list as p (p.id)}
				{@const raw = entry(view, runId, p.id)}
				{@const r = rs.get(p.id)}
				{@const isSel = sel === p.id}
				{@const setup = effSetup(run, raw)}
				{@const editV = isSel && target === 'value'}
				{@const editS = isSel && target === 'setup'}
				{@const vText = editV && buf !== '' ? buf : r ? fmtValue(drill.kind, r.value) : editV ? '' : '–'}
				{@const sText = editS ? buf || ' ' : (setup ?? '')}
				{@const prior = bestFor(view, drill, p.id, { excludeRun: runId, setup })}
				{@const sc = r ? score(drill, run, r) : null}
				{@const isPB = sc !== null && prior !== null && beats(drill, sc, prior)}
				<li>
					<button class="prow" class:sel={isSel} class:missing={!r} aria-pressed={isSel} onclick={() => select(p.id)}>
						<span class="jn">{jerseyOf.get(p.id) || '–'}</span>
						<span class="pname">
							<b>{p.name}</b>
							<small>{prior !== null ? `Best ${fmtScore(drill, prior)}` : r ? 'First result' : ''}</small>
						</span>
						<span class="res">
							<span class="v" class:cursor={editV} class:ghost-v={!r && !(editV && buf)}>{vText}</span>
							{#if drill.kind === 'makes'}
								<span class="of" class:cursor={editS}>/{sText}</span>
								{#if r && !isSel && setup}<span class="pct">{pct(r.value / setup)}</span>{/if}
							{:else}
								<span class="unit">{drill.kind === 'time' ? 's' : ''}</span>
								{#if raw?.setup != null || editS}<span class="of" class:cursor={editS}>@{sText}</span>{/if}
							{/if}
							{#if isPB}<span class="pb">PB</span>{/if}
						</span>
					</button>
					{#each playerRejections.get(p.id) ?? [] as rej (rej.mutation_id)}
						<RejectionNote rejection={rej} />
					{/each}
					{#if skipped.get(p.id)}
						<div class="reject skipped">Won't sync: {skipped.get(p.id)}</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<div class="note">No players yet. <button class="link" onclick={() => app.go('roster')}>Add your roster</button></div>
	{/if}
	<button class="danger-link" onclick={() => (sheet = 'delete')}>Remove this drill from the practice</button>
</main>

<div class="keypad" role="group" aria-label="Number pad">
	<div class="kphead">
		{#if selected}
			<span>{jerseyOf.get(selected.id) ? `#${jerseyOf.get(selected.id)} ` : ''}{selected.name}</span>
			<span class="muted">{target === 'setup' ? `Enter ${K.setupWord} for this player only` : `Enter ${K.valueWord}`}</span>
		{:else}
			<span class="muted">Tap a player to enter a result</span>
		{/if}
		{#if lastUndo}
			<button class="undo" aria-label="Undo {lastUndo.label}" onclick={() => app.undo(scope)}>↶ Undo</button>
		{/if}
	</div>
	<div class="keys">
		{#each ['1', '2', '3'] as k (k)}<button class="k" disabled={!selected} onclick={() => press(k)}>{k}</button>{/each}
		<button class="k fn" disabled={!selected} aria-label="Delete last digit" onclick={() => press('bs')}>⌫</button>
		{#each ['4', '5', '6'] as k (k)}<button class="k" disabled={!selected} onclick={() => press(k)}>{k}</button>{/each}
		<button class="k fn" disabled={!selected} onclick={() => press('clear')}>Clear</button>
		{#each ['7', '8', '9'] as k (k)}<button class="k" disabled={!selected} onclick={() => press(k)}>{k}</button>{/each}
		<button
			class="k fn"
			class:on={target === 'setup'}
			disabled={!selected}
			aria-pressed={target === 'setup'}
			onclick={() => press('setup')}>{K.setupKey}</button
		>
		<button class="k" disabled={!dotOK} aria-label="Decimal point" onclick={() => press('.')}>.</button>
		<button class="k" disabled={!selected} onclick={() => press('0')}>0</button>
		<button class="k next" disabled={!selected} onclick={() => press('next')}>Next ›</button>
	</div>
</div>

{#if sheet === 'setup'}
	<Sheet onclose={() => (sheet = null)}>
		<h2>{drill.name}</h2>
		<SetupField kind={drill.kind} label={'For everyone today: ' + K.setupField.toLowerCase()} bind:value={setupDraft} />
		<p class="hint">Players with their own {K.setupWord} keep them. Use the {K.setupKey} key on the pad to set one player.</p>
		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button class="primary wide" onclick={saveSetup}>Save</button>
	</Sheet>
{:else if sheet === 'delete'}
	<Sheet onclose={() => (sheet = null)}>
		<h2>Remove {drill.name}?</h2>
		<p>
			This deletes it from {fmtDate(run.date)}{rs.size ? `, along with ${rs.size} result${rs.size === 1 ? '' : 's'}` : ''}.
			The drill stays in your list.
		</p>
		<button class="danger wide" onclick={removeRun}>Remove</button>
	</Sheet>
{/if}

<style>
	.kphead .undo {
		flex: none;
		background: none;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 4px 10px;
		font-weight: 600;
	}
</style>
