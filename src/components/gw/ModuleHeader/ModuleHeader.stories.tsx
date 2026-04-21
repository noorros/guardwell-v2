// src/components/gw/ModuleHeader/ModuleHeader.stories.tsx
import { ShieldCheck, Lock, Building2, Syringe } from "lucide-react";
import { ModuleHeader } from ".";

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const HUNDRED_DAYS_AGO = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);

export const stories = {
  HipaaPrivacy: (
    <ModuleHeader
      icon={ShieldCheck}
      name="HIPAA Privacy Rule"
      citation="45 CFR Part 164, Subpart E"
      citationHref="https://www.ecfr.gov/current/title-45/part-164/subpart-E"
      score={82}
      jurisdictions={["Federal"]}
      assessedAt={TWO_DAYS_AGO}
    />
  ),
  HipaaSecurity: (
    <ModuleHeader
      icon={Lock}
      name="HIPAA Security Rule"
      citation="45 CFR Part 164, Subpart C"
      score={67}
      jurisdictions={["Federal"]}
      assessedAt={TWO_DAYS_AGO}
    />
  ),
  StateMulti: (
    <ModuleHeader
      icon={Building2}
      name="State Medical Records"
      citation="See state-specific"
      jurisdictions={["AZ", "CA", "TX", "NY"]}
    />
  ),
  OshaBbp: (
    <ModuleHeader
      icon={Syringe}
      name="OSHA Bloodborne Pathogens"
      citation="29 CFR §1910.1030"
      score={44}
      assessedAt={HUNDRED_DAYS_AGO}
    />
  ),
  NoScoreNoJurisdictions: <ModuleHeader icon={ShieldCheck} name="OIG Compliance" />,
};
