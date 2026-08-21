import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const ROWS = Array.from({ length: 5 }, (_, i) => ({
  id: `a${i + 1}`, track: "tir", name: `App ${i + 1}`, domain: "AI",
  stage: "Prototype", founders: ["F"], sub: "2026-06-01", chip: "EVALUATED",
  ai: {}, reviews: [], batches: [], flag: null,
}));

vi.mock("../../../../../hooks/useAdminData", () => ({
  useAdminData: (kind, params) => ({
    data: { startups: params?.status === "evaluated" ? ROWS : ROWS, total: ROWS.length },
    loading: false, error: null, reload: vi.fn(),
  }),
  loadDetail: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import AdminGate1 from "../AdminGate1";

describe("AdminGate1 — stack position", () => {
  beforeEach(() => {
    const store = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    });
  });

  it("keeps the position after the screen unmounts and comes back", () => {
    const first = render(<AdminGate1 goDetail={vi.fn()} />);
    expect(screen.getByText("1/5")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("3/5")).toBeInTheDocument();

    // Opening an application unmounts the whole screen; coming back remounts it.
    first.unmount();
    render(<AdminGate1 goDetail={vi.fn()} />);
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("hands the full stack order to goDetail so the detail view can walk it", () => {
    const goDetail = vi.fn();
    render(<AdminGate1 goDetail={goDetail} />);
    fireEvent.click(screen.getByText(/View full application/));
    expect(goDetail).toHaveBeenCalledWith("a1", "tir", "gate1", [
      { id: "a1", track: "tir" }, { id: "a2", track: "tir" }, { id: "a3", track: "tir" },
      { id: "a4", track: "tir" }, { id: "a5", track: "tir" },
    ]);
  });
});
