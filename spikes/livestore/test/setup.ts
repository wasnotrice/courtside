// LiveStore 0.5.0 checks a "materializer hash" in dev mode (NODE_ENV !== 'production'),
// and that check misfires for materializers that read state when several events arrive
// in one pull batch (livestore issue #503). See smoke.test.ts. Everything else runs as
// production does.
process.env.NODE_ENV = process.env.SPIKE_ENV ?? 'production'
