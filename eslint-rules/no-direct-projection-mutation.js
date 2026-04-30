// Blocks db.<projectionTable>.create/update/upsert/delete outside the
// events module. Per ADR-0001, all projection mutations must go through
// appendEventAndApply().

const PROJECTION_TABLES = new Set([
  "complianceItem",
  "practiceFramework",
  "complianceScoreSnapshot",
  "practicePolicy",
  "trainingCompletion",
  "vendor",
  "credential",
  "practiceSraAssessment",
  "practiceSraAnswer",
  "incident",
  "practiceInvitation",
  "notification",
  "notificationPreference",
  "practiceComplianceProfile",
  "conversationThread",
  "conversationMessage",
  // Audit #9 (2026-04-29): allergy actions previously mutated these
  // tables directly, leaving the USP §21 inactivity rule with no event
  // chain. Bootstrap flows (sign-up, onboarding/create-practice) keep
  // using direct practiceUser writes — they're whitelisted below.
  "allergyCompetency",
  "practiceUser",
  // Audit #21 CR-1 (2026-04-30): the four allergy tables introduced /
  // event-projected by audit #15's edit + soft-delete work. Their
  // mutations belong in projection callbacks (drillEdit / drillDelete /
  // equipmentCheckEdit / equipmentCheckDelete + the quiz attempt /
  // answer projections); rule coverage was missed during the audit #15
  // ship. Adding here closes the regression door.
  "allergyDrill",
  "allergyEquipmentCheck",
  "allergyQuizAttempt",
  "allergyQuizAnswer",
  // Phase 4 (Training depth): assignments, exclusions, and policy
  // training prerequisites are all event-projected. TrainingCourse is
  // intentionally NOT in this set — it's reference data seeded directly
  // via scripts/seed-training.ts; the course-CRUD projections live in
  // src/lib/events/projections/ which is in ALLOWED_PATHS.
  "trainingAssignment",
  "assignmentExclusion",
  "policyTrainingPrereq",
]);

const MUTATING_METHODS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

const ALLOWED_PATHS = [
  "src/lib/events/",
  // Derivation engine (ADR-0001 evidence-driven compliance) runs inside
  // projection callbacks — it IS a projection helper, just colocated with
  // the derivation rule registry for discoverability.
  "src/lib/compliance/derivation/",
  "tests/",
  // Co-located test directories (e.g. src/lib/ai/__tests__/...).
  "__tests__/",
  // Seed scripts populate reference data + initial projection state
  // (e.g. activating a new framework for existing practices). They run
  // once during DB setup, not during app runtime — bypassing the event
  // system is by design.
  "scripts/",
  // Bootstrap flows that create the first PracticeUser (OWNER row) for
  // a practice. These run before the event system has any context to
  // emit against — no practiceId until the Practice itself is being
  // created in the same transaction. Promoting them to events would
  // require a chicken/egg "PRACTICE_CREATED then USER_BOOTSTRAPPED"
  // protocol that buys nothing — these paths only ever write the
  // OWNER's PracticeUser row, never others'.
  "src/app/onboarding/create-practice/",
  "src/app/(auth)/sign-up/",
];

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct Prisma mutations of projection tables. Use appendEventAndApply() instead (ADR-0001).",
    },
    schema: [],
    messages: {
      direct:
        "Projection table '{{table}}' must only be mutated via appendEventAndApply() per ADR-0001. Move this into a projection callback in src/lib/events/, or add a new event type if appropriate.",
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename?.() || "";
    if (ALLOWED_PATHS.some((p) => filename.replace(/\\/g, "/").includes(p))) {
      return {};
    }
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        const method = callee.property?.name;
        if (!MUTATING_METHODS.has(method)) return;

        const tableExpr = callee.object;
        if (tableExpr.type !== "MemberExpression") return;
        const tableName = tableExpr.property?.name;
        if (!PROJECTION_TABLES.has(tableName)) return;

        context.report({
          node,
          messageId: "direct",
          data: { table: tableName },
        });
      },
    };
  },
};
