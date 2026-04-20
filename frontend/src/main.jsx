import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./router.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import IdleLogout from "./components/IdleLogout.jsx";
import { AuthProvider } from "./hooks/useAuth.jsx";
import { ApplicationProvider } from "./hooks/useApplication.jsx";
import { ToastProvider } from "./hooks/useToast.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <ApplicationProvider>
              <IdleLogout />
              <AppRoutes />
            </ApplicationProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
