import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FullApplication from "../FullApplication.jsx";

describe("FullApplication", () => {
  it("renders schema-driven sections from the raw application row", () => {
    const application = {
      problem_describe: "A clear and pressing problem statement here.",
      declaration_truthful: true,
    };
    render(
      <FullApplication
        track="tir"
        application={application}
        applicationId="app-1"
        signedUrl={vi.fn()}
      />,
    );
    expect(screen.getByText(/A clear and pressing problem statement/i)).toBeInTheDocument();
  });
});
