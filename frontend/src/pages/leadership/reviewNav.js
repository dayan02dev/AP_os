// Prev/Next list for the leadership review page.
//
// The dashboard writes the list the user is looking at (current filters +
// sort, every page) when they open "Review application"; the review page walks
// only that list. Entries: { id, track (NATIVE — drives the schema), label
// (the row's stage label, so the header matches the list) }.
//
// The full list may land after the review page mounted (it is fetched in the
// background), so each write also fires a window event the page listens for.

export const ID_LIST_KEY = "review_app_id_list";
export const ID_LIST_EVENT = "leadership:review-id-list";

export function readReviewIdList() {
  try {
    const raw = sessionStorage.getItem(ID_LIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((e) => e && e.id && e.track);
  } catch {
    return null;
  }
}

export function writeReviewIdList(list) {
  try {
    sessionStorage.setItem(ID_LIST_KEY, JSON.stringify(list));
  } catch {
    // sessionStorage full or unavailable — the event below still updates an
    // open review page for this session.
  }
  try {
    window.dispatchEvent(new CustomEvent(ID_LIST_EVENT, { detail: list }));
  } catch {
    // ignore
  }
}
