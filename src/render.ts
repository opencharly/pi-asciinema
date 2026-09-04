/**
 * Rendering helpers for parsed casts: ANSI stripping, summaries, text/event
 * output, and hard bounds so tool output never floods agent context.
 */
import type { CastEvent, CastHeader, EventType, ParsedCast } from "./parser.ts";

/** Strip ANSI/CSI/OSC escape sequences (VT100, 256-color, truecolor, titles). */
export function stripAnsi(s: string): string {
  return s
    .replace(/\u001b\](?:[^\u0007\u001b]*(?:\u0007|\u001b\\)?)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()#][0-9A-Za-z]/g, "")
    .replace(/\u001b[@-Z\\-_]/g, "");
}

function fmtDuration(sec: number): string {
  if (!isFinite(sec)) return "n/a";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}m${s.toFixed(3)}s` : `${s.toFixed(3)}s`;
}

function fmtTimestamp(ts: number | undefined): string {
  if (ts === undefined) return "n/a";
  try {
    return new Date(ts * 1000).toISOString();
  } catch {
    return String(ts);
  }
}

function dataPreview(e: CastEvent, strip: boolean): string {
  const raw = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
  const clean = strip ? stripAnsi(raw) : raw;
  return clean.replace(/[\r\n]+/g, " ").slice(0, 120);
}

export function buildSummary(cast: ParsedCast): string {
  const h: CastHeader = cast.header;
  const counts: Record<EventType, number> = { o: 0, i: 0, m: 0, x: 0 };
  for (const e of cast.events) counts[e.type]++;
  const lines: string[] = [];
  lines.push(`cast summary for ${h.version === 1 ? "v1" : `v${h.version}`} recording`);
  lines.push(`  terminal: ${h.cols} x ${h.rows}${h.termType ? ` (${h.termType})` : ""}`);
  lines.push(`  duration: ${fmtDuration(cast.duration)}`);
  lines.push(`  timestamp: ${fmtTimestamp(h.timestamp)}`);
  if (h.command) lines.push(`  command: ${h.command}`);
  if (h.title) lines.push(`  title: ${h.title}`);
  if (h.env) lines.push(`  env: ${Object.keys(h.env).join(", ") || "-"}`);
  if (h.idleTimeLimit !== undefined) lines.push(`  idle_time_limit: ${h.idleTimeLimit}s`);
  lines.push(`  events: ${cast.events.length} total (o=${counts.o}, i=${counts.i}, m=${counts.m}, x=${counts.x})`);
  if (cast.skippedLines > 0) lines.push(`  warnings: ${cast.skippedLines} malformed line(s) skipped`);
  if (cast.markers.length > 0) {
    lines.push(`  markers (${cast.markers.length}):`);
    for (const mk of cast.markers) lines.push(`    @${fmtDuration(mk.time)} ${mk.name.replace(/[\r\n]+/g, " ") || "(unnamed)"}`);
  }
  const outs = cast.events.filter((e) => e.type === "o");
  if (outs.length > 0) {
    lines.push(`  first output:`);
    for (const e of outs.slice(0, 2)) lines.push(`    @${fmtDuration(e.time)} ${dataPreview(e, true)}`);
    if (outs.length > 4) {
      lines.push(`  last output:`);
      for (const e of outs.slice(-2)) lines.push(`    @${fmtDuration(e.time)} ${dataPreview(e, true)}`);
    }
  }
  return lines.join("\n");
}

export interface RowOptions {
  stripAnsi?: boolean;
  timeRange?: [number, number];
  eventTypes?: EventType[];
  offset?: number;
  limit?: number;
}

export function renderEvents(cast: ParsedCast, opts: RowOptions = {}): string {
  const strip = opts.stripAnsi ?? true;
  const rows = filterEvents(cast, opts);
  const lines = rows.map((e) => `${e.time.toFixed(3)} ${e.type.padEnd(2)} ${dataPreview(e, strip)}`);
  return page(lines, opts.offset ?? 0, opts.limit);
}

export function renderText(cast: ParsedCast, opts: RowOptions & { includeTiming?: boolean } = {}): string {
  const strip = opts.stripAnsi ?? true;
  const timing = opts.includeTiming ?? true;
  const markers = new Map(
    cast.events.filter((e) => e.type === "m").map((e, i) => [e.line, { time: e.time, name: String(e.data), i }])
  );
  const out: string[] = [];
  for (const e of filterEvents(cast, opts)) {
    if (e.type === "m") {
      const mk = markers.get(e.line);
      out.push(`${timing ? `[${fmtDuration(mk ? mk.time : e.time)}] ` : ""}[marker: ${mk ? mk.name : String(e.data)}]`);
      continue;
    }
    if (e.type !== "o") continue;
    const payload = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
    const clean = strip ? stripAnsi(payload) : payload;
    if (clean === "") continue;
    const prefix = timing ? `[${fmtDuration(e.time)}] ` : "";
    for (const line of clean.split(/\r?\n/)) {
      out.push(prefix + line);
    }
  }
  return page(out, opts.offset ?? 0, opts.limit);
}

function filterEvents(cast: ParsedCast, opts: RowOptions): CastEvent[] {
  let es = cast.events;
  if (opts.timeRange) {
    const [a, b] = opts.timeRange;
    es = es.filter((e) => e.time >= a && e.time <= b);
  }
  if (opts.eventTypes) es = es.filter((e) => opts.eventTypes!.includes(e.type));
  return es;
}

function page(lines: string[], offset: number, limit: number | undefined): string {
  const from = Math.max(0, offset);
  const slice = limit !== undefined ? lines.slice(from, from + limit) : lines.slice(from);
  let out = slice.join("\n");
  if (from > 0) out = `[started at line ${from} of ${lines.length}]\n` + out;
  if (limit !== undefined && from + slice.length < lines.length)
    out += `\n[truncated: ${lines.length - (from + slice.length)} more line(s); increase limit or narrow filters]`;
  return out;
}

export interface BoundsResult {
  text: string;
  truncated: boolean;
}

export function applyBounds(text: string, maxChars: number): BoundsResult {
  if (text.length <= maxChars) return { text, truncated: false };
  const note = `\n[truncated by max_chars=${maxChars}: ${text.length} character(s) omitted; narrow time_range/event_types or use offset/limit]`;
  const head = text.slice(0, Math.max(0, maxChars - note.length));
  const out = head + note;
  return { text: out.length <= maxChars ? out : out.slice(0, maxChars), truncated: true };
}
