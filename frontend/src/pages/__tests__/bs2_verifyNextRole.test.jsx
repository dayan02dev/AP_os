// S2-SH-07: OTP verify must also respect the account's role for ?next=.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("../../hooks/useAuth.jsx", () => ({
  useAuth: () => ({ verifyOtp: vi.fn(async () => ({})), requestOtp: vi.fn() }),
}));
vi.mock("../../hooks/useToast.jsx", () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock("../../hooks/usePageTheme.jsx", () => ({ usePageTheme: () => {} }));
vi.mock("../../lib/founderApi.js", () => ({ founderApi: { me: vi.fn(async () => { throw new Error("403"); }) } }));
vi.mock("../../lib/auth.js", () => ({
  getMe: vi.fn(async () => ({ password_set: true, roles: ["reviewer"] })),
}));

import VerifyPage from "../VerifyPage.jsx";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

describe("OTP verify ?next= respects role", () => {
  it("reviewer with stale next=/leadership lands on /reviewer", async () => {
    render(
      <MemoryRouter initialEntries={["/apply/verify?email=r%40artpark.in&next=%2Fleadership"]}>
        <Routes>
          <Route path="/apply/verify" element={<VerifyPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(document.querySelector("input"), { target: { value: "123456" } });
    fireEvent.submit(document.querySelector("form"));
    await waitFor(() => screen.getByTestId("where"));
    expect(screen.getByTestId("where").textContent).toBe("/reviewer");
  });
});
