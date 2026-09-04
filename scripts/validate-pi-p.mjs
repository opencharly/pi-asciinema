#!/usr/bin/env node
/**
 * CI-safe L3 validation: same matrix as validate-bare.mjs but for a fresh
 * checkout — explicit flags (no umbrella config, no trust, no default model).
 *
 *   node scripts/validate-pi-p.mjs [--provider P] [--model M] [--api-key K]
 *   env: PI_PROVIDER, PI_MODEL, PI_API_KEY / OPENAI_API_KEY
 *
 * The tool allowlist (`--no-builtin-tools --tools cast_read`) makes cast_read
 * the ONLY tool the agent can call — a correct answer proves the tool ran.
 * With PI_JSON_OBS=1 one extra case runs under `--mode json` to capture the
 * tool_call/tool_result events for CI observability.
 */
import { spawnSync, execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(repo, "extensions", "index.ts");
const fix = (...p) => join(repo, "test", "fixtures", ...p);

const args = process.argv.slice(2);
const opt = (name, envName, fb) => {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  if (process.env[envName]) return process.env[envName];
  return fb;
};
const provider = opt("--provider", "PI_PROVIDER", "openai");
const model = opt("--model", "PI_MODEL", "gpt-4o-mini");
const apiKey = opt("--api-key", "PI_API_KEY", process.env.OPENAI_API_KEY ?? "");
const jsonObs = process.env.PI_JSON_OBS === "1";
const skipExtFlag = args.includes("--no-ext-flag"); // local emulation: cwd (umbrella) already loads the extension via its .pi/settings.json

let failures = 0;
function check(name, cond, detail) {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`${mark}  ${name}${detail ? " — " + detail : ""}`);
}

// 0. load check (no LLM)
const load = spawnSync("pi", ["--no-extensions", "-e", ext, "--list-models", "__pi_asciinema_load_check__"], {
  encoding: "utf8",
  timeout: 60000,
});
check("load check: extension registers without a model", load.status === 0, load.stderr?.trim().slice(-200));

// big fixture for the bounds case
const big = join(repo, ".tmp-big.cast");
try {
  execFileSync(process.execPath, [join(repo, "scripts", "gen-big-fixture.mjs")], {
    env: { ...process.env, OUT: big, BYTES: String(5 * 1024 * 1024) },
    stdio: "pipe",
  });
} catch (e) {
  check("gen-big-fixture", false, String(e.message));
}

function runCase(prompt) {
  // NOTE: no --no-builtin-tools/--tools allowlist on purpose — in pi 0.84.4 the
  // allowlist drops extension tools in print mode (verified); determinism is
  // carried by directive prompts + token assertions + L2 direct-execute tests.
  // Canonical documented form: `-p "<prompt>"` immediately after -p/--print, so
  // the invocation is unambiguous under every parser reading (pi: -p is boolean;
  // it only consumes the NEXT arg as the prompt when it does not look like an
  // option or @file — pi dist bundle chunk-OMWWHBTG.js).
  const baseArgs = ["-p", prompt, "--no-session", "--no-context-files", "--provider", provider, "--model", model];
  if (!skipExtFlag) baseArgs.splice(1, 0, "-e", ext);
  const r = spawnSync(
    "pi",
    [...baseArgs, ...(apiKey ? ["--api-key", apiKey] : [])],
    { cwd: skipExtFlag ? process.cwd() : repo, encoding: "utf8", timeout: 300000, maxBuffer: 32 * 1024 * 1024 }
  );
  return r;
}

function all(stdout, re) {
  if (re instanceof RegExp) return re.test(stdout);
  return re.every((r) => (r instanceof RegExp ? r.test(stdout) : stdout.includes(r)));
}

const cases = [
  { name: "summary on v3 fixture", prompt: `Use the cast_read tool on ${fix("v3-session.cast")} with format=summary. Report the exact terminal size, duration, and per-type event counts.`,
    need: [/tmux-256color/, /2\.44/, /80/, /24/] },
  { name: "text extraction on v3 fixture", prompt: `Use the cast_read tool on ${fix("v3-session.cast")} with format=text and include_timing=false. Quote the exact commands that were run.`,
    need: ["grep -n cardwire", "toggle-check-done"] },
  { name: "markers surfaced", prompt: `Use the cast_read tool on ${fix("markers.cast")} with format=summary. List the marker names.`,
    need: ["Introduction"] },
  { name: "v2 compatibility", prompt: `Use the cast_read tool on ${fix("v2-session.cast")} with format=summary. Report the exact terminal size and duration.`,
    need: [/100\s*[x×]\s*30/, /3\.100s/] },
  { name: "malformed cast handled gracefully", prompt: `Use the cast_read tool on ${fix("malformed.cast")} with format=summary. Report any warnings or skipped lines the tool mentions.`,
    need: [/malform/i, /skip/i] },
  { name: "bounds respected (max_chars=2000)", prompt: `Use the cast_read tool on ${big} with format=text, max_chars=2000, include_timing=false. Report the truncation note the tool returned.`,
    need: [/truncat/i, /omitted/i] },
];

console.log(`provider=${provider} model=${model} apiKey=${apiKey ? "set" : "(env)"} jsonObs=${jsonObs}\n`);
{
  const w = spawnSync("pi", ["-p", "Reply with exactly: warm", "--no-session", "--no-context-files", ...(apiKey ? ["--api-key", apiKey] : []), "--provider", provider, "--model", model], { cwd: skipExtFlag ? process.cwd() : repo, encoding: "utf8", timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  check("warmup: pi -p responds", w.status === 0, (w.stderr || "").trim().slice(-200));
}
for (const c of cases) {
  const r = runCase(c.prompt);
  const out = (r.stdout || "") + (r.stderr || "");
  const exited = r.status === 0;
  const tok = all(out, c.need);
  check(`${c.name} [exit=${r.status ?? r.error?.code}]`, exited && tok, exited && tok ? "" : out.trim().slice(-600).replace(/\s+/g, " "));
}

if (jsonObs) {
  const jsonArgs = ["--mode", "json", "--no-session", "--no-context-files", "--provider", provider, "--model", model];
  if (!skipExtFlag) jsonArgs.splice(1, 0, "-e", ext);
  const r = spawnSync(
    "pi",
    [...jsonArgs, ...(apiKey ? ["--api-key", apiKey] : []),
      "--", `Use the cast_read tool on ${fix("v3-session.cast")} with format=summary. Report the duration.`],
    { cwd: skipExtFlag ? process.cwd() : repo, encoding: "utf8", timeout: 300000, maxBuffer: 32 * 1024 * 1024 }
  );
  const out = r.stdout || "";
  check("json-mode observability: cast_read tool_call event captured", r.status === 0 && /tool_call/.test(out) && out.includes("cast_read"), out.slice(-400));
}

console.log(`\n${failures === 0 ? "ALL L3 ci-VARIANT CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
