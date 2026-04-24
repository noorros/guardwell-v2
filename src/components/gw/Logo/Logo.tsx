// src/components/gw/Logo/Logo.tsx
//
// GuardWell brand mark. Renders the horizontal wordmark from
// /public/logo.png. Uses Next.js Image for optimization. Set the
// `variant` prop to control sizing — common heights are 32px (compact
// nav), 40px (auth pages), 48px (marketing-ish hero).

import Image from "next/image";

export interface LogoProps {
  /** Pixel height. The width auto-scales to maintain aspect ratio.
   *  Defaults to 40 (suitable for sign-in/sign-up auth pages). */
  height?: number;
  /** Optional className for the outer wrapper (e.g. for centering or
   *  flex alignment in headers). */
  className?: string;
  /** Override the default alt text. */
  alt?: string;
}

// Source asset is a horizontal wordmark; aspect ratio measured at
// roughly 4.6:1 (logo.png is ~1840×400). Image with width=auto on
// the rendered element preserves that ratio.
const ASPECT_RATIO = 4.6;

export function Logo({
  height = 40,
  className,
  alt = "GuardWell",
}: LogoProps) {
  const width = Math.round(height * ASPECT_RATIO);
  return (
    <div className={className}>
      <Image
        src="/logo.png"
        alt={alt}
        width={width}
        height={height}
        priority
        style={{ height, width: "auto" }}
      />
    </div>
  );
}
