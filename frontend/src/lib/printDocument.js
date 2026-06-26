// printWithTitle — open the browser's print dialog with a meaningful
// document title so the "Save as PDF" default filename is sensible, then
// restore the previous title once printing finishes (or is cancelled).
//
// Frontend-only PDF export: the caller arranges the DOM + an @media print
// stylesheet; this module only drives the print dialog and the filename.
export function printWithTitle(title) {
  const previous = document.title;
  if (title) document.title = title;

  const restore = () => {
    document.title = previous;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);

  window.print();
}
