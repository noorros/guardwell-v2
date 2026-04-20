// src/components/gw/EmptyState/EmptyState.stories.tsx
//
// Stories aren't rendered by Storybook (deferred per ADR-0005); they're
// consumed by the gallery route at /internal/design-system and scanned
// by jest-axe. Each exported story is a plain React element.

import { FileText, Users, AlertTriangle } from "lucide-react";
import { EmptyState } from ".";

export const stories = {
  Default: <EmptyState title="No items yet" />,
  WithDescription: (
    <EmptyState
      title="No staff yet"
      description="Invite your first user to get started."
    />
  ),
  WithButtonAction: (
    <EmptyState
      icon={Users}
      title="No staff yet"
      description="Invite your first user to get started."
      action={{ label: "Invite user", onClick: () => {} }}
    />
  ),
  WithLinkAction: (
    <EmptyState
      icon={FileText}
      title="No policies adopted"
      description="Start with a policy template."
      action={{ label: "Browse templates", href: "#" }}
    />
  ),
  Warning: (
    <EmptyState
      icon={AlertTriangle}
      title="No evidence on file"
      description="This control has no linked evidence. Add one to mark it compliant."
    />
  ),
};
