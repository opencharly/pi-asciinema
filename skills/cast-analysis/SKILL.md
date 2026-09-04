---
name: cast-analysis
description: |-
  Analyze asciinema .cast terminal recordings with the cast_read tool. Use for
  terminal recordings from asciinema, Charly's `record:` check verb
  (/tmp/charly-recordings/*.cast, artifact: copies), or PR-evaluation evidence
  (eval-omarchy/media/*.cast). Covers the cast_read modes, parameters, and
  analysis recipes.
---

# Analyzing .cast recordings with cast_read

`.cast` files are NDJSON with raw ANSI escapes: a header line
(`{"version":2,"width":..,"height":..}` or v3 `{"version":3,"term":{"cols":..,"rows":..}}`)
followed by one event per line `[time, type, data]`. Types: `o` output,
`i` input, `m` marker (chapter label), `x` other (exit code, resize).

**Never read a .cast with the plain `read` tool** — the payload is unreadable.
Use `cast_read` (from the pi-asciinema extension).

## Start with a summary

```
cast_read(path, format="summary")
```

Returns: terminal size, duration, timestamp, command/title, env keys, per-type
event counts, **markers** (chapter names with times), first/last output
previews, and any malformed-line warnings. Enough to answer “what happened
and for how long” in one call.

## Recipes

| Goal | Call |
|---|---|
| Full transcript (grep-able, ANSI stripped) | `format="text"` |
| The exact commands run | `format="text"` then look at `$ `-prefixed lines |
| A specific time window | `format="text", time_range=[s,e]` |
| Only markers / chapters | `format="summary"` (markers section) or `event_types=["m"]` |
| Raw event table (timing, types) | `format="events"` |
| Resize/exit metadata | `format="events", event_types=["x"]` |

## Output discipline (never flood context)

- Output is hard-capped by `max_chars` (default 40000) with a truncation note.
- Page long transcripts with `offset`/`limit` (line-based), or narrow with
  `time_range`/`event_types`.
- A large recording should be approached iteratively: summary → targeted text
  windows — not one giant `format="text"` dump.

## Org workflows

- `record:` check-verb artifacts: in-container `/tmp/charly-recordings/<name>.cast`,
  copied out via `artifact:` (usually beside `<name>.gif`/`.mp4`).
- PR-evaluation evidence: `eval-omarchy/media/*.cast` (e.g. `pr-9332-2026.246.0638.cast`,
  `omarchy-gif-2026.246.1747/omarchy-gif.cast`) — the .cast is the GROUND TRUTH
  of what ran; a .gif next to it is just the rendered view.
- The eval-omarchy media dir is gitignored evidence; when analyzing, read the
  paths in place (never commit them).

## Validation harnesses (for the tool owners)

- `scripts/validate-bare.mjs` — run from the umbrella root: literal bare
  `pi -p "<prompt>"` matrix over committed fixtures + real eval-omarchy casts.
- `scripts/validate-pi-p.mjs` — CI-safe variant with explicit flags; add `-e`
  when the extension is not in project settings; `--no-ext-flag` when the cwd
  already loads it via project packages.
- Remember: first pi spawn in a fresh checkout is slow (lazy package
  installs) — the harnesses pre-warm with one cheap call.
