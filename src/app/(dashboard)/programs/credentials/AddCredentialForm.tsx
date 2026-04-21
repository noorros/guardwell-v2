// src/app/(dashboard)/programs/credentials/AddCredentialForm.tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { addCredentialAction } from "./actions";

export interface HolderOption {
  id: string;        // PracticeUser.id, or "" for practice-level
  name: string;      // display name
}

export interface CredentialTypeOption {
  code: string;
  name: string;
  category: string;
  renewalPeriodDays: number | null;
}

export interface AddCredentialFormProps {
  holders: HolderOption[];
  credentialTypes: CredentialTypeOption[];
}

export function AddCredentialForm({ holders, credentialTypes }: AddCredentialFormProps) {
  const [credentialTypeCode, setCredentialTypeCode] = useState("");
  const [holderId, setHolderId] = useState("");
  const [title, setTitle] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [issuingBody, setIssuingBody] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Group credential types by category for the <optgroup> select.
  const grouped = useMemo(() => {
    const map = new Map<string, CredentialTypeOption[]>();
    for (const t of credentialTypes) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return Array.from(map.entries()).map(([cat, types]) => ({
      category: cat,
      types,
    }));
  }, [credentialTypes]);

  const selectedType = credentialTypes.find((t) => t.code === credentialTypeCode);

  const handleTypeChange = (code: string) => {
    setCredentialTypeCode(code);
    const t = credentialTypes.find((x) => x.code === code);
    if (t && !title.trim()) setTitle(t.name);
  };

  const reset = () => {
    setCredentialTypeCode("");
    setHolderId("");
    setTitle("");
    setLicenseNumber("");
    setIssuingBody("");
    setIssueDate("");
    setExpiryDate("");
    setNotes("");
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!credentialTypeCode) {
      setError("Pick a credential type.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    startTransition(async () => {
      try {
        await addCredentialAction({
          credentialTypeCode,
          holderId: holderId || null,
          title: title.trim(),
          licenseNumber: licenseNumber.trim() || null,
          issuingBody: issuingBody.trim() || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          notes: notes.trim() || null,
        });
        reset();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add credential";
        setError(msg);
      }
    });
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-sm font-semibold">Add credential</h2>
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Type *</span>
              <select
                value={credentialTypeCode}
                onChange={(e) => handleTypeChange(e.target.value)}
                required
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Select credential type…</option>
                {grouped.map((g) => (
                  <optgroup key={g.category} label={g.category.replaceAll("_", " ")}>
                    {g.types.map((t) => (
                      <option key={t.code} value={t.code}>{t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Holder</span>
              <select
                value={holderId}
                onChange={(e) => setHolderId(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">Practice-level (no specific holder)</option>
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Title *</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="e.g. Arizona Medical License"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">License number</span>
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="e.g. MD-12345"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Issuing body</span>
              <input
                type="text"
                value={issuingBody}
                onChange={(e) => setIssuingBody(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="e.g. Arizona Medical Board"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Issue date</span>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Expiry date {selectedType?.renewalPeriodDays ? `· typical renewal ${selectedType.renewalPeriodDays} days` : ""}
              </span>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="CE requirements met, board action history, anything worth remembering"
            />
          </label>
          {error && (
            <p className="text-xs text-[color:var(--gw-color-at-risk)]">{error}</p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending || !credentialTypeCode || !title.trim()}>
              {isPending ? "Adding…" : "Add credential"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
