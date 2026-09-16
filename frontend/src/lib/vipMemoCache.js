const PREFIX = "artpark.vipMemo.";

export function readVipMemo(applicationId) {
  if (!applicationId) return null;
  try {
    const raw = localStorage.getItem(`${PREFIX}${applicationId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeVipMemo(applicationId, memo) {
  if (!applicationId || !memo) return;
  try {
    localStorage.setItem(`${PREFIX}${applicationId}`, JSON.stringify(memo));
  } catch {
    // Storage may be unavailable or full; generation still remains usable.
  }
}
