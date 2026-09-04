#!/usr/bin/env node
// Generate a large synthetic v2 cast (~5 MB) to prove max_chars/limit bounds.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outPath = resolve(process.env.OUT || ".tmp-big.cast");
const targetBytes = Number(process.env.BYTES || 5 * 1024 * 1024);
const chunk = "x".repeat(64 * 1024); // 64 KB payload per event
const lines = [JSON.stringify({ version: 2, width: 120, height: 40 })];
let t = 0;
let bytes = lines[0].length + 1;
while (bytes < targetBytes) {
  t += 0.1;
  lines.push(JSON.stringify([t, "o", chunk + "\r\n"]));
  bytes += lines[lines.length - 1].length + 1;
}
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`big cast written: ${outPath} (${lines.length - 1} events, ${bytes} bytes)`);
