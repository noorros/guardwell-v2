import { describe, it, expect } from "vitest";
import {
  composeDripEmail,
  composeDay1,
  composeDay3,
  composeDay5,
  composeDay7,
  composeDay10,
  DRIP_DAYS,
  type DripContext,
} from "./drip-content";

const baseCtx: DripContext = {
  practiceName: "Acme Family Medicine",
  recipientEmail: "owner@acme.test",
  currentScore: 28,
  firstRunCompleted: false,
  topGaps: [
    {
      title: "Conduct a Security Risk Assessment",
      reason: "Highest-weight HIPAA requirement, not yet started",
      href: "/programs/sra",
    },
    {
      title: "Adopt Breach Response Policy",
      reason: "Required core policy, not yet adopted",
      href: "/programs/policies",
    },
    {
      title: "Inventory technology assets",
      reason: "Foundational for the security rule",
    },
  ],
  trialEndsAt: new Date(Date.now() + 18 * 60 * 60 * 1000), // 18h out
  baseUrl: "https://v2.app.gwcomp.com",
};

describe("Day 1 — welcome", () => {
  it("links to /onboarding/first-run when wizard incomplete", () => {
    const email = composeDay1({ ...baseCtx, firstRunCompleted: false });
    expect(email.subject).toMatch(/Welcome|first-run|setup/i);
    expect(email.html).toContain("/onboarding/first-run");
    expect(email.text).toContain("/onboarding/first-run");
  });

  it("links to /programs/track when wizard already complete", () => {
    const email = composeDay1({ ...baseCtx, firstRunCompleted: true });
    expect(email.html).toContain("/programs/track");
    expect(email.html).not.toContain("/onboarding/first-run");
  });

  it("includes the practice name in the body", () => {
    const email = composeDay1(baseCtx);
    expect(email.text).toContain("Acme Family Medicine");
    expect(email.html).toContain("Acme Family Medicine");
  });
});

describe("Day 3 — score check-in", () => {
  it("renders the score in the subject", () => {
    const email = composeDay3({ ...baseCtx, currentScore: 42 });
    expect(email.subject).toContain("42");
  });

  it("renders the top 3 gaps as a bulleted list", () => {
    const email = composeDay3(baseCtx);
    expect(email.text).toContain("Conduct a Security Risk Assessment");
    expect(email.text).toContain("Adopt Breach Response Policy");
    expect(email.text).toContain("Inventory technology assets");
  });

  it("renders an 'on track' message when no gaps remain", () => {
    const email = composeDay3({ ...baseCtx, topGaps: [] });
    expect(email.text).toMatch(/on track|no urgent/i);
    expect(email.html).toMatch(/no urgent|already covered/i);
  });

  it("links to /dashboard", () => {
    const email = composeDay3(baseCtx);
    expect(email.html).toContain("/dashboard");
  });
});

describe("Day 5 — OCR fine awareness", () => {
  it("links to the policy template library", () => {
    const email = composeDay5(baseCtx);
    expect(email.html).toContain("/programs/policies");
  });

  it("references the $47k figure", () => {
    const email = composeDay5(baseCtx);
    expect(email.subject).toMatch(/47/);
    expect(email.text).toContain("47,000");
  });
});

describe("Day 7 — trial ending", () => {
  it("uses 'in N hours' when trialEndsAt is within 24h", () => {
    const email = composeDay7({
      ...baseCtx,
      trialEndsAt: new Date(Date.now() + 18 * 60 * 60 * 1000),
    });
    expect(email.subject).toMatch(/18 hours|trial ends/i);
  });

  it("falls back to 'trial ends soon' when more than 24h remain", () => {
    const email = composeDay7({
      ...baseCtx,
      trialEndsAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });
    expect(email.subject).toMatch(/trial ends soon|trial ends/i);
  });

  it("falls back to 'is ending' when trial has already ended", () => {
    const email = composeDay7({
      ...baseCtx,
      trialEndsAt: new Date(Date.now() - 60 * 1000),
    });
    expect(email.subject).toMatch(/is ending|trial/i);
  });

  it("links to /settings/billing", () => {
    const email = composeDay7(baseCtx);
    expect(email.html).toContain("/settings/billing");
  });
});

describe("Day 10 — feedback ask", () => {
  it("includes a Cal.com booking link", () => {
    const email = composeDay10(baseCtx);
    expect(email.html).toContain("cal.com/guardwell");
    expect(email.text).toContain("cal.com/guardwell");
  });

  it("addresses the practice by name", () => {
    const email = composeDay10(baseCtx);
    expect(email.subject).toContain("Acme Family Medicine");
  });
});

describe("composeDripEmail dispatcher", () => {
  it("returns a DripEmail for every supported day", () => {
    for (const day of DRIP_DAYS) {
      const email = composeDripEmail(day, baseCtx);
      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.text.length).toBeGreaterThan(0);
      expect(email.html.length).toBeGreaterThan(0);
    }
  });
});

describe("HTML escaping", () => {
  it("escapes practice names that contain HTML metacharacters", () => {
    const email = composeDay1({
      ...baseCtx,
      practiceName: "Acme <b>Family</b> Medicine & Pediatrics",
    });
    expect(email.html).toContain("Acme &lt;b&gt;Family&lt;/b&gt; Medicine &amp; Pediatrics");
    // Raw user input must not show up unescaped.
    expect(email.html).not.toContain("<b>Family</b>");
  });
});
