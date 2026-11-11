# Spike: Courtside on iOS with Tauri

Can today's Courtside web app run as a Tauri 2 app on iOS, with its offline storage,
sync and pokes working? Questions from [`docs/games-plan.md`](../games-plan.md),
"Spikes, between phases 1 and 2".

Spiked 2026-11-09 on branch `spike/tauri` (code in `web/src-tauri/`), in the iOS 18.4
simulator (iPhone 15) on Xcode 26.2, Tauri CLI 2.12.4, Rust 1.94, against the Phoenix
dev server. Not tried on a real phone: that needs signing (see below).

## Summary

- **It works with no app code changes.** The static SvelteKit build runs inside Tauri's
  web view, syncs with Phoenix and receives pokes.
- **Storage is tied to a fixed address, `tauri://localhost`,** a secure context, so
  `crypto.randomUUID` exists and IndexedDB is there. The client id and data survived
  restarts, an app update and launching with the server down.
- **CORS and the socket work** from `tauri://localhost` to `http://localhost:4000`,
  using the origins already allowed in `config.exs`.
- **No service worker, and none needed:** the files are bundled.
- **Three things to fix in phase 3:** safe-area padding (the header sits under the
  status bar), keeping the screen awake (the web Wake Lock API was refused), and the
  storage message (it tells the user to add the app to the home screen).
- **Setup snag:** `tauri ios init` insists on CocoaPods, which this sandbox can't
  install, but the generated Podfile lists no pods; a stand-in `pod` command was enough.

## Answers

| Question | Result | How we know |
|---|---|---|
| Runs in the simulator | Yes. Debug build for `aarch64-sim`, signed locally, no developer team needed | `tauri ios build --debug --target aarch64-sim`, installed with `simctl` |
| The page's address | `tauri://localhost`, `isSecureContext` true | diagnostics panel |
| `crypto.randomUUID` | Available | diagnostics; the client id was generated |
| IndexedDB survives restarts | Yes: the same client id after relaunching, after reinstalling a new build over the old one, and after launching with Phoenix stopped (cursor 13 restored, state "retrying") | screenshots |
| Push and pull to Phoenix (CORS) | Yes: the first launch pulled every table; cursor and data id shown | Sync tab |
| Pokes over the WebSocket | Yes: a push from `curl` moved the app's cursor from 12 to 13 within about a second, well before the 30-second poll | Sync tab, "Last synced" |
| Service worker | Not available in the web view (`'serviceWorker' in navigator` is false); not needed | diagnostics |
| Keeping the screen awake | `navigator.wakeLock.request('screen')` at launch: "NotAllowedError: Permission was denied" | diagnostics |
| Persistent storage | `navigator.storage.persist()` reports no | Sync tab |

## What phase 3 needs

- **Safe areas.** Tauri's web view fills the screen, so the header draws under the
  status bar and notch, and the tab bar leaves a strip above the home indicator. Add
  `viewport-fit=cover` and pad with `env(safe-area-inset-*)`.
- **Keep the screen awake natively.** The web request was refused. It ran at launch
  without a tap, and WebKit may require one; the entry screen's own request (after a
  tap) wasn't tested, because the simulator can't be tapped from scripts. The reliable
  route is native: a small Tauri plugin setting `UIApplication.isIdleTimerDisabled`
  while the entry or live screen is open.
- **Storage wording.** In the app, "Add Courtside to the home screen" is wrong. The
  data lives in the app's own container, which iOS doesn't clear the way Safari clears
  site data; whether WebKit can still evict it under storage pressure isn't
  documented. Show the web advice only in the browser. The optional SQLite store from
  the plan would remove the question.
- **The server address over a real network.** `http://localhost` works because the
  simulator shares the Mac's network. A phone reaches the server through the tailnet,
  which should be HTTPS anyway; iOS App Transport Security blocks plain HTTP to other
  hosts unless exempted (not tested).
- **The socket's origin check** in production: Phoenix's `check_origin` must allow
  `tauri://localhost` (dev doesn't check).
- **Signing and a real phone** are on Eric's side: a development team in
  `bundle > iOS > developmentTeam`, then `tauri ios build` for the device, or Xcode.
- **CocoaPods:** install it on the build Mac, or keep the empty-Podfile workaround.

## Not verified

A real phone; wake lock after a user tap; Android; App Store review; the dev-server
mode (`tauri ios dev`) with live reload. The spike used the bundled build only.

## Setup notes

- `npm i -D @tauri-apps/cli@^2`, then `tauri init`, then `tauri ios init`; `web/package.json`
  needs a `tauri` script, which Xcode's "Build Rust Code" step calls.
- `beforeBuildCommand` builds the web app with `VITE_COURTSIDE_API=http://localhost:4000`.
- `web/src-tauri/gen/apple/.gitignore` doesn't ignore `.DerivedData/` (about 430 MB);
  add it.
- The spike's diagnostics are behind `VITE_SPIKE_DIAG`, and the starting tab behind
  `VITE_START_TAB`; neither belongs in the app.
