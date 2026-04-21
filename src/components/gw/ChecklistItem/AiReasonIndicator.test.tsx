import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiReasonIndicator } from "./AiReasonIndicator";

describe("<AiReasonIndicator>", () => {
  it("renders an info icon button when source is AI_ASSESSMENT and reason is non-empty", () => {
    render(
      <AiReasonIndicator
        source="AI_ASSESSMENT"
        reason="Claude inferred this is compliant based on the uploaded Privacy Officer policy."
      />,
    );
    const btn = screen.getByRole("button", {
      name: /why claude suggested this/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("renders nothing when source is USER", () => {
    const { container } = render(
      <AiReasonIndicator
        source="USER"
        reason="Shouldn't be shown even if reason is present."
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when source is IMPORT", () => {
    const { container } = render(
      <AiReasonIndicator source="IMPORT" reason="irrelevant" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when source is AI_ASSESSMENT but reason is empty", () => {
    const { container } = render(
      <AiReasonIndicator source="AI_ASSESSMENT" reason="" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when source is null/undefined", () => {
    const { container } = render(
      <AiReasonIndicator source={null} reason={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a popover with Claude's reasoning content when clicked", async () => {
    const user = userEvent.setup();
    render(
      <AiReasonIndicator
        source="AI_ASSESSMENT"
        reason="The Privacy Officer role was clearly documented."
      />,
    );
    const btn = screen.getByRole("button", {
      name: /why claude suggested this/i,
    });
    await user.click(btn);
    // Popover content is portaled; query via screen.
    expect(screen.getByText(/claude's reasoning/i)).toBeInTheDocument();
    expect(
      screen.getByText(/the privacy officer role was clearly documented/i),
    ).toBeInTheDocument();
  });
});
