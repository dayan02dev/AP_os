// ApplyIndex — the landing at /apply. Decides where the user should be sent
// based on auth state and draft progress:
//   - no user            → /apply/signin
//   - user, no draft     → /apply (renders <App />, which shows welcome/returning)
//   - existing phase     → rendered by <App />
// For now we just render <App /> and let its phase machine take over.
import App from "../App.jsx";
export default function ApplyIndex() { return <App />; }
