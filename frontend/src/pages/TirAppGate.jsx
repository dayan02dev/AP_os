// TirAppGate — wrapper around the TIR <App /> that surfaces the
// track-mismatch screen when a SIP-enrolled user lands on /apply/*.
//
// Detection comes from useApplication.wrongTrack (set when /applications/me
// returns 403 with code "wrong_track"). For unauthed users this never
// fires — the wrapper passes straight through to <App />, which already
// handles the public welcome screen.

import App from "../App.jsx";
import { useApplication } from "../hooks/useApplication.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import TrackMismatchPage from "./TrackMismatchPage.jsx";

export default function TirAppGate() {
  const { wrongTrack } = useApplication();
  const { user } = useAuth();
  // Only show the mismatch screen for authed users — an anon visitor on
  // /apply should still see the marketing welcome.
  if (user && wrongTrack) {
    return <TrackMismatchPage enrolledTrack="sip" attemptedTrack="tir" />;
  }
  return <App />;
}
