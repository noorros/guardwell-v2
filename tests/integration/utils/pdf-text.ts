// tests/integration/utils/pdf-text.ts
//
// Helper to extract human-readable text from a react-pdf-generated buffer.
// React-PDF compresses content streams with FlateDecode and emits text
// inside hex-encoded `<…>` TJ operators (e.g. `[<484950> 100 <4141>] TJ`
// for "HIPAA"). This helper inflates streams + decodes the hex literals
// so test assertions can match substrings of the rendered body content
// (not just metadata, which is stored separately as UTF-16BE).

import { inflateSync } from "node:zlib";

export function extractInflatedText(buf: Uint8Array): string {
  const raw = Buffer.from(buf).toString("latin1");
  const decoded: string[] = [];

  // Find every "<<…/Filter /FlateDecode…>> stream\n…endstream" block and
  // try to inflate it. Some streams may not actually be deflated (e.g.
  // /Length 0); inflate failures are silently skipped.
  const streamRegex =
    /<<[^>]*\/Filter \/FlateDecode[^>]*>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRegex.exec(raw)) !== null) {
    const streamBody = m[1];
    if (!streamBody) continue;
    let inflated: string;
    try {
      inflated = inflateSync(Buffer.from(streamBody, "latin1")).toString(
        "latin1",
      );
    } catch {
      continue;
    }
    // Pull out every `<HEX>` hex literal and decode to ASCII. Skip non-
    // byte-aligned matches (UTF-16 metadata also appears as hex literals
    // elsewhere; for body text in content streams these are paired-hex
    // bytes). Concatenating just the decoded literals (and dropping the
    // intervening kerning numbers / TJ array structure) gives a flat
    // string we can grep with `.toMatch(/.../)`.
    const hexRegex = /<([0-9a-fA-F]+)>/g;
    let h: RegExpExecArray | null;
    while ((h = hexRegex.exec(inflated)) !== null) {
      const hex = h[1];
      if (!hex || hex.length % 2 !== 0) continue;
      let s = "";
      for (let i = 0; i < hex.length; i += 2) {
        s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      decoded.push(s);
    }
  }
  return decoded.join("");
}
