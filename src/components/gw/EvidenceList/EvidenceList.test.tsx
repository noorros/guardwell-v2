// src/components/gw/EvidenceList/EvidenceList.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { EvidenceList, type EvidenceListItem } from ".";

global.fetch = vi.fn();

const ITEMS: EvidenceListItem[] = [
  {
    id: "ev-1",
    fileName: "license.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 98304,
    uploadedAt: "2026-04-20T10:00:00Z",
    status: "UPLOADED",
  },
  {
    id: "ev-2",
    fileName: "cert.png",
    mimeType: "image/png",
    fileSizeBytes: 204800,
    uploadedAt: "2026-04-21T12:00:00Z",
    status: "UPLOADED",
  },
];

describe("<EvidenceList>", () => {
  it("renders a list of uploaded files", () => {
    render(<EvidenceList items={ITEMS} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.getByText("license.pdf")).toBeInTheDocument();
    expect(screen.getByText("cert.png")).toBeInTheDocument();
  });

  it("renders download links for each file", () => {
    render(<EvidenceList items={ITEMS} canDelete={false} onDeleted={vi.fn()} />);
    const links = screen.getAllByRole("link", { name: /download/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/api/evidence/ev-1/download");
    expect(links[1]).toHaveAttribute("href", "/api/evidence/ev-2/download");
  });

  it("renders delete buttons when canDelete=true", () => {
    render(<EvidenceList items={ITEMS} canDelete={true} onDeleted={vi.fn()} />);
    const deleteBtns = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteBtns).toHaveLength(2);
  });

  it("does NOT render delete buttons when canDelete=false", () => {
    render(<EvidenceList items={ITEMS} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("calls onDeleted with evidenceId after successful delete", async () => {
    const onDeleted = vi.fn();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });
    render(<EvidenceList items={ITEMS} canDelete={true} onDeleted={onDeleted} />);
    const [firstDeleteBtn] = screen.getAllByRole("button", { name: /delete/i });
    fireEvent.click(firstDeleteBtn);
    await vi.waitFor(() => expect(onDeleted).toHaveBeenCalledWith("ev-1"));
  });

  it("shows empty state when no items", () => {
    render(<EvidenceList items={[]} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.getByText(/no files attached/i)).toBeInTheDocument();
  });

  it("shows PENDING badge for PENDING items", () => {
    const pending: EvidenceListItem[] = [
      { ...ITEMS[0], id: "ev-p", status: "PENDING" },
    ];
    render(<EvidenceList items={pending} canDelete={false} onDeleted={vi.fn()} />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <EvidenceList items={ITEMS} canDelete={true} onDeleted={vi.fn()} />,
    );
    const results = await axe(container, { rules: { region: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
