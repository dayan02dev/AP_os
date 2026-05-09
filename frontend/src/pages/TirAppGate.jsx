// TirAppGate — passthrough wrapper around <App />.
//
// Track gating has moved into the admin portal: every authed user can fill
// and submit both TIR and SIP independently. We keep the wrapper file so
// router.jsx imports don't churn — re-enabling the wrongTrack mismatch
// screen is a one-line change here.

import App from "../App.jsx";

export default function TirAppGate() {
  return <App />;
}
