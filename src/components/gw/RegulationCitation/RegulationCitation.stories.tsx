// src/components/gw/RegulationCitation/RegulationCitation.stories.tsx
import { RegulationCitation } from ".";

export const stories = {
  HipaaText: <RegulationCitation citation="45 CFR §164.308(a)(1)(ii)(A)" />,
  HipaaLinked: (
    <RegulationCitation
      citation="45 CFR §164.500"
      href="https://www.ecfr.gov/current/title-45/section-164.500"
    />
  ),
  StateCitation: <RegulationCitation citation="ARS §36-664" />,
  OigSafeHarbor: (
    <RegulationCitation citation="42 CFR §1001.952(o)" href="https://www.ecfr.gov/current/title-42/section-1001.952" />
  ),
};
