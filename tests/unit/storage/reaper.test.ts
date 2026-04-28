// tests/unit/storage/reaper.test.ts
//
// Tests the pure reaper logic. Uses vitest mock for db + gcs.deleteFile.
// No real DB or GCS needed.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before importing the reaper
vi.mock("@/lib/db", () => ({
  db: {
    evidence: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/storage/gcs", () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/lib/db";
import { deleteFile } from "@/lib/storage/gcs";
import { runReaper } from "@/lib/storage/reaper";

const mockFindMany = vi.mocked(db.evidence.findMany);
const mockDelete = vi.mocked(db.evidence.delete);
const mockDeleteFile = vi.mocked(deleteFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runReaper", () => {
  it("deletes GCS objects and DB rows for evidence deleted > 30 days ago", async () => {
    const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValueOnce([
      { id: "ev-1", gcsKey: "practices/p1/CREDENTIAL/c1/abc-cert.pdf", deletedAt: staleDate },
      { id: "ev-2", gcsKey: "practices/p1/INCIDENT/i1/abc-report.pdf", deletedAt: staleDate },
    ] as never);
    mockDelete.mockResolvedValue({} as never);

    const result = await runReaper();

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteFile).toHaveBeenCalledWith("practices/p1/CREDENTIAL/c1/abc-cert.pdf");
    expect(mockDeleteFile).toHaveBeenCalledWith("practices/p1/INCIDENT/i1/abc-report.pdf");
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(result.purged).toBe(2);
    expect(result.errors).toBe(0);
  });

  it("returns purged: 0 when no stale evidence", async () => {
    mockFindMany.mockResolvedValueOnce([] as never);
    const result = await runReaper();
    expect(result.purged).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("counts GCS errors separately (does not abort remaining rows)", async () => {
    const staleDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    mockFindMany.mockResolvedValueOnce([
      { id: "ev-1", gcsKey: "key-1", deletedAt: staleDate },
      { id: "ev-2", gcsKey: "key-2", deletedAt: staleDate },
    ] as never);
    mockDeleteFile
      .mockRejectedValueOnce(new Error("GCS 403")) // first file fails
      .mockResolvedValueOnce(undefined);            // second succeeds
    mockDelete.mockResolvedValue({} as never);

    const result = await runReaper();

    // Row ev-2 was still deleted even though ev-1's GCS delete failed
    expect(result.purged).toBe(2);  // both DB rows deleted
    expect(result.errors).toBe(1);  // one GCS error logged
  });
});
