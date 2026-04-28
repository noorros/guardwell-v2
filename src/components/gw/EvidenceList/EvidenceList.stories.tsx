// src/components/gw/EvidenceList/EvidenceList.stories.tsx
import { EvidenceList, type EvidenceListItem } from ".";

const SAMPLE: EvidenceListItem[] = [
  {
    id: "ev-1",
    fileName: "DEA_registration_2026.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 98304,
    uploadedAt: "2026-04-10T09:00:00Z",
    status: "UPLOADED",
  },
  {
    id: "ev-2",
    fileName: "malpractice_declaration.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 154000,
    uploadedAt: "2026-04-15T14:30:00Z",
    status: "UPLOADED",
  },
  {
    id: "ev-3",
    fileName: "board_cert_scan.png",
    mimeType: "image/png",
    fileSizeBytes: 512000,
    uploadedAt: "2026-04-20T11:00:00Z",
    status: "PENDING",
  },
];

export const stories = {
  ReadOnly: (
    <EvidenceList items={SAMPLE} canDelete={false} onDeleted={() => {}} />
  ),
  CanDelete: (
    <EvidenceList items={SAMPLE} canDelete={true} onDeleted={() => {}} />
  ),
  Empty: (
    <EvidenceList items={[]} canDelete={false} onDeleted={() => {}} />
  ),
  SingleFile: (
    <EvidenceList
      items={[SAMPLE[0]]}
      canDelete={true}
      onDeleted={() => {}}
    />
  ),
};
