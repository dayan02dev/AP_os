// Gate 1 remembers WHICH application you were on — not its row number.
//
// The stack is a queue that shrinks as you work it. `decide()` advances the
// index without reloading (for anything but the last item), so the list stays
// stale and your position stays right. But opening "View full application"
// unmounts the screen, and coming back refetches: rows you already decided are
// gone from the `evaluated` bucket, everything after them shifts up, and a
// remembered INDEX now points somewhere further down the queue. Sitting on the
// 3rd of 5 with two rows gone from the front, a sticky index of 2 lands on the
// 5th — silently skipping the one you were reading and the one after it.
//
// The clamp effect cannot catch this: it only fires when idx >= total, so a
// shrink from the FRONT of the list is invisible to it.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({
  useAdminData: vi.fn(),
  loadDetail: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../../../lib/adminPlatformApi", () => ({
  adminPlatformApi: { decide: vi.fn(), bulkDecide: vi.fn(), moveTrack: vi.fn() },
}));
vi.mock("../screens/ComparativeReviewModel", () => ({
  ComparativeReviewModel: () => null,
}));
vi.mock("../screens/ApplicationSummaryCard", () => ({
  default: ({ onViewFullApplication }) => (
    <button onClick={onViewFullApplication}>View full application →</button>
  ),
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import AdminGate1 from "../screens/AdminGate1";

const app = (id, name) => ({
  id, name, track: "tir", domain: "Robotics", stage: "Prototype",
  chip: "EVALUATED", ai: { overall: 7.5 }, flags: [],
});

const FIVE = [
  app("a1", "Alpha"), app("a2", "Bravo"), app("a3", "Charlie"),
  app("a4", "Delta"), app("a5", "Echo"),
];
// a1 and a2 were decided, so they left the `evaluated` bucket.
const AFTER = [app("a3", "Charlie"), app("a4", "Delta"), app("a5", "Echo")];

function mockRows(rows) {
  useAdminData.mockImplementation((kind, params) => {
    if (kind === "pipeline" && params?.status === "evaluated") {
      return { data: { startups: rows, total: rows.length }, loading: false, error: null, reload: vi.fn() };
    }
    return { data: { startups: [], total: 0 }, loading: false, error: null, reload: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminGate1 — the stack keeps its place by application, not by index", () => {
  it("lands back on the SAME application after rows leave the front of the list", () => {
    mockRows(FIVE);
    const first = render(<AdminGate1 goDetail={vi.fn()} />);

    // Walk to the 3rd of 5.
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();

    // "View full application" unmounts the screen; Back remounts it and
    // useAdminData refetches — by which time the two decided rows are gone.
    first.unmount();
    mockRows(AFTER);
    render(<AdminGate1 goDetail={vi.fn()} />);

    // Charlie is now the 1st of 3. We must be on Charlie, not two rows past it.
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.queryByText("Echo")).toBeNull();
  });

  it("stays put when the list is unchanged", () => {
    mockRows(FIVE);
    const first = render(<AdminGate1 goDetail={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Bravo")).toBeInTheDocument();

    first.unmount();
    mockRows(FIVE);
    render(<AdminGate1 goDetail={vi.fn()} />);
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  // The one you were on left the list because you just decided it. Landing at
  // the top of the queue would throw away all the walking you did, so we fall
  // back to the remembered index, clamped — i.e. right where the gap is.
  it("falls back to the remembered index — not to the top — when that application is gone", () => {
    mockRows(FIVE);
    const first = render(<AdminGate1 goDetail={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Charlie")).toBeInTheDocument();

    first.unmount();
    // Charlie itself is decided and drops out; the rest keep their order.
    mockRows([app("a1", "Alpha"), app("a2", "Bravo"), app("a4", "Delta"), app("a5", "Echo")]);
    render(<AdminGate1 goDetail={vi.fn()} />);

    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
  });

  it("clamps a remembered index that is past the end of a shorter list", () => {
    mockRows(FIVE);
    const first = render(<AdminGate1 goDetail={vi.fn()} />);
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.getByText("Echo")).toBeInTheDocument();

    first.unmount();
    mockRows([app("a1", "Alpha"), app("a2", "Bravo")]);
    render(<AdminGate1 goDetail={vi.fn()} />);

    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });
});
