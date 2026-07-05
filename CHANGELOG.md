# Changelog

Fork-specific changes since diverging from [hrrrsn/mcp-vnc](https://github.com/hrrrsn/mcp-vnc).

All fixes below were found and confirmed against **TigerVNC** (`tigervncserver`/`Xtigervnc` on Debian) — the only server this fork has actually been run against. If you hit different behavior on another server implementation, it's worth checking whether these fixes still apply there before assuming something else is wrong.

## Unreleased

### Fixed

- **`vnc_type_text` dropping shift-modified symbols** (`&`→`7`, `~`→`` ` ``, `"`→`'`, etc). `typeCharacter()` was manually faking a Shift keydown and then sending the *unshifted* keysym, instead of sending the real target keysym directly — the server resolves keysym→keycode+modifier itself (`vnc_key_press` already did this correctly, same as real clients like Remmina rely on). The original code had no comment explaining the fake-Shift approach and its only git history is the initial commit, so it's unclear whether it was a deliberate compatibility shim for some other server or just modeled on physical keyboard behavior without accounting for how RFB keysyms already resolve on the server side. Added `VNC_LEGACY_SHIFT_BEHAVIOR=true` as an escape hatch back to the old behavior in case a server genuinely needs it — unset by default. `src/tools/input.ts`
- **Orphaned VNC connections leaking on timeout/error.** `createConnection()`'s timeout and error paths only rejected the connection promise, never calling `.disconnect()` on the `VncClient` — the TCP socket stayed open on the server, and enough of these piling up made every subsequent connection start timing out too. `src/vnc/client.ts`
- **Full-screen requests timing out under video/motion-heavy content.** The server picks whichever offered encoding it estimates is best per rectangle, regardless of client preference order — for photographic/video content it kept choosing Hextile's CPU-heavy per-rectangle analysis over cheap Raw, and that server-side encode cost (not network transfer) was pushing full-frame requests past the connection timeout. Dropped `hextile` from the offered encodings, forced Raw. `src/vnc/client.ts`
- **Screenshot JPEG compression washing out color on thin, high-contrast regions** (e.g. a window titlebar between very different background colors) — a lossy-encoding artifact that could look like a real rendering bug. Switched output to PNG (lossless); screen content compresses well with it anyway since it's mostly flat color, not photographic noise. `src/tools/screenshot.ts`

### Added

- Every screenshot now also writes its exact final PNG bytes to `/tmp/vnc-satellite-last-screenshot.png` as a local debug aid. `src/tools/screenshot.ts`
