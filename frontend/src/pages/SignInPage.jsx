// SignInPage — thin wrapper around <App />. App's internal phase machine handles
// the AUTH screen when the URL is /apply/signin (see useUrlPhaseSync in App.jsx).
// In Phase 3 this page will be replaced with a Supabase email-OTP screen.
import App from "../App.jsx";
export default function SignInPage() { return <App />; }
