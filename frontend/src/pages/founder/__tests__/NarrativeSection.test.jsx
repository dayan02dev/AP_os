import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NarrativeSection from "../components/NarrativeSection.jsx";

const FIELDS = [
  { id: "exec.headline_win", prompt: "Headline win" },
  { id: "exec.biggest_concern", prompt: "Biggest concern" },
];

describe("NarrativeSection", () => {
  it("renders each field's prompt and current value", () => {
    render(
      <NarrativeSection
        fields={FIELDS}
        values={{ "exec.headline_win": "Closed our first pilot", "exec.biggest_concern": "Cash" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Headline win")).toBeInTheDocument();
    expect(screen.getByText("Biggest concern")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Closed our first pilot")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Cash")).toBeInTheDocument();
  });

  it("renders an empty textarea for a field missing from values", () => {
    render(<NarrativeSection fields={FIELDS} values={{}} onChange={() => {}} />);
    const textarea = screen.getByLabelText("Headline win");
    expect(textarea).toHaveValue("");
  });

  it("blur after typing calls onChange(fieldId, typed text)", () => {
    const onChange = vi.fn();
    render(<NarrativeSection fields={FIELDS} values={{}} onChange={onChange} />);
    const textarea = screen.getByLabelText("Headline win");
    fireEvent.change(textarea, { target: { value: "New text" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("exec.headline_win", "New text");
  });

  it("blur after clearing calls onChange(fieldId, null), never empty string", () => {
    const onChange = vi.fn();
    render(
      <NarrativeSection
        fields={FIELDS}
        values={{ "exec.headline_win": "Something" }}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByLabelText("Headline win");
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith("exec.headline_win", null);
  });

  it("typing without blurring fires onChange zero times", () => {
    const onChange = vi.fn();
    render(<NarrativeSection fields={FIELDS} values={{}} onChange={onChange} />);
    const textarea = screen.getByLabelText("Headline win");
    fireEvent.change(textarea, { target: { value: "a" } });
    fireEvent.change(textarea, { target: { value: "ab" } });
    fireEvent.change(textarea, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled makes every textarea read-only and swallows blur attempts to fire onChange", () => {
    const onChange = vi.fn();
    render(
      <NarrativeSection
        fields={FIELDS}
        values={{ "exec.headline_win": "Something" }}
        disabled
        onChange={onChange}
      />,
    );
    const textareas = screen.getAllByRole("textbox");
    expect(textareas.length).toBe(2);
    for (const t of textareas) expect(t).toBeDisabled();
    const textarea = screen.getByLabelText("Headline win");
    fireEvent.change(textarea, { target: { value: "attempted edit" } });
    fireEvent.blur(textarea);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("catalog-driven: renaming a fixture prompt makes the new text appear", () => {
    const renamed = FIELDS.map((f) =>
      f.id === "exec.biggest_concern" ? { ...f, prompt: "Totally reworded prompt" } : f,
    );
    render(<NarrativeSection fields={renamed} values={{}} onChange={() => {}} />);
    expect(screen.getByText("Totally reworded prompt")).toBeInTheDocument();
    expect(screen.queryByText("Biggest concern")).not.toBeInTheDocument();
  });
});
