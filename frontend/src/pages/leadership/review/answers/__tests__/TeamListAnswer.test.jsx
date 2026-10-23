import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TeamListAnswer from "../TeamListAnswer.jsx";
import { SIP_SCHEMA } from "../../../applicationSchemas.js";

describe("TeamListAnswer", () => {
  it("shows the wizard's camelCase fullName, not the email", () => {
    render(
      <TeamListAnswer
        value={[{ id: "m1", fullName: "Asha Rao", email: "asha@x.in", phone: "9", org: "IISc" }]}
      />,
    );
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("asha@x.in · IISc")).toBeInTheDocument();
  });

  it("still reads legacy full_name / name entries", () => {
    render(<TeamListAnswer value={[{ full_name: "A One" }, { name: "B Two" }]} />);
    expect(screen.getByText("A One")).toBeInTheDocument();
    expect(screen.getByText("B Two")).toBeInTheDocument();
  });

  it("falls back to email, then placeholder", () => {
    render(<TeamListAnswer value={[{ email: "c@x.in" }, { org: "Z" }]} />);
    expect(screen.getByText("c@x.in", { selector: ".name" })).toBeInTheDocument();
    expect(screen.getByText("(unnamed teammate)")).toBeInTheDocument();
  });
});

describe("SIP_SCHEMA co-founders", () => {
  it("renders VIP basic_teammates as a team list", () => {
    const qs = SIP_SCHEMA[0].questions;
    const q = qs.find((x) => x.key === "basic_teammates");
    expect(q?.type).toBe("team");
    expect(qs.some((x) => x.key === "basic_has_team")).toBe(true);
  });
});
