# ADR-0004: Modules as data, not code

**Status:** Accepted
**Date:** 2026-04-20
**Deciders:** Noorros, Engineering
**Related:** [ADR-0002 — Regulations × Operations matrix](0002-regulations-operations-matrix.md)

## Context

The healthcare regulatory landscape doesn't stop moving. v1 has 14 modules,
but the medium-term horizon already includes (at minimum):

- OSHA Workplace Violence Prevention for Healthcare (finalized 2024, not
  yet covered)
- FTC Health Breach Notification Rule
- HIPAA Security Rule NPRM finalization (will absorb/replace v1's
  "Proposed Security Rule Readiness")
- 21st Century Cures Act / Information Blocking
- HRSA 340B (specialty)
- DEA Suspicious Order Monitoring (specialty)
- State expansion: Colorado AI Act, NY SHIELD, FL/TX/VA privacy laws,
  anti-trafficking signage, mental health parity, etc.

In v1 every module is a hardcoded folder under `src/app/(dashboard)/{module}/`
with its own checklist UI, its own scoring weight in `compliance.ts`, its
own seed file. Adding a module = code change + deploy. The architecture
pushes against the regulatory landscape's flux.

## Decision

**Regulations are rows, not folders.** A new regulation = INSERT into
`RegulatoryFramework` + N rows in `RegulatoryRequirement`. The
"My Compliance > [Regulation]" page renders dynamically from the data.

Concretely:

- `RegulatoryFramework`: id, code (`HIPAA`), name, citation, jurisdiction
  (federal | state-{XX}), effectiveAt, supersededAt, weightDefault,
  scoringFn (key into a small registry of scoring strategies — most
  regulations use `STANDARD_CHECKLIST`).
- `RegulatoryRequirement`: id, frameworkId, code, title, citation,
  description, evidenceTypeIds[], severity, isOptional, jurisdictionFilter
  (which states it applies to, if any).
- `EvidenceType`: id, code (`POLICY`, `TRAINING`, `INCIDENT_LOG`,
  `ATTESTATION`, `CREDENTIAL`, `BAA`, `SRA_ANSWER`, `DESTRUCTION_LOG`,
  `DRILL_LOG`, `INSPECTION`), name, programRoute (which "My Programs"
  page handles producing this evidence).
- `ComplianceItem`: per-practice, per-requirement row with current state.
  Created lazily when a practice activates the regulation. Replaces v1's
  `PracticePolicy` with prefixed titles, OIG `complianceReport`, etc.

Modules at v2 launch = the same 14 from v1, but as data. Adding OSHA WPV
post-launch becomes: write a seed migration, ship. No code.

## Consequences

### Easier
- New regulation = data, ships in hours not weeks.
- Multi-state expansion is structurally trivial (states are
  jurisdictionFilter values).
- The matrix view ([ADR-0002](0002-regulations-operations-matrix.md))
  works because all data lives in unified tables.

### Harder
- Regulation-specific UX (e.g., the SRA wizard, the breach 4-factor
  scoring) doesn't fit the generic checklist render. Solution:
  `scoringFn` and `customRoute` fields let specific regulations opt
  into custom UI when needed. Default is generic.
- Schema migrations for new regulatory fields require thought. Solution:
  `RegulatoryRequirement.metadata` is a typed JSON column for
  framework-specific extras (e.g., DEA Schedule level, OSHA recordable
  type).

### Revisit
- After 30+ frameworks: consider moving the registry out of the same
  Postgres into a content management system if marketing wants
  non-engineers to author regulations.

## Action items

- [ ] Schema models: `RegulatoryFramework`, `RegulatoryRequirement`,
  `EvidenceType`, `ComplianceItem`
- [ ] Seed file: `prisma/seed-regulations.ts` for the 14 launch
  frameworks (port content from v1)
- [ ] `src/lib/compliance/render.ts` — generic checklist renderer driven
  by framework + requirements
- [ ] `src/lib/compliance/scoring-registry.ts` — pluggable scoring
  strategies (`STANDARD_CHECKLIST`, `SRA_WEIGHTED`, `BREACH_WIZARD`,
  `MIPS_COMPOSITE`)
