import { render, screen } from "@testing-library/react";
import { PreviewBadge } from "../PreviewBadge";
it("renders the preview marker", () => {
  render(<PreviewBadge />);
  expect(screen.getByText(/preview — backend pending/i)).toBeInTheDocument();
});
