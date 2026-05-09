// SipAppRoute — wraps <AppSip /> in <SipApplicationProvider>.
//
// Track gating has moved into the admin portal: every authed user can fill
// and submit both TIR and SIP. The wrongTrack signal is no longer used to
// short-circuit the wizard.

import AppSip from "../AppSip.jsx";
import { SipApplicationProvider } from "../hooks/useSipApplication.jsx";

export default function SipAppRoute() {
  return (
    <SipApplicationProvider>
      <AppSip />
    </SipApplicationProvider>
  );
}
