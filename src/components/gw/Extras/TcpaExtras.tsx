// src/components/gw/Extras/TcpaExtras.tsx
//
// TCPA Section G helpers:
//   - StopHelpResponseTemplates: copy-pasteable response text for the
//     CTIA-required keywords (STOP, UNSUBSCRIBE, HELP, INFO) for the
//     practice's SMS messaging template library.
//   - ConsentLanguageGenerator: produces the prior-express-written-consent
//     language the FCC requires for marketing texts.

"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function TcpaExtras({
  practiceName,
  practicePrimaryState,
}: {
  practiceName: string;
  practicePrimaryState: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <StopHelpResponseTemplates practiceName={practiceName} />
      <ConsentLanguageGenerator
        practiceName={practiceName}
        practicePrimaryState={practicePrimaryState}
      />
    </div>
  );
}

function StopHelpResponseTemplates({ practiceName }: { practiceName: string }) {
  const templates: Array<{ keyword: string; response: string; rule: string }> = [
    {
      keyword: "STOP",
      response: `${practiceName}: You're unsubscribed and will receive no further texts. Reply START to resubscribe.`,
      rule: "Required acknowledgment within 5 minutes (CTIA recommended; many carriers enforce). Variants: STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT — all must opt the recipient out.",
    },
    {
      keyword: "HELP",
      response: `${practiceName}: For help reply with your question or call our office. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out.`,
      rule: "HELP/INFO must return contact info + opt-out instructions + msg/data disclaimer. Required for any practice messaging program.",
    },
    {
      keyword: "START / RESUBSCRIBE",
      response: `${practiceName}: You're resubscribed. You'll receive appointment + practice messages. Reply STOP to opt out at any time.`,
      rule: "Resubscribe must be explicit (the recipient texts back). Practice cannot resubscribe a previously-opted-out number unilaterally.",
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">
            CTIA keyword response templates
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Drop these into your SMS platform&apos;s auto-response library.
            STOP + HELP are mandatory for every program; missing them is the
            most common single TCPA violation.
          </p>
        </div>
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.keyword} className="rounded-md border p-2 text-[11px]">
              <p className="font-medium text-foreground">{t.keyword}</p>
              <p className="mt-0.5 rounded bg-muted/50 p-1.5 font-mono text-[10px] text-foreground">
                {t.response}
              </p>
              <p className="mt-1 text-muted-foreground">{t.rule}</p>
            </li>
          ))}
        </ul>
        <Badge variant="outline" className="text-[10px]">
          CTIA SMS Best Practices + 47 CFR §64.1200
        </Badge>
      </CardContent>
    </Card>
  );
}

function ConsentLanguageGenerator({
  practiceName,
  practicePrimaryState,
}: {
  practiceName: string;
  practicePrimaryState: string;
}) {
  const [program, setProgram] = useState<"appointments" | "marketing" | "both">("appointments");
  const programWords =
    program === "appointments"
      ? "appointment reminders + practice operational messages"
      : program === "marketing"
        ? "marketing + promotional offers"
        : "appointment reminders, operational messages, and marketing/promotional offers";
  const consentText = `By providing your phone number to ${practiceName}, you agree to receive automated text messages from ${practiceName} regarding ${programWords}. Consent is not a condition of treatment. Msg & data rates may apply. Msg frequency varies. Reply HELP for help or STOP to opt out at any time. ${practicePrimaryState === "CA" ? "California residents: see our CCPA notice for additional rights. " : ""}See our Privacy Policy for details on how we use your information.`;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="text-sm font-semibold">Prior express written consent</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Marketing texts require &ldquo;prior express written
            consent&rdquo; (FCC). Operational messages (appointment reminders)
            require only &ldquo;prior express consent.&rdquo; The language
            below is broad enough to cover both — present at the point of
            phone-number collection.
          </p>
        </div>
        <fieldset className="space-y-1 text-[11px]">
          <legend className="text-[10px] font-medium text-foreground">
            What will you send?
          </legend>
          <div className="flex flex-wrap gap-3">
            {(["appointments", "marketing", "both"] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="tcpa-program"
                  value={opt}
                  checked={program === opt}
                  onChange={() => setProgram(opt)}
                />
                <span>
                  {opt === "appointments"
                    ? "Appointments only"
                    : opt === "marketing"
                      ? "Marketing only"
                      : "Both"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rounded-md border bg-muted/30 p-2 text-[10px] text-foreground">
          {consentText}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => navigator.clipboard?.writeText(consentText)}
        >
          Copy text
        </Button>
        <Badge variant="outline" className="text-[10px]">
          47 CFR §64.1200(f) + FCC orders
        </Badge>
      </CardContent>
    </Card>
  );
}
