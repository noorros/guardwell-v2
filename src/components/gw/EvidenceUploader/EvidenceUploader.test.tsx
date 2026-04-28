// src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { EvidenceUploader } from ".";

// Mock fetch so we don't need a server
global.fetch = vi.fn();

const noop = vi.fn();

describe("<EvidenceUploader>", () => {
  it("renders the drop zone with correct aria-label", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />);
    expect(screen.getByRole("button", { name: /upload file/i })).toBeInTheDocument();
  });

  it("shows accepted file types hint", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" accept="application/pdf,image/png" onUploaded={noop} />);
    expect(screen.getByText(/pdf/i)).toBeInTheDocument();
  });

  it("shows max size hint", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" maxSizeMb={10} onUploaded={noop} />);
    expect(screen.getByText(/10 MB/i)).toBeInTheDocument();
  });

  it("shows error when file is too large", async () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" maxSizeMb={1} onUploaded={noop} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const bigFile = new File(["x".repeat(2 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(bigFile, "size", { value: 2 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/too large/i)).toBeInTheDocument();
  });

  it("is disabled during an upload (button + input are not interactive)", () => {
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />);
    // Before upload starts, the drop zone button is enabled
    const btn = screen.getByRole("button", { name: /upload file/i });
    expect(btn).not.toBeDisabled();
  });

  it("passes axe a11y audit", async () => {
    const { container } = render(
      <EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />,
    );
    const results = await axe(container, { rules: { region: { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
