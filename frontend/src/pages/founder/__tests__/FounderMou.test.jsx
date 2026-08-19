import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FounderMou from "../FounderMou.jsx";
import { founderApi } from "../../../lib/founderApi.js";

const ACKS = [
  { id: "full_time_presence", text: "I acknowledge that ARTPARK Technology in Residence is a full time program…" },
  { id: "first_right_of_refusal", text: "I acknowledge that ARTPARK Residency program provides ARTPARK the first right of refusal…" },
  { id: "expense_account_procurement", text: "I acknowledge that ARTPARK Residency program is an expense account…" },
  { id: "additional_funding_equity", text: "I acknowledge that post the initial 25L…" },
];
const ACK_IDS = ACKS.map((a) => a.id);

const FACILITY_FIELDS = [
  { key: "name", label: "Full legal name" },
  { key: "pan", label: "PAN" },
  { key: "parent_name", label: "Father's / Mother's / Spouse's name (s/o, d/o)" },
  { key: "address", label: "Residential address" },
];

const ONE_AGREEMENT = [
  { slug: "facility-v1", name: "Facility Agreement", min_collaborators: 1, max_collaborators: 3, fields: FACILITY_FIELDS },
];
const TWO_AGREEMENTS = [
  ...ONE_AGREEMENT,
  { slug: "collaboration-v1", name: "Collaboration Agreement", min_collaborators: 1, max_collaborators: 3, fields: FACILITY_FIELDS },
];

const unsigned = (over = {}) => ({
  template_version: "facility-v1,collaboration-v1",
  agreements: ONE_AGREEMENT,
  signed: false,
  signer_name: "",
  signed_at: null,
  acknowledgements: ACKS,
  accepted_acknowledgements: [],
  ...over,
});

function mockCanvas() {
  const ctx = {
    lineWidth: 0, lineCap: "", strokeStyle: "",
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
  return ctx;
}

function drawOnPad() {
  const canvas = document.querySelector("canvas#sigpad");
  fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5 });
  fireEvent.pointerMove(canvas, { clientX: 25, clientY: 25 });
}

const ONE_COLLAB_FIELDS = {
  name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road",
};

// A real (small) PDF-shaped Blob — the component never reads its bytes in
// tests (URL.createObjectURL is stubbed below), it just needs to be a Blob.
function fakePdfBlob(label = "pdf") {
  return new Blob([`%PDF-1.4 ${label}`], { type: "application/pdf" });
}

async function fillFirstCollaborator(user, values = ONE_COLLAB_FIELDS) {
  await waitFor(() => screen.getByLabelText("Full legal name"));
  await user.type(screen.getByLabelText("Full legal name"), values.name);
  await user.type(screen.getByLabelText("PAN"), values.pan);
  await user.type(screen.getByLabelText("Father's / Mother's / Spouse's name (s/o, d/o)"), values.parent_name);
  await user.type(screen.getByLabelText("Residential address"), values.address);
}

async function goToSignStep(user) {
  await fillFirstCollaborator(user);
  await user.click(screen.getByRole("button", { name: /^review$/i }));
  await waitFor(() => screen.getByRole("button", { name: /continue to sign/i }));
  await user.click(screen.getByRole("button", { name: /continue to sign/i }));
  await waitFor(() => screen.getByText(/sign & submit/i));
}

async function tickAllAcks(user) {
  for (const b of screen.getAllByRole("checkbox")) await user.click(b);
}

// ── jsdom has no real URL.createObjectURL/revokeObjectURL — stub them and
// track every call so the revocation tests can assert real behaviour
// (which URL was created, which was revoked, in what order) rather than
// just "didn't throw".
let createdUrls;
let revokedUrls;
let urlCounter;

function stubBlobUrls() {
  urlCounter = 0;
  createdUrls = [];
  revokedUrls = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:mock-${++urlCounter}`;
    createdUrls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url) => revokedUrls.push(url));
}

describe("FounderMou", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    stubBlobUrls();
  });

  // NOT afterEach: React Testing Library's own automatic-cleanup afterEach
  // (registered at module import time, outside any describe block) unmounts
  // components AFTER this describe block's afterEach would run — an
  // afterEach here would delete the stubs before that unmount's own
  // revokeObjectURL call runs, throwing "not a function". afterAll avoids
  // the ordering problem entirely; each test's beforeEach already installs
  // fresh stubs regardless.
  afterAll(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  // ── three distinct MOU states (empty-state discipline) ──────────────────
  describe("three distinct MOU states", () => {
    it("shows Not started when the wizard hasn't been opened", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => expect(screen.getByText(/not started/i)).toBeInTheDocument());
    });

    it("shows a distinct Incomplete state once some fields are entered but not all", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      await user.type(screen.getByLabelText("Full legal name"), "Aditi Rao");
      expect(screen.getByText(/incomplete/i)).toBeInTheDocument();
      expect(screen.queryByText(/not started/i)).not.toBeInTheDocument();
    });

    it("shows the Signed state with a download action, and no editable fields", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(
        unsigned({ signed: true, signer_name: "Priya", signed_at: "2026-08-18T00:00:00Z" }),
      );
      vi.spyOn(founderApi, "mouSignedUrl").mockResolvedValue({ url: "https://x/signed.pdf" });
      render(<FounderMou me={{}} />);
      await waitFor(() => expect(screen.getByText(/agreements signed/i)).toBeInTheDocument());
      expect(screen.getByText(/download/i)).toBeInTheDocument();
      expect(screen.queryByLabelText("Full legal name")).not.toBeInTheDocument();
    });
  });

  // ── catalog-driven field labels ──────────────────────────────────────────
  describe("collaborator fields are catalog-driven", () => {
    it("renders every field label from the backend catalog, not hardcoded copy", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => expect(screen.getByLabelText("Full legal name")).toBeInTheDocument());
      expect(screen.getByLabelText("PAN")).toBeInTheDocument();
      expect(screen.getByLabelText(/s\/o, d\/o/i)).toBeInTheDocument();
      expect(screen.getByLabelText("Residential address")).toBeInTheDocument();
    });

    it("a renamed catalog field label flows through to the screen with no frontend change", async () => {
      const renamed = unsigned({
        agreements: [{
          ...ONE_AGREEMENT[0],
          fields: FACILITY_FIELDS.map((f) => (f.key === "pan" ? { ...f, label: "Permanent Account Number" } : f)),
        }],
      });
      vi.spyOn(founderApi, "getMou").mockResolvedValue(renamed);
      render(<FounderMou me={{}} />);
      await waitFor(() => expect(screen.getByLabelText(/permanent account number/i)).toBeInTheDocument());
    });
  });

  // ── Review/Sign steps embed the ACTUAL PDF, catalog-driven per track ────
  describe("Review step embeds the live PDF, one document per track agreement", () => {
    it("embeds the previewed PDF for a single-agreement track and shows no tabs", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob("facility"));
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user);
      await user.click(screen.getByRole("button", { name: /^review$/i }));

      await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
      expect(founderApi.previewMouPdf).toHaveBeenCalledWith(
        "facility-v1",
        expect.objectContaining({
          collaborators: [{ name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" }],
        }),
      );
    });

    it("a second track agreement gets its own tab, and switching fetches that agreement's own document", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({ agreements: TWO_AGREEMENTS }));
      vi.spyOn(founderApi, "previewMouPdf").mockImplementation(async (slug) => fakePdfBlob(slug));
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user);
      await user.click(screen.getByRole("button", { name: /^review$/i }));
      await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());

      expect(screen.getByRole("tab", { name: "Facility Agreement" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Collaboration Agreement" })).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "Collaboration Agreement" }));
      await waitFor(() => expect(founderApi.previewMouPdf).toHaveBeenLastCalledWith(
        "collaboration-v1", expect.anything(),
      ));
    });

    it("advancing to Review validates via the live PDF endpoint with what was typed", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      await user.type(screen.getByLabelText("Full legal name"), "Aditi Rao");
      await user.type(screen.getByLabelText("PAN"), "ABCDE1234F");
      await user.type(screen.getByLabelText("Father's / Mother's / Spouse's name (s/o, d/o)"), "Suresh Rao");
      await user.type(screen.getByLabelText("Residential address"), "12 MG Road");
      await user.click(screen.getByRole("button", { name: /^review$/i }));
      await waitFor(() => expect(founderApi.previewMouPdf).toHaveBeenCalledWith(
        "facility-v1",
        expect.objectContaining({
          collaborators: [{ name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" }],
        }),
      ));
      await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    });
  });

  // ── PAN is validated server-side; the specific field error must surface ──
  describe("server-side PAN validation surfaces a specific field error", () => {
    it("shows the regex-driven message next to the PAN field, not a generic failure", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockRejectedValue({
        code: "http_422",
        message: "Request failed",
        details: [
          {
            type: "value_error",
            loc: ["body", "collaborators", 0, "pan"],
            msg: "Value error, PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)",
          },
        ],
      });
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user, { ...ONE_COLLAB_FIELDS, pan: "1234567890" });
      await user.click(screen.getByRole("button", { name: /^review$/i }));
      await waitFor(() =>
        expect(screen.getByText(/PAN must be 5 letters, 4 digits, 1 letter/i)).toBeInTheDocument(),
      );
      expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument();
      // Stayed on Details — the field error only renders there.
      expect(screen.getByLabelText("Full legal name")).toBeInTheDocument();
    });
  });

  // ── acknowledgement gating (carried over from the pre-rewrite suite) ────
  describe("acknowledgement gating on the Sign step", () => {
    it("renders one checkbox per server-supplied acknowledgement", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      expect(screen.getAllByRole("checkbox")).toHaveLength(4);
      expect(screen.getByText(/full time program/i)).toBeInTheDocument();
      expect(screen.getByText(/first right of refusal/i)).toBeInTheDocument();
      expect(screen.getByText(/expense account/i)).toBeInTheDocument();
      expect(screen.getByText(/post the initial 25L/i)).toBeInTheDocument();
    });

    it("keeps Sign disabled until every acknowledgement is ticked", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);

      const signBtn = screen.getByRole("button", { name: /sign & submit/i });
      const boxes = screen.getAllByRole("checkbox");
      expect(signBtn).toBeDisabled();

      for (const b of boxes.slice(0, 3)) await user.click(b);
      expect(signBtn).toBeDisabled();
      expect(screen.getByText(/must be confirmed before you can sign/i)).toBeInTheDocument();

      await user.click(boxes[3]);
      expect(screen.queryByText(/must be confirmed before you can sign/i)).not.toBeInTheDocument();
    });

    it("unticking an acknowledgement re-blocks signing", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);

      const boxes = screen.getAllByRole("checkbox");
      for (const b of boxes) await user.click(b);
      expect(screen.queryByText(/must be confirmed before you can sign/i)).not.toBeInTheDocument();

      await user.click(boxes[1]);
      expect(screen.getByText(/must be confirmed before you can sign/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /sign & submit/i })).toBeDisabled();
    });
  });

  // ── the real sign() flow, canvas mocked so hasInk can actually flip ─────
  describe("signing", () => {
    it("sends collaborators + acknowledgements + signature together, then shows the signed state", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou")
        .mockResolvedValueOnce(unsigned())
        .mockResolvedValueOnce(unsigned({ signed: true, signer_name: "Aditi Rao", signed_at: "2026-08-18T00:00:00Z" }));
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      vi.spyOn(founderApi, "signMou").mockResolvedValue({ signed: true, signed_at: "2026-08-18T00:00:00Z", status: "onboarded" });
      vi.spyOn(founderApi, "mouSignedUrl").mockResolvedValue({ url: "https://x/signed.pdf" });
      const onSigned = vi.fn();

      render(<FounderMou me={{}} onSigned={onSigned} />);
      await goToSignStep(user);
      await tickAllAcks(user);
      await user.type(screen.getByPlaceholderText(/full name/i), "Aditi Rao");
      drawOnPad();

      await user.click(screen.getByRole("button", { name: /sign & submit/i }));

      await waitFor(() => expect(founderApi.signMou).toHaveBeenCalledWith(
        "Aditi Rao",
        "data:image/png;base64,AAAA",
        expect.arrayContaining(ACK_IDS),
        [{ name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" }],
        "", // no venture name -- me={{}} has no project_name and none was typed
      ));
      await waitFor(() => expect(screen.getByText(/agreements signed/i)).toBeInTheDocument());
      expect(onSigned).toHaveBeenCalled();
    });

    it("a 409 conflict refetches and lands on the signed view instead of a dead-end error", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou")
        .mockResolvedValueOnce(unsigned())
        .mockResolvedValueOnce(unsigned({ signed: true, signer_name: "Someone Else", signed_at: "2026-08-18T00:00:00Z" }));
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      vi.spyOn(founderApi, "mouSignedUrl").mockResolvedValue({ url: "https://x/signed.pdf" });
      vi.spyOn(founderApi, "signMou").mockRejectedValue({
        code: "mou_already_signed", message: "Request failed", details: { code: "mou_already_signed" },
      });

      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      await tickAllAcks(user);
      await user.type(screen.getByPlaceholderText(/full name/i), "Aditi Rao");
      drawOnPad();
      await user.click(screen.getByRole("button", { name: /sign & submit/i }));

      await waitFor(() => expect(screen.getByText(/agreements signed/i)).toBeInTheDocument());
      expect(screen.getByText(/someone else/i)).toBeInTheDocument();
      expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument();
    });

    it("surfaces the server's own explanation for an invalid signature, not a generic failure", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      vi.spyOn(founderApi, "signMou").mockRejectedValue({
        code: "invalid_signature",
        message: "decoded signature is not a PNG",
        details: { code: "invalid_signature", message: "decoded signature is not a PNG" },
      });

      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      await tickAllAcks(user);
      await user.type(screen.getByPlaceholderText(/full name/i), "Aditi Rao");
      drawOnPad();
      await user.click(screen.getByRole("button", { name: /sign & submit/i }));

      await waitFor(() => expect(screen.getByText(/decoded signature is not a png/i)).toBeInTheDocument());
      expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument();
    });

    it("maps a server-side acknowledgements_required rejection to real copy", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      vi.spyOn(founderApi, "signMou").mockRejectedValue({
        code: "acknowledgements_required",
        message: "Request failed",
        details: { code: "acknowledgements_required", missing: ["full_time_presence"] },
      });

      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      await tickAllAcks(user);
      await user.type(screen.getByPlaceholderText(/full name/i), "Aditi Rao");
      drawOnPad();
      await user.click(screen.getByRole("button", { name: /sign & submit/i }));

      await waitFor(() => expect(screen.getByText(/confirm every acknowledgement/i)).toBeInTheDocument());
      expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument();
    });
  });

  // ── the signature appears in the live document once drawn ───────────────
  describe("the signature appears in the previewed document once drawn", () => {
    it("the preview fetch carries no signature before drawing, and the drawn one after", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);

      await waitFor(() => expect(founderApi.previewMouPdf).toHaveBeenCalledWith(
        "facility-v1",
        expect.objectContaining({ signaturePng: null }),
      ));

      founderApi.previewMouPdf.mockClear();
      drawOnPad();

      await waitFor(
        () => expect(founderApi.previewMouPdf).toHaveBeenCalledWith(
          "facility-v1",
          expect.objectContaining({ signaturePng: "data:image/png;base64,AAAA" }),
        ),
        { timeout: 2000 },
      );
    }, 10000);
  });

  // ── debounce: rapid edits must not fire one request per keystroke ───────
  describe("live preview is debounced", () => {
    it("collapses several rapid signer-name edits into a single re-fetch", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      await waitFor(() => expect(founderApi.previewMouPdf).toHaveBeenCalled());

      founderApi.previewMouPdf.mockClear();
      const nameField = screen.getByPlaceholderText(/full name/i);
      fireEvent.change(nameField, { target: { value: "A" } });
      fireEvent.change(nameField, { target: { value: "Ad" } });
      fireEvent.change(nameField, { target: { value: "Adi" } });
      fireEvent.change(nameField, { target: { value: "Adit" } });
      fireEvent.change(nameField, { target: { value: "Aditi" } });

      // Still well within the ~700ms debounce window.
      await new Promise((r) => setTimeout(r, 300));
      expect(founderApi.previewMouPdf).not.toHaveBeenCalled();

      // Past it — exactly one re-fetch for five keystrokes, with the FINAL value.
      await waitFor(() => expect(founderApi.previewMouPdf).toHaveBeenCalledTimes(1), { timeout: 2000 });
      await new Promise((r) => setTimeout(r, 200));
      expect(founderApi.previewMouPdf).toHaveBeenCalledTimes(1);
      expect(founderApi.previewMouPdf).toHaveBeenCalledWith(
        "facility-v1",
        expect.objectContaining({ signerName: "Aditi" }),
      );
    }, 10000);
  });

  // ── stale-response guard: an out-of-order response must never win ───────
  describe("a superseded (stale) preview response never overwrites a newer one", () => {
    it("ignores an older request that resolves after a newer one", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({ agreements: TWO_AGREEMENTS }));

      const deferreds = [];
      vi.spyOn(founderApi, "previewMouPdf").mockImplementation(() => {
        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        deferreds.push({ promise, resolve });
        return promise;
      });

      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user);
      await user.click(screen.getByRole("button", { name: /^review$/i }));

      // Call #0: goToReview's own validation fetch — resolve it to advance.
      await waitFor(() => expect(deferreds.length).toBe(1));
      deferreds[0].resolve(fakePdfBlob("validation"));
      await waitFor(() => screen.getByRole("tab", { name: "Collaboration Agreement" }));

      // Call #1: the OLDER display fetch for the default (facility) tab —
      // leave it pending.
      await waitFor(() => expect(deferreds.length).toBe(2));

      // Switch tabs before it resolves — call #2, the NEWER request.
      await user.click(screen.getByRole("tab", { name: "Collaboration Agreement" }));
      await waitFor(() => expect(deferreds.length).toBe(3));

      // Resolve OUT OF ORDER: newer settles first, older settles after.
      deferreds[2].resolve(fakePdfBlob("newer-collab-doc"));
      await waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
      const urlAfterNewer = document.querySelector("iframe").src;

      deferreds[1].resolve(fakePdfBlob("older-facility-doc"));
      await new Promise((r) => setTimeout(r, 50)); // let the late resolution be processed, if it's going to be

      expect(document.querySelector("iframe").src).toBe(urlAfterNewer);
    });
  });

  // ── blob URL lifecycle: revoked on replace, revoked on unmount ──────────
  describe("blob URL lifecycle", () => {
    it("revokes the previous object URL when the preview is replaced by a newer one", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);

      await waitFor(() => expect(createdUrls.length).toBeGreaterThanOrEqual(1));
      const countBefore = createdUrls.length;
      const firstUrl = createdUrls[createdUrls.length - 1];
      expect(revokedUrls).not.toContain(firstUrl);

      drawOnPad(); // triggers another (debounced) fetch — a new document to embed
      await waitFor(() => expect(createdUrls.length).toBeGreaterThan(countBefore), { timeout: 2000 });

      expect(revokedUrls).toContain(firstUrl);
    }, 10000);

    it("revokes the current object URL when the component unmounts", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      const { unmount } = render(<FounderMou me={{}} />);
      await goToSignStep(user);
      await waitFor(() => expect(createdUrls.length).toBeGreaterThanOrEqual(1));
      const lastUrl = createdUrls[createdUrls.length - 1];
      expect(revokedUrls).not.toContain(lastUrl);

      unmount();
      expect(revokedUrls).toContain(lastUrl);
    });
  });

  // ── Download step: one action per track agreement, distinct copy per state ───
  describe("Download step", () => {
    it("offers each track agreement individually", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(
        unsigned({ agreements: TWO_AGREEMENTS, signed: true, signer_name: "Priya", signed_at: "2026-08-18T00:00:00Z" }),
      );
      vi.spyOn(founderApi, "mouSignedUrl").mockResolvedValue({ url: "https://x/doc.pdf" });
      render(<FounderMou me={{}} />);
      await waitFor(() => expect(screen.getByText(/agreements signed/i)).toBeInTheDocument());
      expect(screen.getByRole("button", { name: /download facility agreement/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /download collaboration agreement/i })).toBeInTheDocument();
    });

    it("clicking a document's download button fetches that agreement's own signed url", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(
        unsigned({ agreements: TWO_AGREEMENTS, signed: true, signer_name: "Priya", signed_at: "2026-08-18T00:00:00Z" }),
      );
      vi.spyOn(founderApi, "mouSignedUrl").mockResolvedValue({ url: "https://x/collab.pdf" });
      vi.spyOn(window, "open").mockImplementation(() => {});
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByRole("button", { name: /download collaboration agreement/i }));
      await user.click(screen.getByRole("button", { name: /download collaboration agreement/i }));
      await waitFor(() => expect(founderApi.mouSignedUrl).toHaveBeenCalledWith("collaboration-v1"));
      expect(window.open).toHaveBeenCalledWith("https://x/collab.pdf", "_blank", "noopener");
    });

    it("a document that wasn't part of what was signed gets its own copy, not a broken download", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({
        agreements: TWO_AGREEMENTS, signed: true, signer_name: "OOOO",
        signed_at: "2026-08-13T00:00:00Z", template_version: "tir-mou-v2",
      }));
      vi.spyOn(founderApi, "mouSignedUrl").mockImplementation((slug) =>
        slug === "facility-v1"
          ? Promise.reject({ code: "agreement_not_signed", message: "Request failed", details: { code: "agreement_not_signed", agreement: "facility-v1" } })
          : Promise.resolve({ url: "https://x/default.pdf" }),
      );
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByRole("button", { name: /download facility agreement/i }));
      await user.click(screen.getByRole("button", { name: /download facility agreement/i }));
      await waitFor(() => expect(screen.getByText(/not part of what you signed/i)).toBeInTheDocument());
      expect(screen.queryByText(/request failed/i)).not.toBeInTheDocument();
    });
  });

  // ── original source .docx download (MOU tab rebuild) ────────────────────
  describe("original source .docx download", () => {
    it("offers a Download the original link for every track agreement, before any details are filled in", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({ agreements: TWO_AGREEMENTS }));
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      expect(screen.getByRole("button", { name: /download the original.*facility agreement/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /download the original.*collaboration agreement/i })).toBeInTheDocument();
    });

    it("clicking a document's original-download button fetches that agreement's own .docx", async () => {
      const user = userEvent.setup();
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      // Returns {url} — a signed storage URL, not the file. The
      // Collaboration Agreement is 7.9MB and API Gateway caps a Lambda
      // response at 6MB, so the bytes cannot come back through the API.
      vi.spyOn(founderApi, "mouSourceDocx").mockResolvedValue({ url: "https://signed.example/facility.docx" });
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      render(<FounderMou me={{}} />);
      const btn = await screen.findByRole("button", { name: /download the original.*facility agreement/i });
      await user.click(btn);
      await waitFor(() => expect(founderApi.mouSourceDocx).toHaveBeenCalledWith("facility-v1"));
      // Asserting the call alone would pass against any implementation,
      // including one that drops the response on the floor. Prove the URL
      // is actually followed.
      await waitFor(() =>
        expect(openSpy).toHaveBeenCalledWith("https://signed.example/facility.docx", "_blank", "noopener"),
      );
    });

    it("a failed original download gets its own error, distinct from the not-yet-downloaded default", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "mouSourceDocx").mockRejectedValue({ code: "network_error", message: "Network error" });
      render(<FounderMou me={{}} />);
      const btn = await screen.findByRole("button", { name: /download the original.*facility agreement/i });
      // Idle default: no error text at all before the click.
      expect(screen.queryByText(/couldn.t reach the server/i)).not.toBeInTheDocument();
      await user.click(btn);
      await waitFor(() => expect(screen.getByText(/couldn.t reach the server/i)).toBeInTheDocument());
    });
  });

  // ── ARTPARK constants render as read-only context, never an input ───────
  // Shown on the DETAILS step itself, grouped the way the document groups
  // them, so filling the form reads like walking the agreement — not
  // hidden behind Review.
  describe("ARTPARK-owned blanks render as read-only context, grouped by document section", () => {
    const FACILITY_CONSTANTS_UNSET = [
      { key: "collaboration_agreement_date", label: "Date the Collaboration Agreement was signed", owner: "artpark", section: "Agreement terms", value: null },
      { key: "term_months", label: "Facility Agreement term length (months)", owner: "artpark", section: "Agreement terms", value: null },
      { key: "availability_windows.dedicated_seating", label: "Availability window — Dedicated Seating", owner: "artpark", section: "Facilities schedule (Schedule II)", value: null },
    ];

    it("shows the label and a distinct blank-state message when ARTPARK hasn't set a value yet, right on the Details step", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({
        agreements: [{ ...ONE_AGREEMENT[0], constants: FACILITY_CONSTANTS_UNSET }],
      }));
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));

      expect(screen.getByText("Facility Agreement term length (months)")).toBeInTheDocument();
      expect(screen.getAllByText(/not yet set by artpark/i).length).toBeGreaterThan(0);
      // Never an editable input for an ARTPARK constant.
      expect(screen.queryByLabelText(/facility agreement term length/i)).not.toBeInTheDocument();
    });

    it("groups constants into the document's own sections, in document order", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({
        agreements: [{ ...ONE_AGREEMENT[0], constants: FACILITY_CONSTANTS_UNSET }],
      }));
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));

      expect(screen.getByText("Agreement terms")).toBeInTheDocument();
      expect(screen.getByText("Facilities schedule (Schedule II)")).toBeInTheDocument();
      // Order: "Agreement terms" section content precedes the schedule's.
      const html = document.body.innerHTML;
      expect(html.indexOf("Facility Agreement term length")).toBeLessThan(
        html.indexOf("Dedicated Seating"),
      );
    });

    it("shows the real value, read-only, once ARTPARK has configured a constant", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({
        agreements: [{
          ...ONE_AGREEMENT[0],
          constants: [
            { key: "term_months", label: "Facility Agreement term length (months)", owner: "artpark", section: "Agreement terms", value: 6 },
          ],
        }],
      }));
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));

      expect(screen.getByText("6")).toBeInTheDocument();
      expect(screen.queryByText(/not yet set by artpark/i)).not.toBeInTheDocument();
    });
  });

  // ── the fields UI itself: grouped, labelled, sensibly typed ─────────────
  describe("collaborator fields UI (highest-value surface: what the founder types into)", () => {
    it("shows only ONE collaborator card up front — a second/third is a deliberate add, not three blank blocks", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      expect(screen.getAllByLabelText("Full legal name")).toHaveLength(1);
      expect(screen.queryByText(/^collaborator 2/i)).not.toBeInTheDocument();
    });

    it("marks each founder-editable field as required", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      expect(screen.getByLabelText("Full legal name")).toHaveAttribute("aria-required", "true");
      expect(screen.getByLabelText("PAN")).toHaveAttribute("aria-required", "true");
    });

    it("renders the address field as a multi-line textarea, not a single-line input", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      expect(screen.getByLabelText("Residential address").tagName).toBe("TEXTAREA");
    });

    it("auto-uppercases the PAN as it's typed", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      await user.type(screen.getByLabelText("PAN"), "abcde1234f");
      expect(screen.getByLabelText("PAN")).toHaveValue("ABCDE1234F");
    });

    it("shows a progress indicator for how many collaborators are complete", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      expect(screen.getByText(/0.*of.*1.*collaborator/i)).toBeInTheDocument();
      await fillFirstCollaborator(user);
      expect(screen.getByText(/1.*of.*1.*collaborator/i)).toBeInTheDocument();
    });

    it("removing a collaborator does not touch what was typed into the others", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user, { name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" });
      await user.click(screen.getByRole("button", { name: /add another collaborator/i }));
      await waitFor(() => screen.getAllByLabelText("Full legal name"));
      const [, secondName] = screen.getAllByLabelText("Full legal name");
      await user.type(secondName, "Kiran Shah");

      await user.click(screen.getAllByRole("button", { name: /remove collaborator/i })[0]);

      await waitFor(() => expect(screen.getAllByLabelText("Full legal name")).toHaveLength(1));
      expect(screen.getByLabelText("Full legal name")).toHaveValue("Kiran Shah");
    });
  });

  // ── acknowledgements are ARTPARK's own terms, kept visibly separate ─────
  describe("acknowledgements are framed as separate from the documents", () => {
    it("names them as ARTPARK's own program terms, not clauses in the agreements above", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      expect(screen.getByText(/artpark.s own program terms/i)).toBeInTheDocument();
    });
  });

  // ── venture name — printed on the signature page only ────────────────────
  describe("venture name (printed on the signature page, never inside the agreements)", () => {
    it("prefills from the founder's known project name and stays editable", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{ project_name: "Sarva Robotics" }} />);
      await goToSignStep(user);
      const field = screen.getByLabelText(/venture.*startup name/i);
      expect(field).toHaveValue("Sarva Robotics");
      await user.clear(field);
      await user.type(field, "Renamed Venture");
      expect(field).toHaveValue("Renamed Venture");
    });

    it("is not required to enable signing", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{}} />);
      await goToSignStep(user);
      await tickAllAcks(user);
      await user.type(screen.getByPlaceholderText(/full name/i), "Aditi Rao");
      drawOnPad();
      expect(screen.getByRole("button", { name: /sign & submit/i })).not.toBeDisabled();
    });

    it("flows into the live preview once on the Sign step", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      render(<FounderMou me={{ project_name: "Sarva Robotics" }} />);
      await goToSignStep(user);
      await waitFor(() => expect(founderApi.previewMouPdf).toHaveBeenCalledWith(
        "facility-v1", expect.objectContaining({ ventureName: "Sarva Robotics" }),
      ));
    });

    it("flows into the final sign() call", async () => {
      const user = userEvent.setup();
      mockCanvas();
      vi.spyOn(founderApi, "getMou")
        .mockResolvedValueOnce(unsigned())
        .mockResolvedValueOnce(unsigned({ signed: true, signer_name: "Aditi Rao", signed_at: "2026-08-18T00:00:00Z" }));
      vi.spyOn(founderApi, "previewMouPdf").mockResolvedValue(fakePdfBlob());
      vi.spyOn(founderApi, "signMou").mockResolvedValue({ signed: true, signed_at: "2026-08-18T00:00:00Z", status: "onboarded" });
      vi.spyOn(founderApi, "mouSignedUrl").mockResolvedValue({ url: "https://x/signed.pdf" });

      render(<FounderMou me={{ project_name: "Sarva Robotics" }} />);
      await goToSignStep(user);
      await tickAllAcks(user);
      await user.type(screen.getByPlaceholderText(/full name/i), "Aditi Rao");
      drawOnPad();
      await user.click(screen.getByRole("button", { name: /sign & submit/i }));

      await waitFor(() => expect(founderApi.signMou).toHaveBeenCalledWith(
        "Aditi Rao",
        "data:image/png;base64,AAAA",
        expect.arrayContaining(ACK_IDS),
        [{ name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" }],
        "Sarva Robotics",
      ));
    });
  });
});
