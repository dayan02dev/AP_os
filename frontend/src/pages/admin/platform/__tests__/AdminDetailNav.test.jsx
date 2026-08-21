import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: () => ({ data: { startups: [], total: 0 }, loading: false, error: null, reload: vi.fn() }),
  loadDetail: vi.fn(() => Promise.resolve({
    id: "a1", track: "tir", name: "Alpha", domain: "AI", stage: "Prototype",
    founders: ["F"], sub: "2026-06-01", chip: "EVALUATED", ai: {}, reviews: [],
  })),
}));

vi.mock("../../../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", roles: ["admin"] }, logout: vi.fn() }),
}));

import { AdminDetail } from "../screens/AdminDetail";

const base = { startupId: "a1", track: "tir", onBack: vi.fn() };

describe("AdminDetail — sequence navigation", () => {
  it("renders neither Prev nor Next when no sequence was handed over", async () => {
    render(<AdminDetail {...base} onPrev={null} onNext={null} seqPosition={null} />);
    expect(await screen.findByText("← Back to applications")).toBeInTheDocument();
    expect(screen.queryByText("← Prev")).toBeNull();
    expect(screen.queryByText("Next →")).toBeNull();
  });

  it("shows the 1-based position and both buttons mid-sequence", async () => {
    render(
      <AdminDetail {...base} onPrev={vi.fn()} onNext={vi.fn()}
        seqPosition={{ index: 12, total: 120 }} />
    );
    expect(await screen.findByText("12 / 120")).toBeInTheDocument();
    expect(screen.getByText("← Prev").closest("button").disabled).toBe(false);
    expect(screen.getByText("Next →").closest("button").disabled).toBe(false);
  });

  it("disables Prev at the head of the sequence", async () => {
    render(
      <AdminDetail {...base} onPrev={null} onNext={vi.fn()}
        seqPosition={{ index: 1, total: 120 }} />
    );
    expect(await screen.findByText("← Prev")).toBeInTheDocument();
    expect(screen.getByText("← Prev").closest("button").disabled).toBe(true);
    expect(screen.getByText("Next →").closest("button").disabled).toBe(false);
  });

  it("disables Next at the tail of the sequence", async () => {
    render(
      <AdminDetail {...base} onPrev={vi.fn()} onNext={null}
        seqPosition={{ index: 120, total: 120 }} />
    );
    expect(await screen.findByText("Next →")).toBeInTheDocument();
    expect(screen.getByText("Next →").closest("button").disabled).toBe(true);
  });
});
