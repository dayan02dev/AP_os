// SWARM auth_rbac: useAuth rehydrate treats a transient /auth/me failure as "signed out".
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { clearSession } = vi.hoisted(() => ({ clearSession: vi.fn() }));
vi.mock("../../lib/auth.js", () => ({
  getMe: vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error("Unable to load profile"), { status: 500 }))
    .mockResolvedValue({ id: "u", email: "a@artpark.in", roles: ["admin"] }),
  logout: vi.fn(),
}));
vi.mock("../../lib/session.js", () => ({
  loadSession: () => ({ access_token: "valid", refresh_token: "valid-r" }),
  clearSession,
}));

import { AuthProvider } from "../../hooks/useAuth.jsx";
import ProtectedRoute from "../../pages/ProtectedRoute.jsx";

describe("F7 rehydrate", () => {
  it("S2-SH-17: valid stored session + one transient 500 from /auth/me -> retried, stays signed in", async () => {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <AuthProvider>
          <Routes>
            <Route path="/admin" element={<ProtectedRoute><div>ADMIN PORTAL</div></ProtectedRoute>} />
            <Route path="/apply/signin" element={<div>SIGN IN PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("ADMIN PORTAL")).toBeInTheDocument());
    expect(screen.queryByText("SIGN IN PAGE")).toBeNull();
    expect(clearSession).not.toHaveBeenCalled();
  });
});
