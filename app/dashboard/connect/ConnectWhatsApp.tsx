"use client";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { FB?: any; fbAsyncInit?: () => void }
}

type Session = { waba_id?: string; phone_number_id?: string };

/** Opens Meta's WhatsApp sign-up window. Meta returns a one-time code, which the server swaps for a token. */
export default function ConnectWhatsApp({ appId, configId, action }: {
  appId: string; configId: string; action: (fd: FormData) => Promise<void>;
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const session = useRef<Session>({});

  useEffect(() => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version: "v26.0" });
      setReady(true);
    };
    if (window.FB) setReady(true);
    else if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk"; s.src = "https://connect.facebook.net/en_US/sdk.js"; s.async = true; s.crossOrigin = "anonymous";
      document.body.appendChild(s);
    }

    // Meta posts the WhatsApp account and number IDs to the window once the business finishes.
    const onMessage = (e: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.type === "WA_EMBEDDED_SIGNUP" && d.event === "FINISH") {
          session.current = { waba_id: d.data?.waba_id, phone_number_id: d.data?.phone_number_id };
        }
      } catch { /* not a Meta message */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId]);

  function connect() {
    if (!window.FB) return;
    setBusy(true); setNote("");
    window.FB.login((resp: any) => {
      const code = resp?.authResponse?.code;
      if (!code) { setBusy(false); setNote("The connection was cancelled. Try again when you are ready."); return; }
      if (!session.current.phone_number_id) { setBusy(false); setNote("Finish the WhatsApp steps in the Meta window, then try again."); return; }
      const fd = new FormData();
      fd.append("code", code);
      fd.append("waba_id", session.current.waba_id ?? "");
      fd.append("phone_number_id", session.current.phone_number_id);
      action(fd); // the server saves the connection and redirects back here
    }, {
      config_id: configId,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
    });
  }

  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
      <button type="button" className="btn btn-lime" onClick={connect} disabled={!ready || busy}>
        {busy ? "Connecting…" : ready ? "Connect WhatsApp with Meta" : "Loading Meta…"}
      </button>
      {note && <p role="status" style={{ color: "var(--ink-70)", fontSize: 14 }}>{note}</p>}
    </div>
  );
}
