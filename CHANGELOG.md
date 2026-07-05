# Changelog

Fork-specific changes since diverging from [hrrrsn/mcp-vnc](https://github.com/hrrrsn/mcp-vnc).

## Unreleased

### Fixed

- **`vnc_type_text` dropping shift-modified symbols** (`&`→`7`, `~`→`` ` ``, `"`→`'`, etc). `typeCharacter()` was manually faking a Shift keydown and then sending the *unshifted* keysym, instead of sending the real target keysym directly — the server resolves keysym→keycode+modifier itself (`vnc_key_press` already did this correctly). `src/tools/input.ts`
- **Orphaned VNC connections leaking on timeout/error.** `createConnection()`'s timeout and error paths only rejected the connection promise, never calling `.disconnect()` on the `VncClient` — the TCP socket stayed open on the server, and enough of these piling up made every subsequent connection start timing out too. `src/vnc/client.ts`
- **Full-screen requests timing out under video/motion-heavy content.** The server picks whichever offered encoding it estimates is best per rectangle, regardless of client preference order — for photographic/video content it kept choosing Hextile's CPU-heavy per-rectangle analysis over cheap Raw, and that server-side encode cost (not network transfer) was pushing full-frame requests past the connection timeout. Dropped `hextile` from the offered encodings, forced Raw. `src/vnc/client.ts`
- **Screenshot JPEG compression washing out color on thin, high-contrast regions** (e.g. a window titlebar between very different background colors) — a lossy-encoding artifact that could look like a real rendering bug. Switched output to PNG (lossless); screen content compresses well with it anyway since it's mostly flat color, not photographic noise. `src/tools/screenshot.ts`

### Added

- Every screenshot now also writes its exact final PNG bytes to `/tmp/vnc-satellite-last-screenshot.png` as a local debug aid. `src/tools/screenshot.ts`
