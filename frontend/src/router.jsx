// Route tree. BrowserRouter is mounted in main.jsx so hooks like useNavigate
// work in the providers above this component.

import { Navigate, Route, Routes } from "react-router-dom";
import App from "./App.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";
import ProtectedRoute from "./pages/ProtectedRoute.jsx";
import SignInPage from "./pages/SignInPage.jsx";
import SupportPage from "./pages/SupportPage.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/apply" replace />} />

      {/* Public auth pages */}
      <Route path="/apply/signin" element={<SignInPage />} />
      <Route path="/apply/verify" element={<VerifyPage />} />
      <Route path="/apply/support" element={<SupportPage />} />

      {/* Protected — everything else under /apply is gated by auth */}
      <Route
        path="/apply/*"
        element={
          <ProtectedRoute>
            <App />
          </ProtectedRoute>
        }
      />
      <Route path="/apply" element={<ProtectedRoute><App /></ProtectedRoute>} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
