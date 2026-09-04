/**
 * asciinema .cast parser — v1/v2/v3 with zero runtime dependencies.
 *
 * Format (docs.asciinema.org/manual/asciicast/):
 *  - v1: one JSON document { version:1, width, height, stdout: [[dt, data], …] }
 *  - v2: first line JSON header { version:2, width, height, … }, then one JSON
 *        event per line [t, type, data] with t ABSOLUTE seconds since start.
 *  - v3: first line JSON header { version:3, term:{cols,rows,…}, … }, then one JSON
 *        event per line [dt, type, data] with dt = DELTA from previous event.
 *
 * Timing semantics follow asciinema-player's src/parser/asciicast.js (MIT):
 * v1 and v3 deltas are accumulated into absolute times; v2 times are used as-is.
 * All normalized events carry absolute seconds since start.
 *
 * Event types: "o" output (string), "i" input (string), "m" marker (string
 * label, may be empty), "x" other (string or object, e.g. exit / resize).
 */

export const MAX_CAST_FILE_BYTES = 100 * 1024 * 1024;

export interface CastHeader {
  version: number;
  cols: number;
  rows: number;
  timestamp?: number;
  idleTimeLimit?: number;
  command?: string;
  title?: string;
  termType?: string;
  env?: Record<string, string>;
  extras: Record<string, unknown>;
}

export type EventType = "o" | "i" | "m" | "x";

export interface CastEvent {
  /** Normalized absolute seconds since the start of the recording. */
  time: number;
  type: EventType;
  /** string for o/i/m; string or object for x. */
  data: string | Record<string, unknown>;
  /** 1-based source line number (header line is 1). */
  line: number;
}

export interface ParsedCast {
  header: CastHeader;
  events: CastEvent[];
  /** Normalized duration in seconds = max normalized event time. */
  duration: number;
  /** Number of lines skipped as malformed. */
  skippedLines: number;
  markers: { time: number; name: string }[];
}

export class CastParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastParseError";
  }
}

const EVENT_TYPES: readonly EventType[] = ["o", "i", "m", "x"];

function headerFrom(h: Record<string, unknown>): CastHeader {
  const v = h.version;
  if (v !== 1 && v !== 2 && v !== 3) {
    throw new CastParseError(`unsupported asciicast version ${JSON.stringify(v)} (expected 1, 2 or 3)`);
  }
  const term = (h.term ?? {}) as Record<string, unknown>;
  const cols = v === 3 ? (term.cols as number) : (h.width as number);
  const rows = v === 3 ? (term.rows as number) : (h.height as number);
  const env = h.env as Record<string, string> | undefined;
  return {
    version: v,
    cols: typeof cols === "number" && cols > 0 ? cols : 80,
    rows: typeof rows === "number" && rows > 0 ? rows : 24,
    timestamp: typeof h.timestamp === "number" ? h.timestamp : undefined,
    idleTimeLimit: typeof h.idle_time_limit === "number" ? h.idle_time_limit : undefined,
    command: typeof h.command === "string" ? h.command : undefined,
    title: typeof h.title === "string" ? h.title : undefined,
    termType: v === 3 && typeof term.type === "string" ? term.type : undefined,
    env: env && typeof env === "object" ? env : undefined,
    extras: { ...h, term: undefined } as Record<string, unknown>,
  };
}

function finish(
  version: number,
  h: Record<string, unknown>,
  events: CastEvent[],
  skippedLines: number
): ParsedCast {
  let duration = 0;
  for (const e of events) if (e.time > duration) duration = e.time;
  return {
    header: headerFrom({ version, ...h } as Record<string, unknown>),
    events,
    duration,
    skippedLines,
    markers: events.filter((e) => e.type === "m").map((e) => ({ time: e.time, name: String(e.data) })),
  };
}

function eventFrom(parts: unknown[], time: number | undefined, line: number): CastEvent | null {
  const tv = parts[0];
  if (typeof tv !== "number") return null;
  const type = parts[1];
  const typ = typeof type === "string" && (EVENT_TYPES as readonly string[]).includes(type) ? (type as EventType) : undefined;
  if (!typ) return null;
  const raw = parts[2];
  const data: string | Record<string, unknown> =
    typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as Record<string, unknown>) : String(raw ?? "");
  return { time: time === undefined ? tv : time, type: typ, data, line };
}

function parseV1(h: Record<string, unknown>): ParsedCast {
  const events: CastEvent[] = [];
  let skipped = 0;
  let line = 1;
  let t = 0;
  const stdout = h.stdout;
  if (stdout !== undefined && !Array.isArray(stdout)) {
    throw new CastParseError("v1 cast: stdout is not an array");
  }
  for (const e of (stdout as unknown[] | undefined) ?? []) {
    line++;
    if (!Array.isArray(e) || typeof e[0] !== "number") {
      skipped++;
      continue;
    }
    t += e[0];
    const ev = eventFrom([t, "o", e[1] ?? ""], undefined, line);
    if (ev) events.push(ev);
    else skipped++;
  }
  return finish(1, { ...h, width: h.width ?? 80, height: h.height ?? 24 }, events, skipped);
}

function parseNdjson(header: Record<string, unknown>, restLines: string[], headerLine: number): ParsedCast {
  const events: CastEvent[] = [];
  let skipped = 0;
  let t = 0;
  const version = header.version as number;
  restLines.forEach((raw, idx) => {
    const line = headerLine + 1 + idx;
    const s = raw.trim();
    if (!s) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      skipped++;
      return;
    }
    if (!Array.isArray(parsed)) {
      skipped++;
      return;
    }
    const tv = parsed[0];
    if (typeof tv !== "number") {
      skipped++;
      return;
    }
    if (version === 2) t = tv;
    else t += tv;
    const ev = eventFrom(parsed, t, line);
    if (ev) events.push(ev);
    else skipped++;
  });
  return finish(version, header, events, skipped);
}

function parseInlineArray(parsed: unknown[]): ParsedCast {
  // Whole-document array form: [header, ...events] for v2/v3 (player-compatible).
  const header = parsed[0] as Record<string, unknown>;
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new CastParseError("cast array form: first element is not a header object");
  }
  const h = { ...header } as Record<string, unknown>;
  return parseNdjson(h, parsed.slice(1).map((e) => JSON.stringify(e)), 0);
}

/**
 * Parse cast text. Throws CastParseError for anything that is not a cast.
 */
export function parseCastText(text: string): ParsedCast {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new CastParseError("empty file — no asciicast header");
  const first = lines[headerIdx].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(first);
  } catch {
    throw new CastParseError("first line is not valid JSON — not an asciinema .cast file");
  }
  if (Array.isArray(parsed)) return parseInlineArray(parsed);
  if (parsed && typeof parsed === "object") {
    const h = parsed as Record<string, unknown>;
    if (h.version === 1) return parseV1(h);
    if (h.version === 2 || h.version === 3) return parseNdjson(h, lines.slice(headerIdx + 1), headerIdx);
    throw new CastParseError(`unsupported asciicast version ${JSON.stringify(h.version)}`);
  }
  throw new CastParseError("unexpected header shape — not an asciinema .cast file");
}
