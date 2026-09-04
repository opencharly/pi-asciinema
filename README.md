# pi-asciinema

pi agent extension: **`cast_read`** — read and analyze asciinema `.cast`
terminal recordings directly from agents. Summary, event filtering, markers,
timing, and an ANSI-stripped transcript — bounded output, zero runtime
dependencies.

A `.cast` file is NDJSON with raw ANSI escapes: unreadable via a plain `read`.
`cast_read` parses it (asciicast **v1/v2/v3**) and returns structure the agent
can reason about. This is the tool to use when analyzing recordings produced by
asciinema or by Charly's `record:` check verb (`/tmp/charly-recordings/*.cast`,
`eval-omarchy/media/*.cast` PR-evaluation evidence, `artifact:` copies).

## Install (opencharly — main config lives in the umbrella)

The org's main pi config is the umbrella repo's `.pi/settings.json`. Add the
package there (after the repo tag exists):

```jsonc
// .pi/settings.json
{
  "packages": [
    "git:github.com/opencharly/pi-asciinema@v0.1.0"
  ]
}
```

From the umbrella root, **`pi -p "<prompt>"` then just works** — the extension
loads from the project config, with **zero extra parameters**.
Standalone install is also supported:

```bash
pi install git:github.com/opencharly/pi-asciinema@v0.1.0
# or try without installing:
pi -e git:github.com/opencharly/pi-asciinema
```

## Usage

```
Use cast_read on <path.cast> with format=summary
Use cast_read on <path.cast> with format=text and include_timing=false
Use cast_read on <path.cast> with format=events, event_types=["x"]
Use cast_read on <path.cast> with format=text, time_range=[5, 20], limit=200
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `path` | string | — | `.cast` path, absolute or relative to cwd |
| `format` | `summary\|events\|text` | `summary` | output shape |
| `time_range` | `[start, end]` | — | keep events in normalized seconds |
| `event_types` | `o\|i\|m\|x`[] | all | filter events |
| `strip_ansi` | boolean | `true` | strip ANSI escapes |
| `include_timing` | boolean | `true` | `[t]` prefix per text line |
| `max_chars` | int | `40000` | hard output cap (max 100000) |
| `offset` / `limit` | int | `0` / — | line paging |

Output is **always bounded** by `max_chars` with a truncation note — never
floods agent context.

## Format support

- **v3** — `term:{cols,rows}`, event times are deltas (accumulated)
- **v2** — `width`/`height`, event times absolute
- **v1** — single-document `{version:1, stdout:[[dt, data], …]}`
- Tolerant: unknown header keys preserved; malformed event lines skipped and
  reported; `x` events accept string or object payloads (exit code, resize)
- Event types: `o` output, `i` input, `m` marker (chapter label), `x` other

Timing semantics follow asciinema-player's reference parser (see NOTICE).

## Development

```bash
npm run typecheck       # tsc --noEmit
npm test                # L1 parser/render unit + L2 direct-execute (no LLM)
npm run check:load      # pi loads the extension without a model
npm run validate:pi-p   # L3 matrix, explicit flags (CI-safe; needs a provider)
npm run validate:bare   # L3 bare `pi -p` matrix from the umbrella root (org-level proof)
```

Validation is three-layered: L1/L2 are deterministic (no LLM); L3 runs a real
agent over real casts — `validate:bare` executes literal
`cwd=<umbrella> && pi -p "<prompt>"` with no other flags, against committed
fixtures **and** copies of real `eval-omarchy/media` casts (kept in gitignored
`dev-fixtures/`, provenance: eval-omarchy PR-evaluation recordings).

## License

MIT — see LICENSE. Parser semantics modeled on asciinema-player (MIT) — see
NOTICE.
