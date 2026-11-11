// How the engine reaches the server: push/pull over HTTP, pokes over a
// Phoenix channel. Both are interfaces so tests can supply fakes.
//
// A transport is bound to one organization and adds its id to every request.
// Until sign-in exists the organization comes from configuration; after, from
// the session.

import { Socket } from 'phoenix';
import type { HistoryEntry, PullResponse, PushRequest, PushResponse } from './types';

export interface Transport {
	push(request: PushRequest): Promise<PushResponse>;
	pull(clientId: string, cursor: number): Promise<PullResponse>;
}

/** Calls `onPoke` whenever the server says there's something new to pull. */
export interface PokeSource {
	subscribe(onPoke: () => void): () => void;
}

/**
 * Any non-2xx response, including 401 and 403. These are never rejections:
 * the engine keeps every pending change queued and retries.
 */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export interface ServerConfig {
	/** The API's origin, such as https://courtside.example. Empty means this page's origin. */
	baseUrl: string;
	organizationId: string;
}

export class HttpTransport implements Transport {
	constructor(
		private readonly server: ServerConfig,
		/** Gym wifi tends to hang rather than fail; give up and retry instead. */
		private readonly timeoutMs = 10_000
	) {}

	push(request: PushRequest): Promise<PushResponse> {
		return this.request('/api/push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ organization_id: this.server.organizationId, ...request })
		});
	}

	pull(clientId: string, cursor: number): Promise<PullResponse> {
		const query = new URLSearchParams({
			organization_id: this.server.organizationId,
			client_id: clientId,
			cursor: String(cursor)
		});
		return this.request(`/api/pull?${query}`, { method: 'GET' });
	}

	/** A row's change log, newest first (GET /api/history). Needs a connection. */
	history(table: string, key: string): Promise<{ entries: HistoryEntry[] }> {
		const query = new URLSearchParams({ organization_id: this.server.organizationId, table, key });
		return this.request(`/api/history?${query}`, { method: 'GET' });
	}

	private async request<T>(path: string, init: RequestInit): Promise<T> {
		const response = await fetch(this.server.baseUrl + path, {
			...init,
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) throw new HttpError(response.status, body.error ?? `HTTP ${response.status}`);
		return body as T;
	}
}

export class PhoenixPokes implements PokeSource {
	constructor(private readonly server: ServerConfig) {}

	subscribe(onPoke: () => void): () => void {
		// https://host -> wss://host/socket; empty -> /socket on this page's origin.
		const socket = new Socket(this.server.baseUrl.replace(/^http/, 'ws') + '/socket');
		socket.connect();
		const channel = socket.channel(`sync:${this.server.organizationId}`);
		channel.on('poke', onPoke);
		// Pull on every (re)join too: pokes sent while disconnected are lost.
		channel.join().receive('ok', onPoke);
		return () => {
			channel.leave();
			socket.disconnect();
		};
	}
}
