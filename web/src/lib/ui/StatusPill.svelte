<script lang="ts">
	import { getApp } from './context.svelte';

	const app = getApp();

	const status = $derived.by(() => {
		const s = app.sync.snapshot;
		const n = s.pending.length;
		if (s.offline) return { cls: 'warn', text: n ? `Offline (simulated) · ${n} waiting` : 'Offline (simulated)' };
		if (s.phase === 'retrying') return { cls: 'warn', text: n ? `Offline · ${n} waiting to sync` : 'Offline' };
		if (n) return { cls: 'busy', text: `Syncing ${n}…` };
		if (!s.lastSyncedAt) return { cls: 'busy', text: 'Connecting…' };
		return { cls: '', text: 'All saved' };
	});
</script>

<button class="pill {status.cls}" style="border:0" onclick={() => app.go('sync')} title="Open the sync inspector">
	<i aria-hidden="true"></i>{status.text}
</button>
