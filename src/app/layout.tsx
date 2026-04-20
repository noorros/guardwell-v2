import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "GuardWell — Healthcare Compliance Platform",
    template: "%s | GuardWell",
  },
  description:
    "All-in-one healthcare compliance platform. HIPAA, OSHA, OIG, CMS, DEA, CLIA, MACRA, TCPA + state law in one dashboard.",
  applicationName: "GuardWell",
  robots: { index: false, follow: false }, // v2 staging — flip to true at launch
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        {/* WCAG: skip-to-main link (ADR-0005 a11y baseline) */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--gw-z-toast)] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
