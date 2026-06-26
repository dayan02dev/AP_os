// useApplication integration-ish tests.
// AuthProvider is included so the ApplicationProvider sees isAuthed=true;
// we short-circuit auth by pre-saving a session + mocking getMe.

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApplicationProvider, useApplication } from "../useApplication.jsx";
import { AuthProvider } from "../useAuth.jsx";
import { _resetSessionForTests, loadSession, saveSession } from "../../lib/session.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Test harness — renders children after auth is populated.
function Harness({ onReady }) {
  const app = useApplication();
  onReady(app);
  return (
    <div>
      <span data-testid="saving">{app.saving}</span>
      <span data-testid="locked">{String(app.locked)}</span>
      <span data-testid="name">{app.answers.fullName || ""}</span>
    </div>
  );
}

function seedAuthedSession() {
  saveSession({ access_token: "a", refresh_token: "r" });
}

describe("useApplication", () => {
  let appRef;

  beforeEach(() => {
    _resetSessionForTests();
    vi.stubGlobal("fetch", vi.fn());
    appRef = {};
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function mount() {
    seedAuthedSession();
    // AuthProvider calls /auth/me first; ApplicationProvider then calls
    // /applications/me once isAuthed flips.
    globalThis.fetch
      // /auth/me
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(200, { id: "u1", email: "u@x.com" })),
      )
      // /applications/me/submitted (now fetched first — decoupled from draft)
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, [])))
      // /applications/me (current draft — fetched second)
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(200, {
            id: "app1",
            user_id: "u1",
            status: "draft",
            completion_pct: 10,
            basic_full_name: "Existing Name",
            created_at: "2026-04-19T00:00:00Z",
            updated_at: "2026-04-19T00:00:00Z",
          }),
        ),
      );

    const onReady = (app) => {
      appRef.current = app;
    };

    render(
      <AuthProvider>
        <ApplicationProvider>
          <Harness onReady={onReady} />
        </ApplicationProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("name").textContent).toBe("Existing Name"));
  }

  it("hydrates the application on mount", async () => {
    await mount();
    expect(appRef.current.application?.id).toBe("app1");
    expect(appRef.current.locked).toBe(false);
  });

  it("debounces saves — one PATCH per burst of changes", async () => {
    await mount();

    // Three rapid edits within the 800ms debounce window.
    globalThis.fetch.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse(200, {
          id: "app1",
          user_id: "u1",
          status: "draft",
          completion_pct: 15,
          basic_full_name: "Third Name",
          created_at: "2026-04-19T00:00:00Z",
          updated_at: "2026-04-19T00:00:01Z",
        }),
      ),
    );

    act(() => {
      appRef.current.save({ fullName: "First" });
      appRef.current.save({ fullName: "Second" });
      appRef.current.save({ fullName: "Third Name" });
    });

    // Wait for the debounce + PATCH round-trip.
    await waitFor(() => expect(screen.getByTestId("saving").textContent).toBe("saved"), {
      timeout: 2500,
    });

    // Count fetches after mount: 1 auth/me + 1 get/me + 1 get submitted + 1 patch = 4 total.
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    const patchCall = globalThis.fetch.mock.calls[3];
    expect(patchCall[1].method).toBe("PATCH");
    // The coalesced body should be the LAST value, not the first two.
    expect(JSON.parse(patchCall[1].body)).toMatchObject({
      basic_full_name: "Third Name",
    });
  });

  it("loads submitted apps and sets tirClosed when the draft fetch is intake-closed", async () => {
    seedAuthedSession();
    const captured = {};
    const past = [{ id: "app-1", status: "under_review", submitted_at: "2026-06-15T00:00:00Z" }];
    globalThis.fetch
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { id: "u1", email: "u@x.com" }))) // /auth/me
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(200, past)))                            // /applications/me/submitted (now first)
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(403, { detail: { code: "tir_submissions_closed", message: "TIR intake closed" } }))); // /applications/me
    render(
      <AuthProvider>
        <ApplicationProvider>
          <Harness onReady={(a) => { captured.app = a; }} />
        </ApplicationProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(captured.app?.tirClosed).toBe(true));
    expect(captured.app.submittedApps).toHaveLength(1);
    expect(captured.app.submittedApps[0].id).toBe("app-1");
  });

  it("flips locked=true and refetches on 409", async () => {
    await mount();

    globalThis.fetch
      // PATCH → 409
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(409, { error: { code: "not_draft", message: "Already submitted" } }),
        ),
      )
      // follow-up GET /applications/me after 409
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(200, {
            id: "app1",
            user_id: "u1",
            status: "submitted",
            completion_pct: 100,
            submitted_at: "2026-04-19T02:00:00Z",
            created_at: "2026-04-19T00:00:00Z",
            updated_at: "2026-04-19T02:00:00Z",
          }),
        ),
      );

    act(() => {
      appRef.current.save({ fullName: "After submit" });
    });

    await waitFor(() => expect(screen.getByTestId("locked").textContent).toBe("true"), {
      timeout: 2500,
    });
    expect(appRef.current.application.status).toBe("submitted");
  });
});
