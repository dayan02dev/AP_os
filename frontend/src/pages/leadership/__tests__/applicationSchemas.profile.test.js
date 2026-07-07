import { describe, it, expect } from "vitest";
import { schemaFor } from "../applicationSchemas.js";

describe("Basic details includes résumé + LinkedIn", () => {
  for (const track of ["tir", "sip"]) {
    it(`${track}: section 01 has a resume_file (file) and linkedin_url (link)`, () => {
      const schema = schemaFor(track);
      const basic = schema.find((s) => s.section_number === "01");
      const byKey = Object.fromEntries(basic.questions.map((q) => [q.key, q]));
      expect(byKey.resume_file?.type).toBe("file");
      expect(byKey.linkedin_url?.type).toBe("link");
    });
  }
});
