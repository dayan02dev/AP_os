// VIP memo v2 (Navigator) helpers shared by the leadership, admin and reviewer
// surfaces: load the memo once per app, and save a downloaded file.
import { useEffect, useRef, useState } from "react";

/**
 * Load the v2 memo for `appId` with `fetchMemo(appId)` (null appId = off).
 * status: "off" | "loading" | "ready" | "missing" — "missing" covers a 404
 * or any failure, so callers fall back to the legacy memo preview.
 */
export function useVipMemoV2(appId, fetchMemo) {
  const fetchRef = useRef(fetchMemo);
  fetchRef.current = fetchMemo;
  const [state, setState] = useState({ appId: null, status: "off", memo: null });

  useEffect(() => {
    if (!appId) return undefined;
    let live = true;
    setState({ appId, status: "loading", memo: null });
    Promise.resolve()
      .then(() => fetchRef.current(appId))
      .then(
        (memo) => {
          if (!live) return;
          const ok = memo && typeof memo === "object" && memo.version === 2;
          setState({ appId, status: ok ? "ready" : "missing", memo: ok ? memo : null });
        },
        () => { if (live) setState({ appId, status: "missing", memo: null }); },
      );
    return () => { live = false; };
  }, [appId]);

  if (!appId) return { status: "off", memo: null };
  if (state.appId !== appId) return { status: "loading", memo: null };
  return state;
}

/** "<Name>_IC_Memo.<ext>" — mirrors the backend's Content-Disposition name. */
export function vipMemoV2Filename(memo, format) {
  const name = String(memo?.name || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "VIP";
  return `${name}_IC_Memo.${format}`;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
