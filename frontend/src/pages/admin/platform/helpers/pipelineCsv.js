// Pure CSV builder for the pipeline export. No DOM. Extracted from the
// (now removed) divergent AdminPipeline component so the ported screen + its
// test can share it without depending on dead code.

function prettify(v) {
  if (!v) return "";
  return String(v)
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const CSV_HEADERS = [
  "ID",
  "Track",
  "Name",
  "Founder",
  "Industry",
  "Stage",
  "AI Score",
  "Status",
  "Decision",
  "Batch",
  "Submitted",
];

function csvCell(v) {
  const str = v == null ? "" : String(v);
  return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

export function buildPipelineCsv(rows) {
  const lines = (rows || []).map((r) => [
    r?.applicationId ?? r?.id ?? "",
    r?.track === "sip" ? "SIP" : r?.track === "tir" ? "TIR" : r?.track ?? "",
    r?.name ?? "",
    r?.founder ?? "",
    r?.industry ?? "",
    r?.stage ?? "",
    typeof r?.ai_score_overall === "number" ? r.ai_score_overall.toFixed(1) : "",
    prettify(r?.status),
    prettify(r?.decision),
    r?.batch ?? "",
    r?.submitted_at ?? "",
  ]);
  return [CSV_HEADERS, ...lines]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
