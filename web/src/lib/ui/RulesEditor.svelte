<!-- Game rules: a preset, or custom values. The parent reads the draft with readRules. -->
<script lang="ts">
	import { PRESETS } from './basketball';
	import { choosePreset, readRules, rulesSummary, type RulesDraft } from './games';

	let { draft = $bindable() }: { draft: RulesDraft } = $props();

	const read = $derived(readRules(draft));
</script>

<div class="field">
	<label class="field">
		<span>Game rules</span>
		<select value={draft.preset} onchange={(e) => (draft = choosePreset(draft, e.currentTarget.value))}>
			{#each PRESETS as p (p.key)}<option value={p.key}>{p.name}</option>{/each}
			<option value="custom">Custom</option>
		</select>
	</label>
	{#if 'rules' in read}<p class="hint">{rulesSummary(read.rules)}</p>{/if}
</div>

{#if draft.preset === 'custom'}
	<div class="rules">
		<div class="field">
			<span>Periods</span>
			<div class="seg two">
				<button class:on={draft.periods === '4'} onclick={() => (draft.periods = '4')}>4 quarters</button>
				<button class:on={draft.periods === '2'} onclick={() => (draft.periods = '2')}>2 halves</button>
			</div>
		</div>
		<div class="pair">
			<label class="field"><span>Period (min)</span><input inputmode="decimal" bind:value={draft.period_minutes} /></label>
			<label class="field"><span>Overtime (min)</span><input inputmode="decimal" bind:value={draft.overtime_minutes} /></label>
		</div>
		{#if draft.periods === '4'}
			<div class="field">
				<span>Team fouls reset each</span>
				<div class="seg two">
					<button class:on={draft.team_fouls_reset === 'period'} onclick={() => (draft.team_fouls_reset = 'period')}>Quarter</button>
					<button class:on={draft.team_fouls_reset === 'half'} onclick={() => (draft.team_fouls_reset = 'half')}>Half</button>
				</div>
			</div>
		{/if}
		<div class="field">
			<span>Bonus</span>
			<div class="seg two">
				<button class:on={draft.bonus === 'two_shots'} onclick={() => (draft.bonus = 'two_shots')}>Two shots</button>
				<button class:on={draft.bonus === 'one_and_one'} onclick={() => (draft.bonus = 'one_and_one')}>One-and-one</button>
			</div>
		</div>
		<div class="pair">
			<label class="field"><span>Bonus from foul</span><input inputmode="numeric" bind:value={draft.bonus_at} /></label>
			{#if draft.bonus === 'one_and_one'}
				<label class="field">
					<span>Two shots from foul</span>
					<input inputmode="numeric" placeholder="None" bind:value={draft.double_bonus_at} />
				</label>
			{/if}
		</div>
		<div class="pair">
			<label class="field"><span>Foul out on</span><input inputmode="numeric" bind:value={draft.foul_out_at} /></label>
			<label class="field"><span>Technicals to eject</span><input inputmode="numeric" bind:value={draft.technicals_to_eject} /></label>
		</div>
		{#if 'err' in read}<p class="err" role="alert">{read.err}</p>{/if}
	</div>
{/if}

<style>
	.rules {
		display: grid;
		gap: 12px;
		border-left: 3px solid var(--line);
		padding-left: 12px;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.seg.two {
		grid-template-columns: 1fr 1fr;
	}
</style>
