import { PreviewBadge } from "../../../../components/admin/PreviewBadge";
export function ScreenStub({ name }) {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontFamily: "var(--font-serif)" }}>{name}</h2>
      <PreviewBadge />
      <p style={{ color: "var(--ink-dim)", marginTop: 12 }}>Screen pending port.</p>
    </div>
  );
}
