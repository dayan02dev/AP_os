// Prev/Next list for the leadership review page.
//
// The dashboard writes the list the user is looking at (current filters +
// sort, every page) when they open "Review application"; the review page walks
// only that list. Entries: { id, track (NATIVE — drives the schema), label
// (the row's stage label, so the header matches the list) }.
//
// The full list may land after the review page mounted (it is fetched in the
// background), so each write also fires a window event the page listens for.
//
// Each "Review application" click starts a new list (startReviewIdList) and
// gets a token; the background full-list write passes it back, and a write
// whose token is no longer the latest is dropped. Otherwise a slow fetch from
// an earlier, unfiltered open could land last and replace the filtered list.

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

let latestToken = 0;

// Store the list for a new review session; returns the token later writes for
// this session must carry.
export function startReviewIdList(list) {
  latestToken += 1;
  writeReviewIdList(list, latestToken);
  return latestToken;
}

// Returns false (and writes nothing) when `token` belongs to an older session.
export function writeReviewIdList(list, token = latestToken) {
  if (token !== latestToken) return false;
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
  return true;
}
