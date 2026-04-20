// src/components/gw/PracticeIdentityCard/PracticeIdentityCard.stories.tsx
import { PracticeIdentityCard } from ".";

export const stories = {
  Minimal: <PracticeIdentityCard name="Noorros Internal Medicine" primaryState="AZ" />,
  Full: (
    <PracticeIdentityCard
      name="Noorros Internal Medicine"
      primaryState="AZ"
      specialty="Internal Medicine"
      role="OWNER"
      officerRoles={["Privacy Officer", "Security Officer", "Compliance Officer"]}
      setupProgress={45}
    />
  ),
  SetupComplete: (
    <PracticeIdentityCard
      name="Desert Sky Family Health"
      primaryState="NV"
      specialty="Family Medicine"
      role="OWNER"
      officerRoles={["Privacy Officer"]}
      setupProgress={100}
    />
  ),
  Viewer: (
    <PracticeIdentityCard
      name="Cactus Pediatrics"
      primaryState="AZ"
      role="VIEWER"
    />
  ),
};
