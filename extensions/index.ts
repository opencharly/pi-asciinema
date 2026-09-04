import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parseCastText, CastParseError, MAX_CAST_FILE_BYTES } from "../src/parser.ts";
import { buildSummary, renderEvents, renderText, applyBounds } from "../src/render.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "cast_read",
    label: "Read asciinema cast",
    description:
      "Read and analyze an asciinema .cast terminal recording (asciicast v1/v2/v3, " +
      "the format produced by asciinema and Charly's `record:` check verb). " +
      "Accepts a path to a .cast file and returns a bounded, structured analysis: " +
      "format=summary (metadata, terminal size, duration, per-type event counts, " +
      "markers, first/last output), format=events (filtered time/type/preview rows), " +
      "or format=text (ANSI-stripped transcript with markers inline). " +
      "Narrow with time_range / event_types and page large outputs with offset/limit; " +
      "output is always capped by max_chars (default 40000) with a truncation note. " +
      "Use this instead of reading a .cast file with `read`, whose raw NDJSON+ANSI " +
      "payload is not directly analyzable.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the .cast file (absolute, or relative to the current working directory)." }),
      format: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("events"), Type.Literal("text")], { description: "Output shape. Default: summary." })),
      time_range: Type.Optional(Type.Array(Type.Number({ minimum: 0 }), { minItems: 2, maxItems: 2, description: "Only events with normalized time within [start, end] seconds." })),
      event_types: Type.Optional(Type.Array(Type.Union([Type.Literal("o"), Type.Literal("i"), Type.Literal("m"), Type.Literal("x")]), { description: "Only these event types. Default: all." })),
      strip_ansi: Type.Optional(Type.Boolean({ description: "Strip ANSI escapes from output/input data (default true for text/events/summary)." })),
      include_timing: Type.Optional(Type.Boolean({ description: "Prefix each text line with [t] seconds since start (default true)." })),
      max_chars: Type.Optional(Type.Integer({ minimum: 256, maximum: 100000, description: "Hard cap on returned text (default 40000)." })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "Text/events: skip this many leading lines." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000, description: "Text/events: return at most this many lines." })),
    }),
    async execute(_id: string, params: any, _signal: unknown, _onUpdate: unknown, ctx: any) {
      try {
        const cwd: string = ctx?.cwd ?? process.cwd();
        const abs = resolve(cwd, params.path);
        const txt = readFileSync(abs, "utf8");
        if (txt.length > MAX_CAST_FILE_BYTES) {
          return {
            content: [{ type: "text", text: `cast_read error: ${abs} is ${txt.length} bytes — exceeds ${MAX_CAST_FILE_BYTES} byte limit.` }],
            isError: true,
            details: {},
          };
        }
        const cast = parseCastText(txt);
        const fmt = params.format ?? "summary";
        const strip = params.strip_ansi ?? true;
        const timeRange = params.time_range as [number, number] | undefined;
        const eventTypes = params.event_types as ("o" | "i" | "m" | "x")[] | undefined;
        const maxChars = params.max_chars ?? 40000;
        const includeTiming = params.include_timing ?? true;
        let body: string;
        if (fmt === "summary") body = buildSummary(cast);
        else if (fmt === "events")
          body = renderEvents(cast, { stripAnsi: strip, timeRange, eventTypes, offset: params.offset, limit: params.limit });
        else body = renderText(cast, { stripAnsi: strip, includeTiming, timeRange, eventTypes, offset: params.offset, limit: params.limit });
        const { text } = applyBounds(body, maxChars);
        return { content: [{ type: "text", text }], isError: false, details: {} };
      } catch (e) {
        const msg = e instanceof CastParseError ? e.message : `cannot read ${params.path}: ${String((e as Error).message ?? e)}`;
        return { content: [{ type: "text", text: `cast_read error: ${msg}` }], isError: true, details: {} };
      }
    },
  });
}
