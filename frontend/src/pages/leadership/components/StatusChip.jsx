// StatusChip — coloured pill that translates a backend status id into a
// bucket-coloured chip. Shared between ApplicationsTable rows and AppDrawer
// header meta. Bucket mapping lives in statusBuckets.js.

import { bucketFor } from "./statusBuckets.js";

export default function StatusChip({ statusId, statusLabel }) {
  const bucket = bucketFor(statusId);
  return (
    <span className={`lp-chip lp-chip-${bucket}`}>
      <span className={`lp-status-dot lp-status-${bucket}`} />
      {statusLabel || statusId}
    </span>
  );
}
