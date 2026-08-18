import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("FounderMou", () => {
  beforeEach(() => vi.restoreAllMocks());

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

  // ── review cards follow the agreement catalog, not a hardcoded list ─────
  describe("Review step renders one card per track agreement — catalog-driven", () => {
    it("shows only Facility when the catalog lists only Facility", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "FACILITY TEXT Aditi Rao" }],
      });
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user);
      await user.click(screen.getByRole("button", { name: /^review$/i }));
      await waitFor(() => expect(screen.getByText(/FACILITY TEXT/)).toBeInTheDocument());
      expect(screen.queryByText("Collaboration Agreement")).not.toBeInTheDocument();
    });

    it("adding a second entry to the catalog makes a second card appear with zero frontend code changes", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned({ agreements: TWO_AGREEMENTS }));
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [
          { slug: "facility-v1", name: "Facility Agreement", rendered_text: "FACILITY TEXT Aditi Rao" },
          { slug: "collaboration-v1", name: "Collaboration Agreement", rendered_text: "COLLAB TEXT Aditi Rao" },
        ],
      });
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user);
      await user.click(screen.getByRole("button", { name: /^review$/i }));
      await waitFor(() => expect(screen.getByText(/FACILITY TEXT/)).toBeInTheDocument());
      expect(screen.getByText(/COLLAB TEXT/)).toBeInTheDocument();
      expect(screen.getByText("Collaboration Agreement")).toBeInTheDocument();
    });
  });

  // ── 1-3 collaborators, dynamic, non-destructive add/remove ──────────────
  describe("1-3 collaborators, dynamic", () => {
    it("starts with one collaborator block and can add up to three", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByRole("button", { name: /add (another )?collaborator/i }));
      expect(screen.getAllByText(/collaborator 1/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/collaborator 2/i)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
      expect(screen.getByText(/collaborator 2/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
      expect(screen.getByText(/collaborator 3/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /add (another )?collaborator/i })).not.toBeInTheDocument();
    });

    it("cannot remove the last remaining collaborator", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      expect(screen.queryByRole("button", { name: /remove collaborator/i })).not.toBeInTheDocument();
    });

    it("adding a collaborator does not discard what was already typed into the first", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user);
      await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
      expect(screen.getByText(/collaborator 2/i)).toBeInTheDocument();
      // Field labels repeat verbatim from the backend catalog across
      // blocks (only the "Collaborator N" heading disambiguates them for a
      // sighted reader), so assert positionally: the FIRST "Full legal
      // name" input is still collaborator 1's, untouched by the add.
      expect(screen.getAllByLabelText("Full legal name")[0]).toHaveValue("Aditi Rao");
      expect(screen.getAllByLabelText("PAN")[0]).toHaveValue("ABCDE1234F");
      expect(screen.getAllByLabelText("Residential address")[0]).toHaveValue("12 MG Road");
    });

    it("removing a collaborator preserves the details already typed into the ones that remain", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      render(<FounderMou me={{}} />);
      await fillFirstCollaborator(user, ONE_COLLAB_FIELDS);
      await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
      await user.type(screen.getAllByLabelText("Full legal name")[1], "Kiran Shah");
      await user.click(screen.getByRole("button", { name: /add (another )?collaborator/i }));
      await user.type(screen.getAllByLabelText("Full legal name")[2], "Divya Nair");

      const removeButtons = screen.getAllByRole("button", { name: /remove collaborator/i });
      expect(removeButtons).toHaveLength(3);
      await user.click(removeButtons[1]); // remove Kiran Shah's (2nd) block

      expect(screen.queryByText(/kiran shah/i)).not.toBeInTheDocument();
      const remaining = screen.getAllByLabelText("Full legal name");
      expect(remaining).toHaveLength(2);
      expect(remaining[0]).toHaveValue("Aditi Rao");
      expect(remaining[1]).toHaveValue("Divya Nair");
    });
  });

  // ── Review step calls the preview endpoint ───────────────────────────────
  describe("Review step calls the preview endpoint", () => {
    it("advancing to Review sends the entered collaborators and shows the returned text", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "FACILITY AGREEMENT ... Aditi Rao ..." }],
      });
      render(<FounderMou me={{}} />);
      await waitFor(() => screen.getByLabelText("Full legal name"));
      await user.type(screen.getByLabelText("Full legal name"), "Aditi Rao");
      await user.type(screen.getByLabelText("PAN"), "ABCDE1234F");
      await user.type(screen.getByLabelText("Father's / Mother's / Spouse's name (s/o, d/o)"), "Suresh Rao");
      await user.type(screen.getByLabelText("Residential address"), "12 MG Road");
      await user.click(screen.getByRole("button", { name: /^review$/i }));
      await waitFor(() => expect(founderApi.previewMou).toHaveBeenCalledWith([
        { name: "Aditi Rao", pan: "ABCDE1234F", parent_name: "Suresh Rao", address: "12 MG Road" },
      ]));
      expect(screen.getByText(/Aditi Rao/)).toBeInTheDocument();
    });
  });

  // ── PAN is validated server-side; the specific field error must surface ──
  describe("server-side PAN validation surfaces a specific field error", () => {
    it("shows the regex-driven message next to the PAN field, not a generic failure", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMou").mockRejectedValue({
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
    });
  });

  // ── acknowledgement gating (carried over from the pre-rewrite suite) ────
  describe("acknowledgement gating on the Sign step", () => {
    it("renders one checkbox per server-supplied acknowledgement", async () => {
      const user = userEvent.setup();
      vi.spyOn(founderApi, "getMou").mockResolvedValue(unsigned());
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
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
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
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
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
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
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
      vi.spyOn(founderApi, "signMou").mockResolvedValue({ signed: true, signed_at: "2026-08-18T00:00:00Z", status: "onboarded" });
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
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
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
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
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
      vi.spyOn(founderApi, "previewMou").mockResolvedValue({
        previews: [{ slug: "facility-v1", name: "Facility Agreement", rendered_text: "text" }],
      });
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

  // ── Download: one action per track agreement, distinct copy per state ───
  describe("Download step", () => {
    it("offers each track agreement individually", async () => {
      vi.spyOn(founderApi, "getMou").mockResolvedValue(
        unsigned({ agreements: TWO_AGREEMENTS, signed: true, signer_name: "Priya", signed_at: "2026-08-18T00:00:00Z" }),
      );
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
});
