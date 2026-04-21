// src/app/(dashboard)/programs/vendors/AddVendorForm.tsx
"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { addVendorAction } from "./actions";

const VENDOR_TYPES = ["EHR", "Billing", "IT", "Cloud", "Shredding", "Other"] as const;

export function AddVendorForm() {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [service, setService] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [processesPhi, setProcessesPhi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setName("");
    setType("");
    setService("");
    setContact("");
    setEmail("");
    setNotes("");
    setProcessesPhi(false);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    startTransition(async () => {
      try {
        await addVendorAction({
          name: name.trim(),
          type: type.trim() || null,
          service: service.trim() || null,
          contact: contact.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
          processesPhi,
        });
        reset();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add vendor";
        setError(msg);
      }
    });
  };

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-sm font-semibold">Add vendor</h2>
        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Name *</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="e.g. Athena Health"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {VENDOR_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Service / description</span>
            <input
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="EHR + patient portal"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Contact</span>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="Jane Doe, Account Manager"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="privacy@vendor.com"
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
              placeholder="Anything worth remembering — renewal date, account rep, weirdness"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={processesPhi}
              onChange={(e) => setProcessesPhi(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span className="text-xs">This vendor accesses or processes PHI (requires a BAA)</span>
          </label>
          {error && (
            <p className="text-xs text-[color:var(--gw-color-at-risk)]">{error}</p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
              {isPending ? "Adding…" : "Add vendor"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
