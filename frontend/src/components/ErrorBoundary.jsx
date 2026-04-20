// ErrorBoundary — catches uncaught render errors, shows a minimal fallback,
// and best-effort files a support ticket so we hear about them.

import { Component } from "react";
import { api } from "../lib/api.js";
import { loadSession } from "../lib/session.js";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info);
    // Best-effort: file a support ticket so we hear about it. Never throw.
    try {
      const session = loadSession();
      api
        .post("/support/ticket", {
          email: "errors@artpark.in",
          subject: `UI crash: ${error?.name || "Error"}`,
          body: [
            `Message: ${error?.message || "(none)"}`,
            `Stack:`,
            error?.stack || "(no stack)",
            `Component stack:`,
            info?.componentStack || "(no component stack)",
            `URL: ${window.location.href}`,
            `UA: ${navigator.userAgent}`,
            `Session: ${session ? "authed" : "anon"}`,
          ].join("\n"),
          category: "technical",
        })
        .catch(() => {});
    } catch {
      /* swallow — we already failed, don't cascade */
    }
  }

  handleReset = () => {
    this.setState({ error: null });
    window.location.assign("/apply");
  };

  render() {
    if (this.state.error) {
      return (
        <div className="eir-root">
          <div className="eir-bg" />
          <div className="eir-frame">
            <main className="eir-main">
              <div className="eir-screen">
                <div className="eir-coord eir-mono">
                  <span>ARTPARK / TIR.2026</span>
                  <span>something broke</span>
                </div>
                <div className="eir-welcome-body">
                  <h1 className="eir-welcome-title">Something went sideways.</h1>
                  <p className="eir-welcome-lede">
                    The error has been reported to our team. Your progress is
                    saved — refresh the page or click below to return to the
                    application.
                  </p>
                  <button className="eir-btn eir-btn-primary" onClick={this.handleReset}>
                    <span>Back to application</span>
                  </button>
                </div>
              </div>
            </main>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
