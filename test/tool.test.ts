import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import extDefault from "../extensions/index.ts";

// Load the extension exactly as pi does (factory + registerTool), then drive the
// registered tool's execute() directly — deterministic L2 coverage without an LLM.
let tool: any;
const fakePi = { registerTool: (def: any) => {
    tool = def;
  } } as any;
extDefault(fakePi);
assert.ok(tool, "extension must register cast_read");
assert.equal(tool.name, "cast_read");

const ROOT = resolve(import.meta.dirname, "..");
const ctx = { cwd: ROOT };
async function run(params: any) {
  return tool.execute("id", params, undefined, undefined, ctx);
}

test("summary on v3 fixture via relative path", async () => {
  const r = await run({ path: "test/fixtures/v3-session.cast", format: "summary" });
  assert.equal(r.isError, false);
  const t = r.content[0].text;
  assert.match(t, /80 x 24/);
  assert.match(t, /2\.445s/);
  assert.match(t, /o=9, i=0, m=0, x=1/);
});

test("text mode: ANSI stripped, real content present", async () => {
  const r = await run({ path: "test/fixtures/v3-session.cast", format: "text", include_timing: false });
  assert.ok(!r.content[0].text.includes("\u001b["));
  assert.match(r.content[0].text, /grep -n cardwire/);
  assert.match(r.content[0].text, /toggle-check-done/);
});

test("events mode: type filter", async () => {
  const r = await run({ path: "test/fixtures/v2-session.cast", format: "events", event_types: ["x"] });
  assert.match(r.content[0].text, /resize/);
  assert.ok(!r.content[0].text.includes("hello v2 world"));
});

test("markers surfaced in summary", async () => {
  const r = await run({ path: "test/fixtures/markers.cast" });
  assert.match(r.content[0].text, /Introduction/);
  assert.match(r.content[0].text, /markers \(2\)/);
});

test("time_range narrows text", async () => {
  const r = await run({ path: "test/fixtures/v2-session.cast", format: "text", time_range: [3.0, 3.2], include_timing: false });
  assert.match(r.content[0].text, /fail/);
  assert.ok(!r.content[0].text.includes("hello v2 world"));
});

test("max_chars bounds big text with note", async () => {
  const big = join(mkdtempSync(join(tmpdir(), "cast-")), "big.cast");
  writeFileSync(big, readFileSync(resolve(ROOT, "test/fixtures/v3-session.cast"), "utf8") + JSON.stringify([9990, "o", "z".repeat(50000)]));
  const r = await run({ path: big, format: "text", max_chars: 1000, include_timing: false });
  assert.ok(r.content[0].text.length <= 1200);
  assert.match(r.content[0].text, /truncated by max_chars=/);
});

test("error contract: missing file", async () => {
  const r = await run({ path: "test/fixtures/does-not-exist.cast" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /cast_read error/);
});

test("error contract: not a cast", async () => {
  const tmp = join(mkdtempSync(join(tmpdir(), "cast-")), "not-a-cast.txt");
  writeFileSync(tmp, "plain text, not json\n");
  const r = await run({ path: tmp });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not an asciinema .cast file/);
});

test("error contract: empty file", async () => {
  const tmp = join(mkdtempSync(join(tmpdir(), "cast-")), "empty.cast");
  writeFileSync(tmp, "");
  const r = await run({ path: tmp });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /empty file/);
});

test("malformed cast parses tolerantly via tool", async () => {
  const r = await run({ path: "test/fixtures/malformed.cast" });
  assert.equal(r.isError, false);
  assert.match(r.content[0].text, /3 malformed line\(s\) skipped/);
  assert.match(r.content[0].text, /after garbage/);
});
