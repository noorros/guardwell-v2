// src/components/gw/ModuleHeader/ModuleHeader.stories.tsx
import { ShieldCheck, Lock, Building2, Syringe } from "lucide-react";
import { ModuleHeader } from ".";

export const stories = {
  HipaaPrivacy: (
    <ModuleHeader
      icon={ShieldCheck}
      name="HIPAA Privacy Rule"
      citation="45 CFR Part 164, Subpart E"
      citationHref="https://www.ecfr.gov/current/title-45/part-164/subpart-E"
      score={82}
      jurisdictions={["Federal"]}
    />
  ),
  HipaaSecurity: (
    <ModuleHeader
      icon={Lock}
      name="HIPAA Security Rule"
      citation="45 CFR Part 164, Subpart C"
      score={67}
      jurisdictions={["Federal"]}
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
    />
  ),
  NoScoreNoJurisdictions: <ModuleHeader icon={ShieldCheck} name="OIG Compliance" />,
};
