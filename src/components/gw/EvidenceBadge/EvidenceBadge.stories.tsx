// src/components/gw/EvidenceBadge/EvidenceBadge.stories.tsx
import { EvidenceBadge } from ".";

export const stories = {
  PolicyAdopted: (
    <EvidenceBadge kind="policy" label="Adopted from HIPAA Privacy Policy" href="#" />
  ),
  TrainingSatisfied: (
    <EvidenceBadge kind="training" label="Satisfied by HIPAA Basics 2026" href="#" />
  ),
  AckPending: (
    <EvidenceBadge
      kind="acknowledgment-pending"
      label="Pending acknowledgment from"
      count={7}
    />
  ),
  Attestation: <EvidenceBadge kind="attestation" label="Attested 2026-04-01" />,
  Document: <EvidenceBadge kind="document" label="Uploaded: BAA-Acme.pdf" href="#" />,
};
