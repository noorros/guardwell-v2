export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl text-center space-y-4">
        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          GuardWell v2 — staging
        </p>
        <h1 className="text-4xl font-bold tracking-tight">
          The rebuild is in progress.
        </h1>
        <p className="text-muted-foreground">
          Visit{" "}
          <a
            href="https://gwcomp.com"
            className="text-primary underline underline-offset-4"
          >
            gwcomp.com
          </a>{" "}
          to join the waitlist for early access.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Architecture commitments live in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">docs/adr/</code>.
        </p>
      </div>
    </div>
  );
}
