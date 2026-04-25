"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Step1Officers } from "./Step1Officers";
import { Step2Policy } from "./Step2Policy";
import { Step3Training } from "./Step3Training";
import { Step4Invite } from "./Step4Invite";
import { WizardComplete } from "./WizardComplete";

type StepCode = "OFFICERS" | "POLICY" | "TRAINING" | "INVITE" | "COMPLETE";

const STEP_ORDER: Exclude<StepCode, "COMPLETE">[] = [
  "OFFICERS",
  "POLICY",
  "TRAINING",
  "INVITE",
];

const STEP_LABELS: Record<StepCode, string> = {
  OFFICERS: "Officers",
  POLICY: "Privacy Policy",
  TRAINING: "HIPAA training",
  INVITE: "Invite team",
  COMPLETE: "Done",
};

export interface WizardShellProps {
  currentStep: StepCode;
  owner: {
    practiceUserId: string;
    userId: string;
    displayName: string;
  };
  privacyTemplateBody: string | null;
  hipaaBasicsCourse: HipaaBasicsCourse | null;
}

export interface HipaaBasicsCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  passingScore: number;
  quizQuestions: Array<{
    id: string;
    question: string;
    options: string[];
    order: number;
  }>;
}

export function WizardShell(props: WizardShellProps) {
  const [step, setStep] = useState<StepCode>(props.currentStep);

  const currentIndex = STEP_ORDER.indexOf(step as Exclude<StepCode, "COMPLETE">);
  const completedCount =
    step === "COMPLETE" ? STEP_ORDER.length : Math.max(0, currentIndex);

  const advance = () => {
    const next = STEP_ORDER[currentIndex + 1];
    setStep(next ?? "COMPLETE");
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            First-run setup · {completedCount}/{STEP_ORDER.length} complete
          </p>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "You can come back to this anytime in Compliance Track. Skip?",
                )
              ) {
                window.location.assign("/dashboard");
              }
            }}
            className="text-xs text-muted-foreground underline"
          >
            Skip onboarding
          </button>
        </div>
        <div className="flex gap-1.5">
          {STEP_ORDER.map((code, i) => (
            <div
              key={code}
              className={`h-1.5 flex-1 rounded ${
                i < completedCount ? "bg-primary" : "bg-muted"
              }`}
              aria-label={STEP_LABELS[code]}
            />
          ))}
        </div>
      </header>

      <Card>
        <CardContent className="space-y-4 p-6">
          {step === "OFFICERS" && (
            <Step1Officers owner={props.owner} onComplete={advance} />
          )}
          {step === "POLICY" && (
            <Step2Policy
              templateBody={props.privacyTemplateBody}
              onComplete={advance}
            />
          )}
          {step === "TRAINING" && (
            <Step3Training course={props.hipaaBasicsCourse} onComplete={advance} />
          )}
          {step === "INVITE" && <Step4Invite onComplete={advance} />}
          {step === "COMPLETE" && <WizardComplete />}
        </CardContent>
      </Card>
    </main>
  );
}
