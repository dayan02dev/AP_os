import { Navigate, useLocation } from "react-router-dom";

function readUser() {
  try { return JSON.parse(localStorage.getItem("tir:user") || "null"); } catch { return null; }
}

export default function ProtectedRoute({ children }) {
  const location = useLocation();
  const user = readUser();
  if (!user) {
    const next = location.pathname + (location.search || "");
    return <Navigate to={`/apply/signin?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}
