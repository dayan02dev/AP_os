import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let currentUser = null;
vi.mock("../../hooks/useAuth.jsx", () => ({ useAuth: () => ({ user: currentUser }) }));

import PortalSwitcher from "../PortalSwitcher.jsx";

const renderSwitcher = (current) =>
  render(
    <MemoryRouter>
      <PortalSwitcher current={current} />
    </MemoryRouter>,
  );

describe("PortalSwitcher — Jury Portal closed for this round", () => {
  it("never lists the Jury entry, even for a jury-role account", () => {
    currentUser = { roles: ["admin", "reviewer", "jury"] };
    renderSwitcher("admin");
    fireEvent.click(screen.getByRole("button", { name: /switch role/i }));
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
    expect(screen.queryByText("Jury Member")).toBeNull();
  });

  it("hides entirely when jury is the only other portal", () => {
    currentUser = { roles: ["admin", "jury"] };
    const { container } = renderSwitcher("admin");
    expect(container.innerHTML).toBe("");
  });
});
