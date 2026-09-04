# AGENTS.md — pi-asciinema

pi agent package: the `cast_read` extension lets agents read and analyze asciinema
`.cast` terminal recordings (summary / events / ANSI-stripped text / markers).

## Rules

- **PR-only landing; never push to `main`; never force-push.** feat/ branch + PR
  gated by the org `charly/pr-validator`; merge via native auto-merge; CalVer tag
  and CHANGELOG written by tag-on-merge. Push via HTTPS + gh credential helper
  (`gh auth setup-git`) — the SSH key is not registered.
- **Zero runtime deps.** The parser/render are self-contained (v1/v2/v3). Do not
  add npm dependencies for parsing; runtime deps stay limited to pi-bundled
  peers (`typebox`, `@earendil-works/pi-coding-agent` as type-only).
- **Bounded tool output.** `cast_read` must never dump unbounded text into agent
  context — hard-capped by `max_chars` (default 40000), paged via offset/limit.
- **Tests before PR.** `npm run typecheck`, `npm test` (L1 parser/render unit +
  L2 direct-execute), `npm run check:load` (pi extension loads).
- **Full validation.** `npm run validate:pi-p` (CI variant) and
  `npm run validate:bare` (bare `pi -p` from the umbrella root — the org-level
  proof that the extension works with zero extra parameters).
- **Fixtures provenance.** `test/fixtures/*.cast` are committed synthetic minis.
  `dev-fixtures/` holds copies of gitignored org evidence (eval-omarchy/media) for
  local real-workload validation — NEVER commit those.

## Recorded insights (2026-09-04, from live use)

- **pi `-p`/`--print` is a BOOLEAN flag.** It only consumes the NEXT arg as the
  prompt when that arg does not start with `-` (or `@`); options after `-p`
  parse normally (pi dist bundle chunk-OMWWHBTG.js). Always write the prompt
  immediately after `-p` for the canonical, unambiguous form.
- **`--tools <allowlist>` + `--no-builtin-tools` in print mode drops EXTENSION
  tools** (observed: "Available tools: (none)") in pi 0.84.4 — the validation
  harnesses intentionally do NOT allowlist; determinism comes from directive
  prompts + token assertions + L2 direct-execute tests.
- **First `pi` spawn in a fresh checkout is slow**: it absorbs lazy package
  installs (git clones, vendored mirrors, npm). Harnesses pre-warm with one
  cheap `pi -p` call before the L3 matrix.
- **Model paraphrasing vs. assertions**: L3 token assertions must target stable
  facts (exact strings like `tmux-256color`, digits) not formatting ("80 x 24"
  vs "80 × 24"). L1/L2 carry the exact-value guarantees.

## Attribution

Parser semantics modeled on asciinema-player's `src/parser/asciicast.js` — see
NOTICE. asciicast v2/v3 format spec: docs.asciinema.org.
