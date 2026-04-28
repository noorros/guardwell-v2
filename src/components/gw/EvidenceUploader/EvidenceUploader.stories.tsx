// src/components/gw/EvidenceUploader/EvidenceUploader.stories.tsx
import { EvidenceUploader } from ".";

export const stories = {
  DefaultCredential: (
    <EvidenceUploader
      entityType="CREDENTIAL"
      entityId="cred-demo"
      onUploaded={() => {}}
    />
  ),
  PDFOnly: (
    <EvidenceUploader
      entityType="INCIDENT"
      entityId="inc-demo"
      accept="application/pdf"
      onUploaded={() => {}}
    />
  ),
  SmallSizeLimit: (
    <EvidenceUploader
      entityType="DESTRUCTION_LOG"
      entityId="dl-demo"
      maxSizeMb={5}
      onUploaded={() => {}}
    />
  ),
};
