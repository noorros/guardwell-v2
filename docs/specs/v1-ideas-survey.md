---
title: V1 → V2 Ideas Survey
status: Reference (not normative)
owners: Engineering + Noorros (product)
date: 2026-04-23
related:
  - docs/specs/module-page-contract.md
  - memory/v2-rebuild-strategy.md
  - memory/v2-deferred-roadmap.md
---

# V1 → V2 Ideas Survey

**Status:** Reference. Not a commitment to ship anything below — this is a structured walk-through of v1 surfaces, calling out what's worth porting, what to redesign, and what to consciously leave behind.

**Source survey:** `D:/GuardWell/guardwell/src/app/(dashboard)` plus a sampling of supporting `lib/` and component files. V1 has 35 dashboard subdirs; v2 has 6 (audit · dashboard · modules · programs · settings · onboarding). Most of v1's surface area gets folded into v2's narrower nav, but several surfaces are net-new ideas worth flagging.

**How to read this:**
- **Net-new surfaces** — things v1 has that v2 doesn't, with a verdict (port / redesign / drop)
- **Per-framework helpers** — concrete ideas that could become Section G Extras enhancements
- **Cross-cutting patterns** — UX or architectural patterns worth adopting before launch
- **Explicitly NOT recommended** — v1 features that should stay out of v2 (with reasoning)

Each entry includes a **priority** tag: `[high]` `[medium]` `[low]` reflecting impact-on-launch + effort.

---

## 1. Net-new surfaces (v1 has, v2 doesn't)

### 1.1 Audit Prep wizard `[high]`
**V1 surface:** `(dashboard)/audit-prep/` — multi-step session-based pre-audit wizard backed by `AuditPrepSession` table. Modes for HHS OCR audit, OSHA inspection, etc. Walks the user through a checklist, gathers evidence, generates a packet.

**Why it matters:** This is the **single highest-customer-perceived-value surface in v1**. "What do I do when I get the audit letter?" is the user's panic moment; v1 turns it into a guided 30-minute session. Customers reference this in support tickets.

**V2 design:**
- Single `/audit-prep` route, lists past sessions
- `/audit-prep/[id]` shows the active session with sections per audit type:
  - **HHS OCR HIPAA Audit** — 6-protocol checklist mirroring the Phase 2 audit protocol
  - **OSHA Inspection** — 300A posted, written programs, training records
  - **CMS Site Visit** — incident-to logs, signature compliance, PT/INR QC if relevant
  - **DEA Inspection** — biennial inventory, current Form 222 sequences, theft/loss reports
- Each section pulls live evidence from existing tables (PracticePolicy, TrainingCompletion, Incident, etc.) — no manual upload step
- Final action: "Download audit packet" (a multi-section PDF)
- Storage: extend the existing event-sourcing model — `AUDIT_PREP_SESSION_OPENED`, `_STEP_COMPLETED`, `_PACKET_GENERATED`. No new mutable table needed beyond a thin `AuditPrepSession` row keyed off the first event.

**Effort:** ~1.5 weeks (1 wk infrastructure + 0.5 wk for first 2 audit-type protocols).

**Priority:** `[high]` — this is the surface customers tell other customers about. Leaving it for v2.1 is a marketing-narrative gap.

---

### 1.2 Compliance Track / Roadmap `[high]`
**V1 surface:** `(dashboard)/track/` + `lib/track-generator.ts` — auto-generated, dated milestone-based roadmap for the practice's first 90 days. Pulls from `ComplianceTrack → ComplianceTrackMilestone → ComplianceTrackTask`. Each milestone has a target week, each task has a `done` boolean.

**Why it matters:** New customers don't know where to start. The track answers "what do I do this week?" without forcing them to scroll through 14 module pages. V1's track also drives the dashboard's "Up next" card.

**V2 design:**
- Single `/track` page (under My Programs nav, or as top-level "Get started")
- Auto-generated on practice creation from a template keyed by `specialtyCategory` + `providerCount`
- Milestones bucket into weeks 1, 2, 4, 8, 12 (slower than v1's weekly cadence — small practices burn out on weekly)
- Tasks link to the surface that completes them ("Designate Privacy Officer" → /programs/staff)
- Score ring at the top showing "% of track complete" for narrative momentum
- Once track hits 100% complete, surface is collapsed by default; user can re-open or generate a new "second-quarter" track focused on continuous-monitoring tasks

**V2 schema delta:**
```prisma
model PracticeTrack {
  practiceId         String   @id
  templateCode       String   // "GENERAL_PRIMARY_CARE", "DENTAL", "BEHAVIORAL", etc.
  generatedAt        DateTime @default(now())
  completedAt        DateTime?
}
model PracticeTrackTask {
  id              String   @id @default(cuid())
  trackPracticeId String
  weekTarget      Int      // 1, 2, 4, 8, 12
  title           String
  description     String
  href            String   // route to the surface that completes it
  completedAt     DateTime?
  completedByUserId String?
  // Optional auto-derivation: if requirementId is set, this task auto-completes
  // when the matching ComplianceItem flips to COMPLIANT.
  requirementCode String?
}
```

**Effort:** ~1 week (template seed + page + auto-completion derivation).

**Priority:** `[high]` — directly addresses the v1-audit-noted "users land on a blank dashboard and don't know what to do" problem.

---

### 1.3 Document Retention + Destruction Log `[medium]`
**V1 surface:** `(dashboard)/document-retention/` — `DestructionLog` table tracks records destroyed (date, type, who performed, witnessed by). HIPAA, state medical records retention, and FACTA all require destruction documentation.

**V2 design:**
- New surface at `/programs/document-retention` (or fold into Vendors as "Records Destruction")
- Two tables: `DestructionLog` (per destruction event) + `RetentionAttestation` (annual certification by the Privacy Officer that the retention policy is being followed)
- Form fields: date of destruction, document type (medical records, billing, payroll, etc.), method (shredding / secure wipe / deidentification), volume estimate, performed-by, witnessed-by, certificate-of-destruction file (vendor-issued)
- Pre-fills derivation: ties to HIPAA_DOCUMENTATION_RETENTION (a new requirement to add) — without ≥1 destruction-log entry per year, the requirement falls to GAP
- State overlay potential: GA, NC, FL each have multi-year retention rules with destruction-method specifics (FL specifically requires medical records be retained as paper unless original was electronic)

**Effort:** ~3 days (single CRUD surface + 1 derivation rule).

**Priority:** `[medium]` — important for compliance completeness but not a launch-blocker. Customers in the "let me go to audit" phase need it; new customers don't immediately ask for it.

---

### 1.4 Staff Handbook generator `[medium]`
**V1 surface:** `(dashboard)/handbook/` — generates a practice-specific employee handbook from a template + practice metadata (officer names, hours, location). Includes HIPAA acknowledgment, harassment policy, OSHA/safety rules, code of conduct.

**Why it matters:** Every new hire needs a handbook acknowledgment. V1's auto-generates the doc with the practice's officer names already filled in.

**V2 design:**
- Reuse the existing `PracticePolicy` model — add a `HANDBOOK` policyCode
- Handbook has more sections than other policies (usually 20+ pages); template lives in `src/lib/policies/handbook.ts` with section-level config
- Section config: `[{ id: "HIPAA_ACK", title: "HIPAA Privacy Acknowledgment", source: "POLICY:HIPAA_NPP_POLICY" | "TEMPLATE:hipaa_ack_v1", required: true }]`
- "Generate handbook PDF" action assembles all sections, writes to `@react-pdf/renderer`, downloads
- Integrates with existing TrainingCompletion: handbook acknowledgment becomes a 1-question "course" so the existing 95% workforce coverage rule applies

**Effort:** ~1 week (template authoring + PDF generation + new policyCode + acknowledgment-as-training plumbing).

**Priority:** `[medium]` — bigger differentiator for practices hiring frequently. Solo practices won't notice if it's missing.

---

### 1.5 Compliance Assignments / Tasks `[medium]`
**V1 surface:** `(dashboard)/assignments/` — central inbox of "things this user needs to do" pulled from across modules. Owner can assign tasks to specific staff members; the recipient sees them in their assignments page.

**Why it matters:** Owners want to delegate. "Designate a Security Officer" is theoretically doable by anyone in the practice; in practice the owner needs to ask a specific person and have it tracked.

**V2 design:**
- Reuse the existing event log + a new event type `ASSIGNMENT_CREATED({ assignedToUserId, sourceRequirementCode, deadline })` and `ASSIGNMENT_COMPLETED({ assignmentId })`
- Page at `/programs/assignments` shows three lists: "My open" / "My completed" / "Practice-wide open" (admin only)
- The "Assign to a teammate" action lives on every requirement row (in ChecklistItem) for users with `role >= STAFF`
- Auto-clears when the source requirement flips to COMPLIANT via any route
- Optional: notification trigger when an assignment is created or its deadline passes

**Effort:** ~5 days (events + projection + 1 new page + ChecklistItem button).

**Priority:** `[medium]` — useful for 5+ staff practices; solo owners get no value. Defer until a multi-staff customer asks.

---

### 1.6 Knowledge Base / In-app Help `[low]`
**V1 surface:** `(dashboard)/help/` — slug-based KB articles, search, role-filtered visibility, feedback collection per article. ~80 articles seeded.

**Why it matters:** Reduces support load. Lets the product educate customers without a sync conversation.

**V2 design:**
- **Defer for v2.1.** Pre-launch we have no content + no support volume.
- When ready: reuse the existing AI Concierge as the front door (`/help` becomes a simple list with "ask the concierge"); RAG-load the articles into the concierge's context window per ADR-0003

**Priority:** `[low]` — pure cost without a customer base. Revisit at ~50 customers.

---

### 1.7 Allergy module `[low]`
**V1 surface:** `(dashboard)/allergy/` + `Practice.allergyModuleEnabled` flag. Niche allergy/immunology specialty addon (epinephrine inventory, anaphylaxis protocol, biologic intake forms).

**V2 design:**
- **Drop unless an allergy practice signs up.** It's a specialty addon, not foundational. The modules-as-data architecture means we can ship it post-launch as a single INSERT + a small ExtrasComponent.
- If a customer asks: ~3 days of work — new RegulatoryFramework row + 5 requirements + an Extras card with epinephrine expiration tracking.

**Priority:** `[low]` — wait for demand.

---

### 1.8 Network map / asset inventory `[medium]`
**V1 surface:** `(dashboard)/security/assets/` (technology asset inventory) + `(dashboard)/security/network-map/` (data-flow + system diagram). Tied to HIPAA Security Rule §164.310 + §164.312.

**Why it matters:** SRA requires identifying all systems that store/transmit ePHI. V1's asset inventory is a structured table; the network map is a more visual data-flow diagram.

**V2 design:**
- Asset inventory ships as a standard CRUD surface at `/programs/security-assets`
- Schema: `TechAsset { id, practiceId, name, type (SERVER | LAPTOP | DESKTOP | MOBILE | EMR | NETWORK_DEVICE | ...), processesPhi: bool, encryption: enum, vendor, location, owner }`
- Skip the visual network map for v2 launch — replace with a printable "data flow narrative" auto-generated from the asset inventory (plain prose: "PHI flows from {EMR} to {clearinghouse} via {VPN}")
- Wire into HIPAA_SRA derivation: SRA can't be COMPLIANT without ≥1 asset that processes PHI

**Effort:** ~4 days (asset CRUD + SRA wiring; skip visual map).

**Priority:** `[medium]` — paired with SRA, makes the SRA more substantive. SRA without it is "trust me" attestation.

---

### 1.9 Internal admin dashboard `[high — but post-launch]`
**V1 surface:** `(dashboard)/admin/` — Noorros-only surface. Customer health scoring, lead intake, waitlist management, regulatory-update authoring, internal docs.

**V2 design:**
- This is **not** a customer surface. Build at v2.app.gwcomp.com/admin gated by a `User.isPlatformAdmin` boolean.
- For launch the ABSOLUTE minimum:
  - Practice list (search by name/email, view subscription status)
  - Customer health snapshot (computed from event log: "last login", "score trend", "open critical gaps")
  - Manual subscription override ("grant 30-day free extension" for support)
- Defer: lead intake, waitlist, regulatory-update authoring (use Stripe + Notion for now)

**Priority:** `[high]` post-launch operational need; `[low]` for the launch itself.

---

### 1.10 Reports surface `[medium]`
**V1 surface:** `(dashboard)/reports/` — predefined PDF reports beyond just the audit packet (training summary, incident summary, vendor list, credentials list).

**V2 status:** Partial — `/api/audit/compliance-report` ships the cross-framework PDF.

**V2 design:**
- Build `/audit/reports` as a list of report types with "Generate" CTAs:
  - Compliance overview (already shipped)
  - Training summary (per-staff completion grid + expirations)
  - Incident summary (table by status + breach determinations)
  - Vendor + BAA register
  - Credentials register (license + DEA + insurance, by holder)
  - Annual P&P review attestation
- Each generates via `@react-pdf/renderer` server-side; user clicks → download
- Send to printer-friendly format with the practice header repeated on every page

**Effort:** ~2 days per report after the first; first one is the layout primitive.

**Priority:** `[medium]` — every report is "I need this for my survey/audit." Ship them as customers ask.

---

## 2. Per-framework helpers (Section G Extras enhancements)

### 2.1 HIPAA
- **NPP version diff viewer.** When a user adopts a new NPP, surface what changed since the last adopted version side-by-side. Reuses the existing `PracticePolicy.version` field.
- **Auto-acknowledgment-bulk for staff.** "Send all active staff a re-acknowledgment request for the new NPP" — generates one notification + one event per staff member. Solves the v1 H9 bulk-policy-ack issue cleanly.
- **AI policy drafting.** Replace the hidden v1 AI assess button with a generative one: "Write a NPP for {practice} given {state} + {specialty} + {patient population}." Pre-fills the editable template before adoption.

### 2.2 OSHA
- **Bloodborne Pathogens Exposure Control Plan template.** §1910.1030 requires a written ECP reviewed annually. V1 has a template; v2 has nothing yet. Add as an OSHA Extras card alongside Form 300A.
- **Hazard Communication binder builder.** GHS chemical labels + SDS list builder. Similar to the OSHA posting checklist but actionable.
- **OSHA 300 log generator.** Shipped Form 300A worksheet uses incident counts; the log itself (Form 300) can be auto-generated from `Incident WHERE type = 'OSHA_RECORDABLE' AND date_recorded(year)`.

### 2.3 OIG
- **CSV upload exclusion screening.** Upload a CSV of staff (name + DOB or NPI) → batch screen against LEIE, return a results CSV. Saves the practice from running 12 manual searches.
- **Effective Compliance Plan template.** Pre-built Code of Conduct + Anti-Kickback policy + Compliance Officer designation form, customized with the practice's name/state.

### 2.4 CMS
- **Patient access right-of-records request log.** §164.524 requires a 30-day response; the practice should track when a request came in vs. when it was fulfilled. Connects to the AUDIT_PREP wizard.
- **Incident-to billing checklist.** Per-encounter checklist the auxiliary fills out at point-of-care. PDF download for the staff binder.

### 2.5 DEA
- **DEA Form 222 sequence tracker.** Schedule II orders use sequentially-numbered Form 222 (or eRx for practices on CSOS). Track which sequence numbers have been used.
- **Theft/loss reporting wizard.** When a DEA_THEFT_LOSS incident is reported, walk through DEA Form 106 prep + state board notification requirements.

### 2.6 CLIA
- **Proficiency testing calendar.** Per-analyte category PT events (3× year for moderate/high complexity; not required for waived). Scheduled events with "PT enrolled" attestation.
- **Personnel competency assessment template.** §493.1235 requires 6-month + annual competency assessments documented per testing personnel; v1 has a template, v2 should port.

### 2.7 MACRA / MIPS
- **eCQM / ACI submission readiness checker.** Walk through "do you have a CEHRT-certified EHR?", "is your data complete enough to submit?", "are you on track for the 75-point performance threshold?"
- **Specialty measure picker.** Help the user pick their 6 quality measures from their specialty set (drives a smaller, more targeted Quality submission).

### 2.8 TCPA
- **Quiet hours calendar.** Surface the federal quiet-hours rule (8 AM – 9 PM recipient local time). Visualize when a scheduled SMS campaign would violate.
- **Manual revocation log.** When a patient verbally revokes consent, log it here so it gets honored alongside the automated STOP keyword.

---

## 3. Cross-cutting patterns worth adopting

### 3.1 The "blocking redirect" pattern in onboarding `[in v2 already]`
V1 redirects the user to `/onboarding` until `Practice.onboardingDone === true`. V2 does the equivalent with the compliance-profile redirect (PR #82). Already shipped — flagged here for completeness.

### 3.2 Per-page role gates `[partially in v2]`
V1 routinely checks `requireRole("ADMIN")` at the top of server pages. V2 is more permissive — most pages just call `getPracticeUser()`. **Recommendation:** add `requireRole` for write-heavy surfaces (audit-prep when it ships, admin surface, document-retention) so VIEWER role can't even land on the page.

### 3.3 "Practice-wide" vs "personal" inbox split `[v1 pattern, v2 should adopt]`
V1's assignments + notifications page splits "things assigned to me" from "things across the practice." V2's notification bell only shows the user's own. When assignments lands, mirror this split — it's how multi-staff practices actually work.

### 3.4 Auto-derivation from configuration `[in v2 already, expand]`
V1's `lib/track-generator.ts` derives a track from `Practice.specialty`. V2's compliance profile auto-enables/disables frameworks. **Expand to:** auto-seed `PracticeTrackTask` rows on practice creation; auto-tag NPP template per `Practice.primaryState`; auto-generate the data-flow narrative from `TechAsset` rows.

### 3.5 "Last reviewed" timestamps on policies `[v1, port to v2]`
V1's `PracticePolicy` has a `lastReviewedAt` that the Privacy Officer touches annually. Triggers a "Review due in N days" reminder. V2's PracticePolicy has `adoptedAt` and `retiredAt` only. Add `lastReviewedAt` + a 365-day rolling window, surface in the policies program page + as a notification rule. **Effort:** ~2 days.

### 3.6 Activity-log "explain this" tooltip `[v1, redesign in v2]`
V1's activity log has a tooltip explaining what each event means in plain English. V2 has the formatter but no tooltip yet. **Recommend:** add a small `InfoButton` next to each event that opens a popover with "What this means" + a link to the relevant module.

### 3.7 Inline AI suggestions on requirement rows `[v1, port + redesign in v2]`
V1 had per-row AI suggestions for some requirements ("Click here to draft this policy"). V2's AI is concierge-only (drawer). Consider adding a per-row "✦ Draft this with AI" link for any requirement whose evidence type has a known template generator (POLICY:* mostly).

### 3.8 The "score trend" line `[v1, port to v2]`
V1's dashboard had a 30-day score trend sparkline showing whether compliance was trending up or down. V2 has snapshots in `ComplianceScoreSnapshot` already; just add a sparkline to the audit overview. **Effort:** ~half day.

---

## 4. Explicitly NOT recommended (v1 features to stay out of v2)

### 4.1 Tier-based plans
V1 had STARTER / PRO / ENTERPRISE tiers. V2 is single-tier per `v2-decisions-locked.md`. Don't reintroduce.

### 4.2 BYOV (Bring Your Own Vendor)
V1 had a workflow where customers uploaded their own vendor BAAs. V2 deferred this to v2.1+ per `v2-deferred-roadmap.md`. The vendor list + BAA tracking is enough for launch.

### 4.3 AI-tailored training
V1 generated per-staff training based on past quiz answers. V2 deferred per `v2-deferred-roadmap.md`. The static course library + 95% completion threshold is enough.

### 4.4 Vendor signing workflow (DocuSign-style)
V1 had a feature where the practice could send a BAA to a vendor for signature in-product. V2 deferred. Practices use the vendor's BAA process; we just track the executed date.

### 4.5 Daily cron-driven email blasts
V1 sent daily emails for any pending action. V2 ships weekly digest + critical-only inline alerts (per the rebuild strategy memo). Don't backslide to daily noise.

### 4.6 Module-by-module navigation as primary IA
V1's sidebar listed every framework as a top-level link. V2 split into "My Compliance" + "My Programs" + "Audit & Insights" per ADR-0002. Don't flatten back.

### 4.7 The 60+ Prisma models
V1 had ~60 models including per-framework lookup tables, per-state lookup tables, hardcoded module fixtures. V2's `RegulatoryFramework × RegulatoryRequirement × ComplianceItem` plus jurisdiction filter replaces ~40 of those. Don't add per-module tables to v2 unless the model is genuinely framework-specific (the way `Incident` is HIPAA + OSHA dual-purpose).

### 4.8 In-product BAA / DPA acceptance flow
V1 had a BAA + DPA acceptance flow during signup. V2 punts to a static page (per `(auth)` routing) — sign once, kept as `LegalAcceptance` row. No re-prompt unless the document version bumps.

---

## Recommended sequencing for the remaining launch budget

Given v2 is materially ahead of the 16-week plan and the user's biggest leverage is **what convinces a prospect to buy + start using v2**, the rough order I'd ship the above in (assuming the user can keep merging at the current pace):

1. **Track / Roadmap** (§1.2) — solves the "blank dashboard" problem
2. **Audit Prep wizard** (§1.1) — the headline-feature differentiator
3. **Per-framework Extras enhancements** (§2) — low-effort, high-customer-perceived-completeness; ship 1-2 per session
4. **Asset inventory + SRA wiring** (§1.8) — makes the SRA actually substantive
5. **Reports surface** (§1.10) — minimum viable: training summary + incident summary
6. **Document retention** (§1.3) — needed before customers start hitting their first state board complaint
7. **Internal admin dashboard** (§1.9) — needed the moment we have customers to support
8. **Handbook generator** (§1.4) — as soon as a multi-staff practice asks
9. **Assignments** (§1.5) — same trigger
10. **Knowledge base** (§1.6) — wait until 50+ customers
11. **Allergy module** (§1.7) — only on demand
