import { getPracticeUser } from "@/lib/rbac";
import { db } from "@/lib/db";
import { WizardShell } from "./WizardShell";

type StepCode = "OFFICERS" | "POLICY" | "TRAINING" | "INVITE" | "COMPLETE";

export default async function FirstRunPage() {
  const pu = await getPracticeUser();
  if (!pu) return null;

  // Step 1 done when the OWNER has BOTH isPrivacyOfficer and isSecurityOfficer.
  const officersDone = pu.isPrivacyOfficer && pu.isSecurityOfficer;

  // Step 2 done when HIPAA_PRIVACY_POLICY is adopted + not retired.
  const privacyPolicy = await db.practicePolicy.findFirst({
    where: {
      practiceId: pu.practiceId,
      policyCode: "HIPAA_PRIVACY_POLICY",
      retiredAt: null,
    },
    select: { id: true, content: true, version: true },
  });
  const policyDone = Boolean(privacyPolicy);

  // Step 3 done when the OWNER has a passing, non-expired HIPAA_BASICS completion.
  const hipaaBasicsCourse = await db.trainingCourse.findUnique({
    where: { code: "HIPAA_BASICS" },
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      passingScore: true,
      quizQuestions: { orderBy: { order: "asc" } },
    },
  });
  const trainingCompletion = hipaaBasicsCourse
    ? await db.trainingCompletion.findFirst({
        where: {
          userId: pu.userId,
          practiceId: pu.practiceId,
          courseId: hipaaBasicsCourse.id,
          passed: true,
          expiresAt: { gt: new Date() },
        },
      })
    : null;
  const trainingDone = Boolean(trainingCompletion);

  const currentStep: StepCode = !officersDone
    ? "OFFICERS"
    : !policyDone
      ? "POLICY"
      : !trainingDone
        ? "TRAINING"
        : "INVITE";

  // Optional template body for Step 2 preview. The core
  // HIPAA_PRIVACY_POLICY code may not have a PolicyTemplate row in
  // every environment — Step2Policy falls back to a built-in baseline
  // preview when this is null. Adoption goes through adoptPolicyAction
  // either way (no PolicyTemplate dependency).
  const privacyTemplate =
    !policyDone
      ? await db.policyTemplate.findUnique({
          where: { code: "HIPAA_PRIVACY_POLICY" },
          select: { bodyMarkdown: true },
        })
      : null;

  return (
    <WizardShell
      currentStep={currentStep}
      owner={{
        practiceUserId: pu.id,
        userId: pu.userId,
        displayName:
          [pu.dbUser.firstName, pu.dbUser.lastName].filter(Boolean).join(" ") ||
          pu.dbUser.email ||
          "You",
      }}
      privacyTemplateBody={privacyTemplate?.bodyMarkdown ?? null}
      hipaaBasicsCourse={hipaaBasicsCourse}
    />
  );
}
