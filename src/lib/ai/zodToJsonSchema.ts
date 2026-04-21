// src/lib/ai/zodToJsonSchema.ts
//
// Minimal Zod -> JSON Schema for the shapes we use in prompt outputs.
// Covers: object, array, string, string.enum, string.email, number (int /
// nonnegative), boolean, optional, literal. Throw on anything else so the
// next prompt author gets a clear signal to extend this function.
//
// Zod 4 shape notes: `schema._def.type` is a lowercase string (e.g. "object",
// "array", "string"). String/number refinements live in `schema._def.checks`
// as objects with a `_zod.def.check` discriminator (e.g. "min_length",
// "max_length", "length_equals", "greater_than"). Enum values live on
// `schema._def.entries`.

import { z } from "zod";

type JsonSchema = Record<string, unknown>;

interface ZodDefLike {
  type: string;
  checks?: Array<{ _zod?: { def?: Record<string, unknown> } }>;
  element?: z.ZodTypeAny; // array element
  innerType?: z.ZodTypeAny; // optional inner
  entries?: Record<string, string | number>; // enum map
  values?: Array<string | number | boolean | null>; // literal values
  format?: string; // zod 4 native format flags on strings (email, url, ...)
}

export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  return convert(schema);
}

function convert(schema: z.ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def: ZodDefLike })._def;
  switch (def.type) {
    case "object": {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const child = value as z.ZodTypeAny;
        properties[key] = convert(child);
        if (!isOptional(child)) required.push(key);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
    case "array": {
      const inner = def.element as z.ZodTypeAny;
      return { type: "array", items: convert(inner) };
    }
    case "string": {
      const out: JsonSchema = { type: "string" };
      if (def.format === "email") out.format = "email";
      const checks = def.checks ?? [];
      for (const c of checks) {
        const cd = (c._zod?.def ?? {}) as Record<string, unknown>;
        const check = cd.check as string | undefined;
        if (check === "string_format" && cd.format === "email") out.format = "email";
        if (check === "min_length") out.minLength = cd.minimum as number;
        if (check === "max_length") out.maxLength = cd.maximum as number;
        if (check === "length_equals") {
          out.minLength = cd.length as number;
          out.maxLength = cd.length as number;
        }
      }
      return out;
    }
    case "enum": {
      const entries = def.entries ?? {};
      return { type: "string", enum: Object.values(entries) };
    }
    case "number": {
      const out: JsonSchema = { type: "number" };
      const checks = def.checks ?? [];
      for (const c of checks) {
        const cd = (c._zod?.def ?? {}) as Record<string, unknown>;
        const check = cd.check as string | undefined;
        if (check === "number_format" && cd.format === "safeint") out.type = "integer";
        if (check === "greater_than") {
          const v = cd.value as number;
          out.minimum = cd.inclusive ? v : v;
        }
        if (check === "less_than") {
          const v = cd.value as number;
          out.maximum = cd.inclusive ? v : v;
        }
      }
      return out;
    }
    case "boolean":
      return { type: "boolean" };
    case "optional":
      return convert(def.innerType as z.ZodTypeAny);
    case "literal": {
      const values = def.values ?? [];
      const first = values[0];
      return { type: typeof first, enum: values } as JsonSchema;
    }
    default:
      throw new Error(`zodToJsonSchema: unsupported Zod type ${def.type}`);
  }
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const def = (schema as unknown as { _def: ZodDefLike })._def;
  return def.type === "optional";
}
