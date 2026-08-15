// The audit log's filters are a single object rather than one state per field,
// so this covers the object-valued + updater-form path through useStickyState.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../hooks/useAdminData", () => ({ useAdminData: vi.fn() }));
vi.mock("../../../../lib/adminPlatformApi.js", () => ({
  adminPlatformApi: { getAuditLog: vi.fn() },
}));

import { useAdminData } from "../../../../hooks/useAdminData";
import { AdminAudit } from "../screens/AdminAudit";

beforeEach(() => {
  vi.clearAllMocks();
  useAdminData.mockReturnValue({
    data: { entries: [] }, loading: false, error: null, reload: vi.fn(),
  });
});

describe("AdminAudit sticky filters", () => {
  it("keeps the actor filter after the screen unmounts and remounts", () => {
    const first = render(<AdminAudit />);
    fireEvent.change(screen.getByPlaceholderText("e.g. admin@artpark.in"), {
      target: { value: "nirav@artpark.in" },
    });
    first.unmount();

    render(<AdminAudit />);
    expect(screen.getByPlaceholderText("e.g. admin@artpark.in")).toHaveValue("nirav@artpark.in");
  });

  it("keeps two independent fields of the same filter object", () => {
    const first = render(<AdminAudit />);
    fireEvent.change(screen.getByPlaceholderText("e.g. admin@artpark.in"), {
      target: { value: "nirav@artpark.in" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. GATE_1_DECIDE"), {
      target: { value: "GATE_1_DECIDE" },
    });
    first.unmount();

    render(<AdminAudit />);
    expect(screen.getByPlaceholderText("e.g. admin@artpark.in")).toHaveValue("nirav@artpark.in");
    expect(screen.getByPlaceholderText("e.g. GATE_1_DECIDE")).toHaveValue("GATE_1_DECIDE");
  });
});
