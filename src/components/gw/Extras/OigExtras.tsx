// src/components/gw/Extras/OigExtras.tsx
//
// OIG Section G helpers:
//   - LeieLookupBookmark: deep links to the public LEIE database for the
//     practice's primary state plus the federal exclusion list. Click-out
//     to OIG.gov (we don't proxy or cache PII per the OIG terms).
//   - SevenElementsChecklist: the seven elements of an effective compliance
//     program from the OIG Compliance Program Guidance, with brief
//     explanations of what each looks like in a small practice.

"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

export function OigExtras({
  practicePrimaryState,
}: {
  practicePrimaryState: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <LeieLookupBookmark stateCode={practicePrimaryState} />
      <SevenElementsChecklist />
    </div>
  );
}

function LeieLookupBookmark({ stateCode }: { stateCode: string }) {
  // OIG.gov hosts the LEIE search; we deep-link there. The state Medicaid
  // exclusion list is a separate database per state — we only know the
  // canonical federal one + a couple of large-state medicaid lists where
  // the URL is stable.
  const stateMedicaidLinks: Record<string, { name: string; url: string }> = {
    CA: {
      name: "California Medi-Cal Suspended/Ineligible List",
      url: "https://files.medi-cal.ca.gov/pubsdoco/SandILanding.aspx",
    },
    TX: {
      name: "Texas HHSC OIG Exclusion Search",
      url: "https://oig.hhsc.texas.gov/exclusions",
    },
    NY: {
      name: "NY OMIG Exclusion List",
      url: "https://omig.ny.gov/medicaid-fraud/medicaid-exclusions",
    },
    FL: {
      name: "Florida Medicaid Sanction & Termination Search",
      url: "https://ahca.myflorida.com/medicaid",
    },
  };
  const stateLink = stateMedicaidLinks[stateCode];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">LEIE + state exclusion lookup</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Run monthly screening of every workforce member, contractor, and
            vendor with prescribing/billing involvement. OIG terms forbid
            us caching results — links open the canonical sources.
          </p>
        </div>
        <ul className="space-y-2 text-[11px]">
          <li>
            <a
              href="https://exclusions.oig.hhs.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              Federal LEIE search (HHS OIG)
            </a>
            <p className="text-muted-foreground">
              The canonical exclusion list. Search by name + DOB or NPI.
            </p>
          </li>
          <li>
            <a
              href="https://www.sam.gov/search"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              SAM.gov Entity Exclusions
            </a>
            <p className="text-muted-foreground">
              Federal contractor debarment list. Hit this in addition to LEIE
              for any vendor receiving federal-program reimbursement.
            </p>
          </li>
          {stateLink && (
            <li>
              <a
                href={stateLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                {stateLink.name}
              </a>
              <p className="text-muted-foreground">
                Your state Medicaid exclusion list. Required separately from
                the federal LEIE for any Medicaid-billing practice.
              </p>
            </li>
          )}
          {!stateLink && (
            <li className="rounded-md border bg-muted/30 p-2 text-muted-foreground">
              State Medicaid exclusion list URL for {stateCode} not yet
              bookmarked. Search &ldquo;{stateCode} medicaid exclusion list&rdquo;
              and verify the source is the state OIG/Medicaid agency.
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function SevenElementsChecklist() {
  const elements: Array<{ id: number; title: string; small: string }> = [
    {
      id: 1,
      title: "Written standards of conduct + policies",
      small:
        "Code of conduct + the OIG-suggested policies (claims accuracy, anti-kickback, billing).",
    },
    {
      id: 2,
      title: "Designated compliance officer + committee",
      small:
        "Solo/small practice can designate the owner as the officer; document the role.",
    },
    {
      id: 3,
      title: "Effective training + education",
      small:
        "Annual general training + role-specific (billing staff get specific anti-fraud + coding training).",
    },
    {
      id: 4,
      title: "Effective lines of communication",
      small:
        "Anonymous reporting channel + non-retaliation policy. Even a dedicated email works.",
    },
    {
      id: 5,
      title: "Internal monitoring + auditing",
      small:
        "Periodic claims review (random 5-10 charts/quarter), exclusion-list checks, billing-pattern review.",
    },
    {
      id: 6,
      title: "Discipline through well-publicized standards",
      small:
        "Written disciplinary policy + apply consistently. Document any corrective action taken.",
    },
    {
      id: 7,
      title: "Prompt response + corrective action",
      small:
        "Investigation procedure + documented outcomes for every report or finding.",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            OIG&apos;s 7 elements of an effective compliance program
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            From the OIG Compliance Program Guidance. Practice-size scaled
            interpretations for each.
          </p>
        </div>
        <ol className="space-y-1.5">
          {elements.map((el) => (
            <li key={el.id} className="rounded-md border p-2 text-[11px]">
              <p className="font-medium text-foreground">
                {el.id}. {el.title}
              </p>
              <p className="text-muted-foreground">{el.small}</p>
            </li>
          ))}
        </ol>
        <Badge variant="outline" className="text-[10px]">
          OIG CPG (2023 General Compliance)
        </Badge>
      </CardContent>
    </Card>
  );
}
