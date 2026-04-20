// Singleton Prisma client. Use `import { db } from "@/lib/db"` everywhere.
//
// Direct mutations to projection tables (ComplianceItem, PracticeFramework,
// ComplianceScoreSnapshot, etc.) MUST go through src/lib/events/append.ts —
// see ADR-0001. The lint rule `no-direct-projection-mutation` enforces this
// in src/app/(dashboard)/.

import { PrismaClient } from "@prisma/client";

declare global {

  var __gwPrisma__: PrismaClient | undefined;
}

export const db: PrismaClient =
  globalThis.__gwPrisma__ ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__gwPrisma__ = db;
}
