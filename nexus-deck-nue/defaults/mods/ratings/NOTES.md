# Ratings mod POC

This mod is a **read-only local fixture**. `MOCK DATA / LOCAL FIXTURE` is shown
in the panel, and every history note is synthetic. Its provider is an
in-file core-response-shaped fixture passed through `normalizeRatings()`;
there is no live HTTP/API fetch, `nx()` ratings call, timer, or write command.

## Theme and rendering

- Uses the host `theme()` map (`chrome`, `surface`, `raised`, `border`,
  `foreground`, `muted`, `dim`, `accent`, `working`, `blocked`, `done`).
- These semantic names resolve through the NEXUS theme file
  `defaults/themes/nexus.json`; the mod contains no literal color values.
- Rendering uses only `gpui-kit` / `gpui-base` primitives and remains
  read-only. The source is `D:\nexus\nexus-deck\defaults\mods\ratings\`.
- `defaults/layouts/nexus-farm.json` includes `ratings` in its `farm-panel`
  stack. `defaults/layouts/main.json` does not include the Ratings mod; it is
  not accurate to say that the mod is absent from all layout definitions in
  the source tree.

## Provider shape and limits

- The local fixture has the core response shape
  `{ ratings: Record<agent_id, { score, updated_ts, history }> }`; history
  entries contain `task`, `score`, `ts`, and optional `note`.
- `normalizeRatings()` maps that fixture to the UI rows
  `{ id, name, score, history }`. It copies each core `score` directly and
  does not derive it from history. The visible fixture summary averages the
  per-agent fixture scores only; it does not change any row score.
- The Deck pane does not fetch a live API or connect to a live `RatingsStore`.
  It is read-only and has no score-writing path. Live provider wiring and
  endpoint availability are not established by this source-only seam.
- A future live provider requires a separately approved read-only contract;
  this mod does not define an endpoint, URL, credential, or write capability.

## Artifact status

- The canonical source path is
  `D:\nexus\nexus-deck\defaults\mods\ratings\`.
- The `nexus-farm` source layout references the mod; the default `main` source
  layout does not. This is a source/layout fact, not proof of the contents of
  an installed or built app.
- Runtime and build inclusion were not checked in this wave. Claims about the
  current binary, `mod.json` overlay behavior, or runtime launch command remain
  unresolved and require a separate approved check.
- The NEO2 report referenced for this documentation pass was not found under
  `D:\nexus\reports` or `D:\Temp\reports`; no report-only facts are asserted.
