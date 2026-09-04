import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCastText, CastParseError } from "../src/parser.ts";
import { stripAnsi, buildSummary, renderText, renderEvents, applyBounds } from "../src/render.ts";

const fx = (n: string) => readFileSync(resolve(import.meta.dirname, "fixtures", n), "utf8");

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("v3 fixture: header, accumulation, counts, duration, exit event", () => {
  const c = parseCastText(fx("v3-session.cast"));
  assert.equal(c.header.version, 3);
  assert.equal(c.header.cols, 80);
  assert.equal(c.header.rows, 24);
  assert.equal(c.header.termType, "tmux-256color");
  assert.deepEqual(c.header.env, { SHELL: "/bin/bash" });
  near(c.duration, 2.445);
  assert.equal(c.skippedLines, 0);
  const o = c.events.filter((e) => e.type === "o");
  const x = c.events.filter((e) => e.type === "x");
  assert.equal(o.length, 9);
  assert.equal(x.length, 1);
  assert.equal(x[0].data, "0"); // numeric exit data normalized to string
  assert.equal(c.events.length, 10);
  // deltas accumulate: event 4 (grep command) at 0.004+2.012
  const grep = o.find((e) => String(e.data).includes("grep -n cardwire"));
  near(grep!.time, 2.016, 1e-6);
});

test("v2 fixture: absolute times, markers, x-object event", () => {
  const c = parseCastText(fx("v2-session.cast"));
  assert.equal(c.header.version, 2);
  assert.equal(c.header.cols, 100);
  assert.equal(c.header.rows, 30);
  assert.equal(c.header.title, "demo");
  assert.equal(c.header.idleTimeLimit, 2.0);
  near(c.duration, 3.1);
  assert.equal(c.markers.length, 1);
  assert.equal(c.markers[0].name, "chapter two");
  near(c.markers[0].time, 2.75);
  const resize = c.events.filter((e) => e.type === "x");
  assert.equal(resize.length, 1);
  assert.equal((resize[0].data as Record<string, unknown>)["event"], "resize");
});

test("v1 fixture: single-doc, stdout deltas accumulate, type o", () => {
  const c = parseCastText(fx("v1-legacy.cast"));
  assert.equal(c.header.version, 1);
  near(c.duration, 1.5);
  assert.equal(c.events.length, 2);
  assert.deepEqual(c.events.map((e) => e.type), ["o", "o"]);
  near(c.events[0].time, 1.0);
  near(c.events[1].time, 1.5);
});

test("markers fixture: named + unnamed markers", () => {
  const c = parseCastText(fx("markers.cast"));
  assert.equal(c.markers.length, 2);
  assert.equal(c.markers[0].name, "Introduction");
  assert.equal(c.markers[1].name, "");
  near(c.markers[0].time, 1.0);
});

test("malformed fixture: skips bad lines, keeps good ones", () => {
  const c = parseCastText(fx("malformed.cast"));
  assert.equal(c.skippedLines, 3); // truncated json, bad type, object line
  assert.equal(c.events.length, 3);
  near(c.duration, 0.5);
  const x = c.events.find((e) => e.type === "x");
  assert.equal(x!.data, "0");
});

test("empty fixture: header only", () => {
  const c = parseCastText(fx("empty.cast"));
  assert.equal(c.events.length, 0);
  assert.equal(c.duration, 0);
  assert.equal(c.markers.length, 0);
});

test("error cases", () => {
  assert.throws(() => parseCastText(""), CastParseError);
  assert.throws(() => parseCastText("not json at all"), CastParseError);
  assert.throws(() => parseCastText('{"version":9}'), /unsupported asciicast version/);
  assert.throws(() => parseCastText("{}"), /unsupported asciicast version/);
});

test("stripAnsi: CSI, OSC, 256-color, truecolor", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"), "red");
  assert.equal(stripAnsi("\u001b[38;5;196mx\u001b[0m"), "x");
  assert.equal(stripAnsi("\u001b[38;2;255;0;0mt\u001b[0m"), "t");
  assert.equal(stripAnsi("\u001b]0;@title:\u0007payload"), "payload");
  assert.equal(stripAnsi("\u001b[?2004h\u001b(0x"), "x");
});

test("buildSummary covers header facts, counts, markers, warnings", () => {
  const s = buildSummary(parseCastText(fx("v2-session.cast")));
  assert.match(s, /100 x 30/);
  assert.match(s, /3\.100s/);
  assert.match(s, /o=3, i=0, m=1, x=1/);
  assert.match(s, /chapter two/);
  assert.match(s, /demo/);
  const m = buildSummary(parseCastText(fx("malformed.cast")));
  assert.match(m, /3 malformed line\(s\) skipped/);
});

test("renderText: ANSI stripped, timing prefixed, markers inline, paginated", () => {
  const t2 = renderText(parseCastText(fx("v2-session.cast")), { includeTiming: true });
  assert.ok(!t2.includes("\u001b["), "ansi must be stripped");
  assert.match(t2, /ok\r?\n/);
  assert.match(t2, /hello v2 world/);
  assert.match(t2, /\[marker: chapter two\]/);
  assert.match(t2, /\[0\.250s\]/);
  const page = renderText(parseCastText(fx("v2-session.cast")), { offset: 1, limit: 2 });
  assert.match(page, /started at line 1 of/);
  assert.match(page, /truncated:/);
});

test("renderEvents: filters by type and time range", () => {
  const v2 = parseCastText(fx("v2-session.cast"));
  const x = renderEvents(v2, { eventTypes: ["x"], stripAnsi: true });
  assert.match(x, /resize/);
  assert.ok(!x.includes("hello v2 world"));
  const late = renderEvents(v2, { timeRange: [3.0, 3.2] });
  assert.match(late, /fail/);
});

test("applyBounds truncates with note and never exceeds maxChars", () => {
  const r = applyBounds("1234567890".repeat(40), 300);
  assert.ok(r.truncated);
  assert.ok(r.text.length <= 300);
  assert.match(r.text, /truncated by max_chars=300/);
  assert.match(r.text, /^123456/);
  assert.equal(applyBounds("abc", 300).truncated, false);
});
