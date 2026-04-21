// src/components/gw/Breadcrumb/index.tsx
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Compact breadcrumb with a chevron separator. The last item is treated as
 * the current page — rendered as plain text with aria-current="page" so
 * screen readers announce it correctly, even if the caller accidentally
 * passes an href.
 */
export function Breadcrumb({ items, className }: BreadcrumbProps) {
  if (items.length === 0) return null;
  const lastIndex = items.length - 1;

  return (
    <nav aria-label="Breadcrumb" className={cn("text-xs text-muted-foreground", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => {
          const isLast = i === lastIndex;
          return (
            <Fragment key={`${i}-${item.label}`}>
              <li className="flex items-center">
                {isLast || !item.href ? (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={cn(isLast && "font-medium text-foreground")}
                  >
                    {item.label}
                  </span>
                ) : (
                  <a
                    href={item.href}
                    className="hover:text-foreground hover:underline"
                  >
                    {item.label}
                  </a>
                )}
              </li>
              {!isLast && (
                <li aria-hidden="true" className="flex items-center">
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
