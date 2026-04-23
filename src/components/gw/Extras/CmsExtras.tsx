// src/components/gw/Extras/CmsExtras.tsx
//
// CMS Section G helpers:
//   - CmsConditionsQuickRef: the high-frequency CoP standards an outpatient
//     practice trips on (NCD/LCD adherence, documentation, supervision,
//     incident-to billing).
//   - PtaCalculator: Quality Payment Program eligibility quick-check —
//     the low-volume threshold below which a clinician is exempt from MIPS.

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function CmsExtras() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CmsConditionsQuickRef />
      <LowVolumeThresholdCheck />
    </div>
  );
}

function CmsConditionsQuickRef() {
  const items: Array<{ topic: string; rule: string }> = [
    {
      topic: "Incident-to billing",
      rule: "Physician must initiate the plan of care, be in the suite (not necessarily the room) during the auxiliary's visit, and review/sign the documentation. Otherwise bill under the auxiliary's NPI at the appropriate fee schedule.",
    },
    {
      topic: "Signature requirements",
      rule: "Every entry needs a legible, dated, signed authentication. Stamp signatures alone are insufficient; e-sign with attribution metadata is fine.",
    },
    {
      topic: "Time-based codes",
      rule: "Document start + stop time OR total time spent. CPT prolonged-service codes require the patient time excluded from the base E/M.",
    },
    {
      topic: "Medical necessity (LCD/NCD)",
      rule: "Diagnosis code must support the procedure. ABNs required when you suspect Medicare won't cover (issued before service, signed by patient).",
    },
    {
      topic: "Telehealth POS + modifier",
      rule: "POS 02 (home) or 10 (originating site) + modifier 95 for synchronous video. Audio-only requires modifier 93 + the patient-initiated qualifier.",
    },
    {
      topic: "DME/orthotic/prosthetic",
      rule: "Detailed written order BEFORE delivery. Face-to-face encounter + dispensing supplier verification.",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            CMS Conditions of Participation — common trip-ups
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The handful of standards outpatient practices most often miss in
            chart audits. Cross-reference with your specialty&apos;s LCD/NCD
            list.
          </p>
        </div>
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.topic} className="rounded-md border p-2 text-[11px]">
              <p className="font-medium text-foreground">{it.topic}</p>
              <p className="text-muted-foreground">{it.rule}</p>
            </li>
          ))}
        </ul>
        <Badge variant="outline" className="text-[10px]">
          42 CFR Part 482 + CMS Internet-Only Manual Pub. 100-04
        </Badge>
      </CardContent>
    </Card>
  );
}

function LowVolumeThresholdCheck() {
  // CY 2026 thresholds. Update annually.
  const REVENUE_THRESHOLD = 90_000;
  const PATIENT_THRESHOLD = 200;
  const SERVICE_THRESHOLD = 200;

  const [revenue, setRevenue] = useState("");
  const [patients, setPatients] = useState("");
  const [services, setServices] = useState("");

  const r = Number.parseFloat(revenue) || 0;
  const p = Number.parseInt(patients, 10) || 0;
  const s = Number.parseInt(services, 10) || 0;
  const exempt =
    r < REVENUE_THRESHOLD || p < PATIENT_THRESHOLD || s < SERVICE_THRESHOLD;
  const hasInput = revenue || patients || services;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            QPP low-volume threshold check
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Clinicians below ANY of these thresholds during the determination
            period are exempt from MIPS. Hit ALL three to be required to
            report.
          </p>
        </div>
        <ul className="space-y-1.5">
          {[
            {
              label: "Allowed Part B charges (annual)",
              value: revenue,
              setter: setRevenue,
              threshold: `$${REVENUE_THRESHOLD.toLocaleString("en-US")}`,
              prefix: "$",
            },
            {
              label: "Medicare Part B beneficiaries",
              value: patients,
              setter: setPatients,
              threshold: `${PATIENT_THRESHOLD}`,
              prefix: "",
            },
            {
              label: "Covered professional services",
              value: services,
              setter: setServices,
              threshold: `${SERVICE_THRESHOLD}`,
              prefix: "",
            },
          ].map((row) => (
            <li key={row.label} className="space-y-0.5">
              <label className="block text-[10px] font-medium text-foreground">
                {row.label}
                <span className="ml-1 text-muted-foreground">
                  (threshold {row.threshold})
                </span>
                <input
                  type="number"
                  min={0}
                  value={row.value}
                  onChange={(e) => row.setter(e.target.value)}
                  placeholder={row.prefix + "0"}
                  className="mt-0.5 block w-full rounded border bg-background px-1.5 py-1 text-xs tabular-nums"
                />
              </label>
            </li>
          ))}
        </ul>
        {hasInput && (
          <div
            className="rounded-md border p-2 text-xs"
            style={{
              borderColor: exempt
                ? "var(--gw-color-compliant)"
                : "var(--gw-color-needs)",
              backgroundColor: `color-mix(in oklch, ${
                exempt
                  ? "var(--gw-color-compliant)"
                  : "var(--gw-color-needs)"
              } 10%, transparent)`,
            }}
          >
            <p className="font-medium">
              {exempt
                ? "Exempt from MIPS reporting"
                : "Required to report MIPS (or join an APM)"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Below any one threshold = exempt. Above all three = required.
              Verify on the QPP Participation Status Tool with your TIN/NPI.
            </p>
          </div>
        )}
        <Badge variant="outline" className="text-[10px]">
          CY 2026 QPP final rule
        </Badge>
      </CardContent>
    </Card>
  );
}
