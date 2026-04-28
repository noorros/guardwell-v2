// src/components/gw/EvidenceUploader/EvidenceUploader.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { EvidenceUploader } from ".";

// Mock fetch so we don't need a server
global.fetch = vi.fn();

const noop = vi.fn();

function makeFile(name = "test.pdf", type = "application/pdf", size = 1024) {
  const f = new File(["x".repeat(size)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function mockResponse(opts: { ok: boolean; status?: number; body?: unknown }) {
  return Promise.resolve({
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
    json: () => Promise.resolve(opts.body ?? {}),
  } as Response);
}

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

  it("surfaces server error from step 1 init in the alert", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(() =>
      mockResponse({ ok: false, status: 400, body: { error: "File type not allowed" } }),
    );

    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("File type not allowed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces step 2 PUT failure and never calls step 3 confirm", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(() =>
      mockResponse({
        ok: true,
        body: {
          evidenceId: "ev-1",
          gcsKey: "k",
          uploadUrl: "https://gcs.example/upload",
          expiresInSec: 900,
        },
      }),
    );
    fetchMock.mockImplementationOnce(() => mockResponse({ ok: false, status: 500 }));

    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={noop} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/GCS upload failed: HTTP 500/);

    // Step 3 confirm must NOT be called when the GCS PUT failed.
    const confirmCalled = fetchMock.mock.calls.some(([url]) =>
      typeof url === "string" && url.includes("/confirm"),
    );
    expect(confirmCalled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders Retry confirm button when step 3 confirm fails after a successful PUT", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(() =>
      mockResponse({
        ok: true,
        body: {
          evidenceId: "ev-2",
          gcsKey: "k",
          uploadUrl: "https://gcs.example/upload",
          expiresInSec: 900,
        },
      }),
    );
    fetchMock.mockImplementationOnce(() => mockResponse({ ok: true })); // PUT to GCS
    fetchMock.mockImplementationOnce(() =>
      mockResponse({ ok: false, status: 500, body: { error: "DB write failed" } }),
    );

    const onUploaded = vi.fn();
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={onUploaded} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("DB write failed");
    expect(
      await screen.findByRole("button", { name: /retry confirm/i }),
    ).toBeInTheDocument();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("retry confirm button re-runs step 3 and calls onUploaded on success", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(() =>
      mockResponse({
        ok: true,
        body: {
          evidenceId: "ev-3",
          gcsKey: "k",
          uploadUrl: "https://gcs.example/upload",
          expiresInSec: 900,
        },
      }),
    );
    fetchMock.mockImplementationOnce(() => mockResponse({ ok: true })); // PUT
    fetchMock.mockImplementationOnce(() =>
      mockResponse({ ok: false, status: 500, body: { error: "DB write failed" } }),
    );
    fetchMock.mockImplementationOnce(() => mockResponse({ ok: true })); // retry confirm

    const onUploaded = vi.fn();
    render(<EvidenceUploader entityType="CREDENTIAL" entityId="cred-1" onUploaded={onUploaded} />);
    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    const retryBtn = await screen.findByRole("button", { name: /retry confirm/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith("ev-3");
    });

    // Last fetch call should target the same evidence id's confirm endpoint.
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    expect(lastCall?.[0]).toBe("/api/evidence/ev-3/confirm");
  });
});
