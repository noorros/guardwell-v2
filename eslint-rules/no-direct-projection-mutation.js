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
