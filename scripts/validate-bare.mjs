#!/usr/bin/env node
/**
 * ORG-LEVEL validation: run the cast_read matrix as BARE `pi -p "<prompt>"`
 * from the umbrella repository root (cwd = umbrella), with NO additional
 * parameters — proving the umbrella main config (`.pi/settings.json` packages
 * entry) makes the extension work with zero flags.
 *
 * Usage:
 *   cd <umbrella-root>
 *   node <pi-asciinema>/scripts/validate-bare.mjs
 *
 * Fixtures: repo test/fixtures (committed) + repo dev-fixtures (copies of
 * real eval-omarchy/media casts — gitignored; copy them once per plan §7).
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const umbrella = process.cwd();
const fix = (...p) => join(repo, "test", "fixtures", ...p);
const dev = (...p) => join(repo, "dev-fixtures", ...p);

let failures = 0;

function check(name, cond, detail) {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`${mark}  ${name}${detail ? " — " + detail : ""}`);
}

// ---- preflight (no LLM) ----
console.log(`umbrella root: ${umbrella}`);
console.log(`repo root: ${repo}\n`);

const settingsPath = join(umbrella, ".pi", "settings.json");
const hasSettings =
  existsSync(settingsPath) &&
  JSON.parse(readFileSync(settingsPath, "utf8")).packages?.some((p) => typeof p === "string" && p.includes("pi-asciinema"));
check("preflight: umbrella .pi/settings.json has pi-asciinema package entry", hasSettings,
  hasSettings ? "" : "add it first (local path during dev, git ref after repo tag)");

const realPr = dev("pr-9332-2026.246.0638.cast");
const realGif = dev("omarchy-gif.cast");
check("preflight: dev-fixtures real casts present", existsSync(realPr) && existsSync(realGif),
  "copy from eval-omarchy/media (plan §7)");

const piProbe = spawnSync("pi", ["--version"], { encoding: "utf8", timeout: 30000 });
check("preflight: pi binary on PATH", piProbe.status === 0, piProbe.output?.join(" ")?.slice(0, 80));

// bounds case needs the big synthetic fixture
const big = join(repo, ".tmp-big.cast");
{
  const g = spawnSync(process.execPath, [join(repo, "scripts", "gen-big-fixture.mjs")], {
    env: { ...process.env, OUT: big, BYTES: String(5 * 1024 * 1024) },
    encoding: "utf8",
    timeout: 60000,
  });
  check("preflight: big fixture generated", g.status === 0 && existsSync(big), (g.stderr || "").slice(-200));
}

console.log(`\nWarming up pi (first spawn absorbs lazy package installs: clones, vendored mirrors, npm) — one cheap LLM call, then the matrix...\n`);
{
  const w = spawnSync("pi", ["-p", "Reply with exactly: warm"], { cwd: process.cwd(), encoding: "utf8", timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  check("warmup: bare pi -p responds", w.status === 0, (w.stderr || "").trim().slice(-200));
}

// ---- matrix: literal bare `pi -p "<prompt>"` ----
function bare(prompt) {
  const r = spawnSync("pi", ["-p", prompt], { cwd: umbrella, encoding: "utf8", timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  return r;
}

function all(stdout, re) {
  if (re instanceof RegExp) return re.test(stdout);
  return re.every((r) => (r instanceof RegExp ? r.test(stdout) : stdout.includes(r)));
}

const cases = [
  {
    name: "summary on real eval-omarchy cast (pr-9332, v3)",
    prompt:
      `Use the cast_read tool on ${realPr} with format=summary. Report the exact terminal size, duration, and per-type event counts that the tool returned.`,
    need: [/80\s*[x×]\s*24/, /2\.44/, /14/],
  },
  {
    name: "text extraction on real eval-omarchy cast (omarchy-gif)",
    prompt:
      `Use the cast_read tool on ${realGif} with format=text and include_timing=false. Quote the exact command that was executed and its exact output.`,
    need: ["echo OMARCHY_RECORD_GIF_OK", "OMARCHY_RECORD_GIF_OK"],
  },
  {
    name: "markers surfaced (committed markers.cast)",
    prompt: `Use the cast_read tool on ${fix("markers.cast")} with format=summary. List the marker names.`,
    need: ["Introduction"],
  },
  {
    name: "v2 compatibility (committed v2-session.cast)",
    prompt:
      `Use the cast_read tool on ${fix("v2-session.cast")} with format=summary. Report the exact terminal size and duration.`,
    need: [/100\s*[x×]\s*30/, /3\.100s/],
  },
  {
    name: "malformed cast handled gracefully (committed malformed.cast)",
    prompt: `Use the cast_read tool on ${fix("malformed.cast")} with format=summary. Report whether the recording has warnings, and any skipped/malformed lines the tool mentions.`,
    need: [/malform/i, /skip/i],
  },
  {
    name: "bounds respected on large cast (max_chars=2000)",
    prompt:
      `Use the cast_read tool on ${big} with format=text, max_chars=2000, include_timing=false. Report the truncation note the tool returned.`,
    need: [/truncat/i, /omitted/i],
  },
];

console.log(`\nRunning ${cases.length} bare pi -p cases (default model from the operator's pi config; may take a while)...\n`);
for (const c of cases) {
  const r = bare(c.prompt);
  const out = (r.stdout || "") + (r.stderr || "");
  const exited = r.status === 0;
  const tok = all(out, c.need);
  check(`${c.name} [exit=${r.status ?? r.error?.code}]`, exited && tok,
    exited && tok ? "" : out.trim().slice(-600).replace(/\s+/g, " "));
}

console.log(`\n${failures === 0 ? "ALL BARE pi -p CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
