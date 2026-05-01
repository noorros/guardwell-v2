import { config } from "dotenv";
config({ path: ".env" });

// Short-circuit Upstash rate-limiting in tests — the integration suite
// hits a real Postgres but must NOT reach an external Redis. Matches the
// escape hatch defined in src/lib/ai/rateLimit.ts.
process.env.UPSTASH_DISABLE = "1";

// Force the Resend client into no-op mode for every test. `.env` carries
// a real RESEND_API_KEY for dev workflows; without this guard, every
// integration test that exercises an email path (invitations, bulk
// invites, onboarding drip, critical-breach alert, notification digest,
// credential renewal reminders) would burn live Resend quota and ship
// real emails to seeded test addresses. src/lib/email/send.ts:30-49
// returns a no-op success when RESEND_API_KEY is empty.
delete process.env.RESEND_API_KEY;

import { afterEach, beforeAll } from "vitest";
import { db } from "@/lib/db";

beforeAll(async () => {
  await db.$connect();
});

afterEach(async () => {
  await db.llmCall.deleteMany();
  await db.eventLog.deleteMany();
  // Evidence references PracticeUser — must be deleted before PracticeUser.
  await db.evidence.deleteMany();
  // Allergy module tables reference PracticeUser — must be deleted first.
  await db.allergyEquipmentCheck.deleteMany();
  await db.allergyDrill.deleteMany();
  await db.allergyCompetency.deleteMany();
  await db.allergyQuizAttempt.deleteMany();
  // DEA models reference Practice (via FK) and PracticeUser (no FK; just
  // userId scalars). Cascade-on-Practice handles cleanup, but explicit
  // deletes here keep test setup deterministic.
  await db.deaInventoryItem.deleteMany();
  await db.deaInventory.deleteMany();
  await db.deaOrderRecord.deleteMany();
  await db.deaDisposalRecord.deleteMany();
  await db.deaTheftLossReport.deleteMany();
  // CEU + reminder configs reference Credential (cascade) and
  // PracticeUser (no FK). Explicit deletes keep test setup deterministic.
  await db.ceuActivity.deleteMany();
  await db.credentialReminderConfig.deleteMany();
  // Credential.holder is now onDelete: Restrict (audit #21 IM-10) so
  // it must be deleted before PracticeUser. Practice -> Credential is
  // still Cascade, but tests typically delete PracticeUser explicitly
  // first, which now requires removing credentials by hand.
  await db.credential.deleteMany();
  // BAA tables reference Vendor (cascade) + Evidence (SetNull) +
  // Practice (cascade). Explicit deletes are safety-belt; child tokens
  // first, then parent BaaRequest rows.
  await db.baaAcceptanceToken.deleteMany();
  await db.baaRequest.deleteMany();
  // MACRA activity log references Practice (cascade); explicit delete keeps
  // test setup deterministic (parallels DEA / allergy / CEU patterns above).
  await db.macraActivityLog.deleteMany();
  // Audit #21 (HIPAA I-1): per-state AG notification rows reference both
  // Incident (cascade) and Practice (cascade); explicit delete keeps
  // test setup deterministic.
  await db.incidentStateAgNotification.deleteMany();
  // Concierge tables reference Practice (cascade) — explicit deletes for
  // deterministic test ordering. Messages first (FK on threadId), then threads.
  await db.conversationMessage.deleteMany();
  await db.conversationThread.deleteMany();
  // Phase 4 (Training depth): assignment rows + their child exclusions
  // reference TrainingCourse (Restrict) and Practice (Cascade). Exclusions
  // first (FK on assignmentId), then assignments. PolicyTrainingPrereq
  // also references TrainingCourse (Restrict) so wipe before any
  // course-touching tests bring in seed catalog rows.
  await db.assignmentExclusion.deleteMany();
  await db.trainingAssignment.deleteMany();
  await db.policyTrainingPrereq.deleteMany();
  // Phase 4 PR 6 (BYOV): VideoProgress rows reference Practice (Cascade)
  // and TrainingCourse (Cascade). Cascade-on-Practice handles cleanup,
  // but explicit deletes here mirror the other Phase 4 projections and
  // keep test setup deterministic.
  await db.videoProgress.deleteMany();
  // Audit consistency — explicit delete to match other Phase 4 projections.
  // Phase 4 PR 7 (Certificate): TrainingCompletion rows reference Practice
  // (Cascade). Cascade-on-Practice handles cleanup, but explicit deletes
  // here mirror the other Phase 4 projections and keep test setup deterministic.
  await db.trainingCompletion.deleteMany();
  await db.practiceUser.deleteMany();
  await db.complianceItem.deleteMany();
  await db.practiceFramework.deleteMany();
  await db.practice.deleteMany();
  await db.user.deleteMany();
  // Phase 7 PR 9: EmailSuppression has no FK relations, so it can be
  // wiped at any point. Placed here at the bottom for symmetry; leaks
  // from one test would otherwise let the next test's send path see
  // stale "suppressed" rows.
  await db.emailSuppression.deleteMany();
});
