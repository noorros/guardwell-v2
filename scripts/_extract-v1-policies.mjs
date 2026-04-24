// _extract-v1-policies.mjs
// One-shot extractor: parses v1 seed-policies.ts + seed-state-policies.ts
// and emits a normalized JSON catalog at _v1-policy-templates-export.json.
//
// Run: node scripts/_extract-v1-policies.mjs
//
// Approach: read raw source, parse template object literals via a small
// state machine (we own both source files so we know the shape: opening
// `{`, then key-value lines, terminated by `},`). The `content` field is
// always a backtick-quoted multi-line HTML string so we capture from the
// first ` to the matching closing `.

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V1_ROOT = "D:/GuardWell/guardwell/prisma";
const OUT_PATH = join(__dirname, "_v1-policy-templates-export.json");

// ──────────────────────────────────────────────────────────────────────
// Minimal HTML → Markdown converter sufficient for v1's policy markup
// (h2/h3/h4, p, ul/ol, li, strong, em, br). Tags are well-formed in
// the v1 source so we use a lenient regex pipeline rather than a full
// DOM parser.
// ──────────────────────────────────────────────────────────────────────
function htmlToMarkdown(html) {
  let s = html;

  // Normalize whitespace inside tags
  s = s.replace(/\r\n?/g, "\n");

  // Headings
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${stripTags(t).trim()}\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${stripTags(t).trim()}\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${stripTags(t).trim()}\n`);
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${stripTags(t).trim()}\n`);

  // Lists — convert ul/ol to markdown bullets/numbers. We do ol first so
  // the inner li conversion can reuse a marker.
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
    let n = 0;
    const items = inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, li) => {
      n += 1;
      return `\n${n}. ${stripTags(li).trim()}`;
    });
    return `\n${items.trim()}\n`;
  });
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
    const items = inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, li) => {
      return `\n- ${stripTags(li).trim()}`;
    });
    return `\n${items.trim()}\n`;
  });

  // Paragraphs
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${inlineFormat(t).trim()}\n`);

  // Line breaks
  s = s.replace(/<br\s*\/?>/gi, "\n");

  // Strong / em / b / i — preserve as markdown
  s = inlineFormat(s);

  // Decode common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&sect;/g, "§")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…");

  // Collapse 3+ blank lines into 2
  s = s.replace(/\n{3,}/g, "\n\n").trim();

  return s;
}

function inlineFormat(s) {
  return s
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${stripTags(t).trim()}**`)
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${stripTags(t).trim()}**`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${stripTags(t).trim()}*`)
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, t) => `*${stripTags(t).trim()}*`);
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}

// ──────────────────────────────────────────────────────────────────────
// Extract template object literals from a v1 seed file.
//
// Strategy: walk the source, find lines starting with `    {` at the
// top-level TEMPLATES array, then capture key-value lines until we hit
// the closing `  },`. The `content:` value is special — it's a backtick-
// quoted multi-line string so we capture across lines.
// ──────────────────────────────────────────────────────────────────────
function parseTemplates(source) {
  const out = [];
  const lines = source.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Look for start of a template object (4 spaces + `{`)
    if (!/^\s{2,4}\{\s*$/.test(line)) {
      i++;
      continue;
    }

    // Try to parse the next ~60 lines as a template body
    let body = "";
    let depth = 1;
    let j = i + 1;
    while (j < lines.length && depth > 0) {
      const l = lines[j];
      // Count braces but ignore those inside strings — for our case we
      // really only need to detect the closing `  },` line at base depth
      if (/^\s{2,4}\},?\s*$/.test(l) && depth === 1) {
        depth = 0;
        body += l + "\n";
        j++;
        break;
      }
      body += l + "\n";
      j++;
    }

    const parsed = parseTemplateBody(body);
    if (parsed) {
      out.push(parsed);
    }

    i = j;
  }

  return out;
}

function parseTemplateBody(body) {
  // Required fields: title (string), description (string), content
  // (backtick template literal), category (string), type (string).
  // Optional: isRequired, tags, audience, applicableCategories, stateCode.
  const titleMatch = body.match(/title:\s*"([^"]+)"/);
  const descMatch = body.match(/description:\s*"((?:[^"\\]|\\.)*)"/);
  const categoryMatch = body.match(/category:\s*"([^"]+)"/);
  const typeMatch = body.match(/type:\s*"([^"]+)"/);
  const requiredMatch = body.match(/isRequired:\s*(true|false)/);
  const audienceMatch = body.match(/audience:\s*"([^"]+)"/);
  const stateMatch = body.match(/stateCode:\s*(?:"([^"]+)"|null)/);
  const tagsMatch = body.match(/tags:\s*\[([\s\S]*?)\]/);
  const applicableMatch = body.match(/applicableCategories:\s*\[([\s\S]*?)\]/);

  // Content is between the first ` and matching closing ` on a content: line
  const contentStart = body.indexOf("content:");
  let content = null;
  if (contentStart >= 0) {
    const tickStart = body.indexOf("`", contentStart);
    if (tickStart >= 0) {
      const tickEnd = body.indexOf("`", tickStart + 1);
      if (tickEnd > tickStart) {
        content = body.slice(tickStart + 1, tickEnd);
      }
    }
  }

  if (!titleMatch || !categoryMatch || !typeMatch || content == null) {
    return null;
  }

  const tags = tagsMatch
    ? Array.from(tagsMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
    : [];
  const applicableCategories = applicableMatch
    ? Array.from(applicableMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
    : [];

  return {
    title: titleMatch[1],
    description: descMatch ? descMatch[1].replace(/\\"/g, '"') : "",
    category: categoryMatch[1],
    type: typeMatch[1],
    isRequired: requiredMatch ? requiredMatch[1] === "true" : false,
    audience: audienceMatch ? audienceMatch[1] : "ALL_STAFF",
    stateCode: stateMatch ? (stateMatch[1] || null) : null,
    tags,
    applicableCategories,
    contentHtml: content,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Map v1 (category, type, stateCode, title) → v2 normalized fields:
//   - framework (single string: HIPAA / OSHA / OIG / CMS / DEA / CLIA /
//     MACRA / TCPA / GENERAL — we can't manufacture frameworks the v1
//     templates don't have, so we infer from `type` + tags)
//   - code (UNIQUE identifier)
//   - applicableTo (object, null if universal)
// ──────────────────────────────────────────────────────────────────────

function inferFramework(t) {
  // Primary signal: `type` field
  if (t.type === "HIPAA") return "HIPAA";
  if (t.type === "OSHA") return "OSHA";

  // Fall back to tags for state-specific GENERAL templates
  const tagSet = new Set(t.tags);
  if (tagSet.has("dea") || tagSet.has("controlled-substances")) return "DEA";
  if (tagSet.has("ai")) return "GENERAL";
  if (tagSet.has("hipaa")) return "HIPAA";
  if (tagSet.has("osha")) return "OSHA";

  // For state overlays, use HIPAA when category is PRIVACY/SECURITY/BREACH
  if (["PRIVACY", "SECURITY", "BREACH_NOTIFICATION"].includes(t.category)) {
    return "HIPAA";
  }
  if (["BLOODBORNE_PATHOGEN", "HAZARD_COMMUNICATION", "EMERGENCY_ACTION", "WORKPLACE_SAFETY"].includes(t.category)) {
    return "OSHA";
  }
  return "GENERAL";
}

function makeCode(t, framework) {
  // Build a stable, screaming-snake unique code from the title.
  // Strip parentheticals, collapse non-alphanum to underscore.
  let base = t.title
    .replace(/\([^)]*\)/g, "")           // remove parentheticals
    .replace(/&/g, "and")
    .replace(/[§]/g, "sec")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  // Strip trailing _POLICY only when the framework prefix would otherwise
  // be missing — keep semantic words like _ACT, _PROGRAM, _PLAN, etc.
  // Trim "_POLICY_FOR_..." → "_..."

  // Prepend framework if not already present
  const prefix = `${framework}_`;
  if (!base.startsWith(prefix)) {
    base = prefix + base;
  }

  // Suffix state code if set
  if (t.stateCode) {
    base = base + "_" + t.stateCode;
  }

  // Cap length to keep DB-friendly (most v2 codes are < 80 chars)
  if (base.length > 96) base = base.substring(0, 96).replace(/_+$/, "");

  return base;
}

function makeApplicableTo(t) {
  const out = {};
  if (t.stateCode) {
    out.state = t.stateCode;
  }

  // Specialty inference from tags
  const tagSet = new Set(t.tags);
  if (tagSet.has("dental")) out.specialty = "DENTAL";
  else if (tagSet.has("chiropractic")) out.specialty = "CHIROPRACTIC";
  else if (tagSet.has("pediatric")) out.specialty = "PEDIATRIC";
  else if (tagSet.has("mental-health") && t.title.toLowerCase().includes("mental")) {
    out.specialty = "MENTAL_HEALTH";
  } else if (tagSet.has("allergy") || tagSet.has("immunotherapy")) {
    out.specialty = "ALLERGY_IMMUNOLOGY";
  } else if (tagSet.has("substance-abuse")) {
    out.specialty = "BEHAVIORAL_HEALTH";
  }

  return Object.keys(out).length ? out : null;
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

const polSource = readFileSync(join(V1_ROOT, "seed-policies.ts"), "utf8");
const stateSource = readFileSync(join(V1_ROOT, "seed-state-policies.ts"), "utf8");

const corePolicies = parseTemplates(polSource);
const statePolicies = parseTemplates(stateSource);

console.log(`Parsed ${corePolicies.length} core templates from seed-policies.ts`);
console.log(`Parsed ${statePolicies.length} state templates from seed-state-policies.ts`);

// Combine
const allRaw = [...corePolicies, ...statePolicies];

// Filter: skip templates with content body < 500 chars (after html→md
// conversion since markdown is shorter).
const exported = [];
const skipped = [];
const seenCodes = new Set();
const seenTitles = new Set();

let sortOrder = 0;
for (const t of allRaw) {
  const bodyMarkdown = htmlToMarkdown(t.contentHtml);
  const length = bodyMarkdown.length;

  if (length < 500) {
    skipped.push({ title: t.title, reason: `body too short (${length} chars markdown)` });
    continue;
  }

  if (seenTitles.has(t.title)) {
    skipped.push({ title: t.title, reason: "duplicate title" });
    continue;
  }
  seenTitles.add(t.title);

  const framework = inferFramework(t);
  let code = makeCode(t, framework);

  // De-dupe codes by appending suffix
  let suffix = 2;
  while (seenCodes.has(code)) {
    code = `${makeCode(t, framework)}_V${suffix}`;
    suffix++;
  }
  seenCodes.add(code);

  exported.push({
    code,
    title: t.title,
    framework,
    description: t.description || "",
    bodyMarkdown,
    applicableTo: makeApplicableTo(t),
    sortOrder: sortOrder++,
  });
}

console.log(`\nExported ${exported.length} templates, skipped ${skipped.length}`);
console.log("\nFramework breakdown:");
const byFramework = {};
for (const e of exported) {
  byFramework[e.framework] = (byFramework[e.framework] || 0) + 1;
}
for (const [f, n] of Object.entries(byFramework).sort()) {
  console.log(`  ${f.padEnd(10)} ${n}`);
}

console.log("\nSkipped:");
for (const s of skipped) {
  console.log(`  - ${s.title}: ${s.reason}`);
}

writeFileSync(OUT_PATH, JSON.stringify(exported, null, 2), "utf8");
console.log(`\nWrote ${OUT_PATH}`);
