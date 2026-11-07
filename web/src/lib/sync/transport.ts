// How the engine reaches the server: push/pull over HTTP, pokes over a
// Phoenix channel. Both are interfaces so tests can supply fakes.

import { Socket } from 'phoenix';
import type { PullResponse, PushRequest, PushResponse } from './types';

export interface Transport {
	push(request: PushRequest): Promise<PushResponse>;
	pull(clientId: string, cursor: number): Promise<PullResponse>;
}

/** Calls `onPoke` whenever the server says there's something new to pull. */
export interface PokeSource {
	subscribe(onPoke: () => void): () => void;
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export class HttpTransport implements Transport {
	constructor(
		private readonly baseUrl = '',
		/** Gym wifi tends to hang rather than fail; give up and retry instead. */
		private readonly timeoutMs = 10_000
	) {}

	push(request: PushRequest): Promise<PushResponse> {
		return this.request('/api/push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(request)
		});
	}

	pull(clientId: string, cursor: number): Promise<PullResponse> {
		const query = new URLSearchParams({ client_id: clientId, cursor: String(cursor) });
		return this.request(`/api/pull?${query}`, { method: 'GET' });
	}

	private async request<T>(path: string, init: RequestInit): Promise<T> {
		const response = await fetch(this.baseUrl + path, {
			...init,
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) throw new HttpError(response.status, body.error ?? `HTTP ${response.status}`);
		return body as T;
	}
}

export class PhoenixPokes implements PokeSource {
	constructor(private readonly url = '/socket') {}

	subscribe(onPoke: () => void): () => void {
		const socket = new Socket(this.url);
		socket.connect();
		const channel = socket.channel('sync');
		channel.on('poke', onPoke);
		// Pull on every (re)join too: pokes sent while disconnected are lost.
		channel.join().receive('ok', onPoke);
		return () => {
			channel.leave();
			socket.disconnect();
		};
	}
}
