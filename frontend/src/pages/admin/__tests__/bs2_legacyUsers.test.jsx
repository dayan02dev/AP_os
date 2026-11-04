// BS2 g7 — legacy admin users pages (S2-ADM-70, S2-ADM-72).
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { apiGet, createUser } = vi.hoisted(() => ({ apiGet: vi.fn(), createUser: vi.fn() }));
vi.mock("../../../lib/api.js", () => ({ api: { get: apiGet }, ApiError: class extends Error {} }));
vi.mock("../../../lib/adminApi", () => ({ adminApi: { createUser } }));
vi.mock("../../../hooks/useToast.jsx", () => ({ useToast: () => ({ push: vi.fn() }) }));

import UserListPage from "../UserListPage.jsx";
import AdminAddUser from "../AdminAddUser.jsx";

beforeEach(() => vi.clearAllMocks());

describe("UserListPage paging (S2-ADM-72)", () => {
  it("Load more fetches the next page and appends", async () => {
    const mk = (n, from) => Array.from({ length: n }, (_, i) => ({ id: `u${from + i}`, email: `u${from + i}@x.in`, full_name: `User ${from + i}`, roles: [], created_at: "2026-01-01T00:00:00Z" }));
    apiGet
      .mockResolvedValueOnce({ users: mk(2, 0), total: 3 })
      .mockResolvedValueOnce({ users: mk(1, 2), total: 3 });
    render(<MemoryRouter><UserListPage /></MemoryRouter>);
    await screen.findByText("User 0");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("User 2");
    expect(apiGet.mock.calls[1][0]).toContain("offset=2");
    expect(screen.getByText("User 0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("AdminAddUser (S2-ADM-70)", () => {
  it("reviewer invite whose credentials email failed shows the temp password", async () => {
    createUser.mockResolvedValue({ email: "r@x.in", temp_password: "Rv-Temp1!abcd", credentials_emailed: false });
    render(<MemoryRouter><AdminAddUser /></MemoryRouter>);
    fireEvent.change(document.querySelector('input[type="email"]') || screen.getAllByRole("textbox")[0], { target: { value: "r@x.in" } });
    const boxes = screen.getAllByRole("textbox");
    fireEvent.change(boxes.find((b) => b !== document.querySelector('input[type="email"]') && b.tagName === "INPUT"), { target: { value: "Rev Person" } });
    fireEvent.submit(document.querySelector("form"));
    await screen.findByText(/Rv-Temp1!abcd/);
  });
});
