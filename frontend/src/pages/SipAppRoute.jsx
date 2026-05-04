// SipAppRoute — gate for /apply-sip/* routes.
//
// Wraps <AppSip /> in <SipApplicationProvider> and detects wrong-track
// users via the 403/wrong_track signal exposed by useSipApplication. When
// triggered, renders <TrackMismatchPage /> instead of the wizard.

import AppSip from "../AppSip.jsx";
import {
  SipApplicationProvider,
  useSipApplication,
} from "../hooks/useSipApplication.jsx";
import TrackMismatchPage from "./TrackMismatchPage.jsx";

function GateInner() {
  const { wrongTrack } = useSipApplication();
  if (wrongTrack) {
    return (
      <TrackMismatchPage enrolledTrack="tir" attemptedTrack="sip" />
    );
  }
  return <AppSip />;
}

export default function SipAppRoute() {
  return (
    <SipApplicationProvider>
      <GateInner />
    </SipApplicationProvider>
  );
}
