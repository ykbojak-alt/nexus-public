# NEXUS app

The NEXUS 2 desktop app (`nx-app`): a native GPUI client of
[nx](https://github.com/herdrdev/herdr-core). Can (`ogulcancelik`)
maintains it.

If AGENTS.local.md exists, read it too: the maintainer's local rules.

## Compatibility

Preserve compatibility with released versions and installed user data.
Discuss breaking changes and removal of compatibility code with the maintainer
before changing documented behavior.

## Before you grow the app's core: ask Can

The app's core (the model, machine layout documents, commands, and shared mod APIs)
stays small; everything else is mods. Before adding anything to it, answer
these three, then discuss with Can and wait for his go:

1. Does the app itself act on it (it changes what the app does, not only
   how something looks)?
2. Can only the app see it (e.g. a change that happens while no mod is
   watching)?
3. Can mods not do it correctly, even with care?

If all three are no, it belongs in mods (their shared storage, their own
code), even at the price of some repetition. Same for nx: what the
app asks of it goes through Can too.

`nx-app --skill` prints the window manual in `src/SKILL.md`.
Keep it current when changing agent-facing behavior.

## The guide users' agents read

`defaults/AGENTS.md` is written into every user's `~/.config/nx` on
every start: it's how their agents learn what the app can do. A change to
what users or agents can do (a command, a setting, a layout or mod
feature, a file) updates it in the same commit. `cargo test` checks that it
names every command and settings.json key; the rest is on you. Keep it a
map with rules and short examples: the `.d.ts` files are generated and are
the full API.

## What ships in the box

`defaults/` is built into the app: mods, `layouts/*.json`, `keys.json`
(Linux, Windows) and `keys.macos.json` (Mac). Shipped layouts and mods are
replaced on start; edited versions are moved to personal copies. Layout
clicks are kept separately. `keys.json` is installed when missing; files matching
an earlier shipped original byte-for-byte are upgraded to the current defaults.
Edited keys files are never replaced. Keep release originals in
`src/keys/shipped/` when changing defaults.

`defaults/mods/**` is embedded into the binary at compile time
(`build.rs` → `DEFAULT_MODS`), not read from disk at runtime: editing a
shipped mod without rebuilding `nx-app` changes nothing — on next start
the app sees the home copy as an edit, moves it to `<mod>-edited/`, and
writes the stale embedded version back. Rebuild before testing or
delivering a `defaults/` change; `cargo:rerun-if-changed` on the folder
makes `cargo build` pick it up. A leftover `<mod>-edited/` dir still has
`main.js`, so `mods::scan` loads it as a separate mod — delete stale
archives after upgrading.

## Platform differences

Gate per OS only where the OS really behaves differently. A one-line
`cfg!(windows)` next to the quirk is fine, with a comment saying why; anything
bigger goes behind one small module per concern rather than `#[cfg]` spread
through shared code. Give the quirk a test on its platform and keep the other
platforms' behavior unchanged (and tested). Windows and macOS changes are
checked on those systems, not only by cross-compiling.

## Building and testing

`just build`, `just test` (what CI runs, on Linux), `just check` (the tests).
`just install` builds and installs the desktop app using the platform installer.
On Windows it updates `%LOCALAPPDATA%\Programs\nx-app` and the Start menu;
quit and reopen NEXUS to use the new build. Windows recipes use PowerShell by default;
`just --shell pwsh --shell-arg -Command <recipe>` uses pwsh.

Never run a bare `target/*/nx-app` (no arguments) on a machine where you
also use the app without `NX_APP_HOME` pointing at a scratch home: it
opens a second window on your real setup. Subcommands and `--help` only
talk.

On Linux, test UI changes in the sandbox: `scripts/sandbox up`, then `do
<command> [json]`, `status`, `shot` (screenshot), `move|click|drag`
(pointer input, window px), `type`, `key <keysym> [Control_L ...]`, `nx
...`, `restart`, `down`. It has its own core, home and a headless display
(Weston + Xwayland) under `/var/tmp/nx-app-sandbox`, so nothing pops up
on your screen. Never fake input on a real display. Run `scripts/sandbox
down` when done.

## Contributing

Work on a branch and open a pull request to `master`. CI must pass and Can
approves; merges are squashed. Commit messages: lowercase conventional
commits, single line, no AI co-author lines. Only Can releases (a `v*` tag).

CHANGELOG.md: every release gets a `## [x.y.z] - YYYY-MM-DD` section
(`### New` / `### Fixed`), written at release time from the commits since the
last tag; NEXUS shows it as the update notes. One line per change, in user
words (what a person notices, not code), with the issue or PR number and
`thanks @name` for contributors. Leave out internal changes and fixes for bugs
that never shipped.

Add `<!-- spotlight -->` below a version heading to open What's New once
when users update to it (including skipped versions). Use `<!-- spotlight macos -->`
or a space-separated list such as `<!-- spotlight macos linux -->` to open it
only on those platforms: `macos`, `linux`, `windows`. Other platforms keep the
normal corner update note and can still read the full notes manually. Without
platforms, a spotlight applies everywhere. Keep the marker in CHANGELOG.md:
the release uploads the file unchanged to `releases.nx.invalid/app/<v>/changelog.md`,
and `scripts/notes-media.ts check <v>` checks images without rewriting notes.

Never stop, signal, or restart someone else's app or core. Use an isolated
app home and core session for testing.
