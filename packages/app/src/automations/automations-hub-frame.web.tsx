import { useEffect, useRef } from "react";
import { isElectronRuntime } from "@/desktop/host";
import { configureHubWebview } from "./automations-hub-guest";
import { automationsHubUrl } from "./automations-view";
import { HubDaemonLink } from "./hub-daemon-link";

const frameStyle = {
  flex: 1,
  width: "100%",
  height: "100%",
  minHeight: 0,
  border: "none",
  backgroundColor: "transparent",
} as const;

const guestHostStyle = {
  position: "relative",
  flex: 1,
  width: "100%",
  height: "100%",
  minHeight: 0,
} as const;

/**
 * Embedded Hub for the desktop web bundle.
 *
 * Electron hosts Hub in a guest webview. An iframe would make the session
 * cookie cross-site, and sign-in would stay on the same form.
 *
 * @param origin - Hub origin
 * @param onEnrollmentToken - Called with a one-time token when this computer should enroll
 * @returns The triggers page
 */
export function AutomationsHubFrame({
  origin,
  onEnrollmentToken,
}: {
  origin: string;
  onEnrollmentToken?: (token: string) => Promise<void>;
}) {
  const src = automationsHubUrl(origin);
  if (!isElectronRuntime()) {
    return (
      // oxlint-disable-next-line react/iframe-missing-sandbox -- Hub login needs its own cookies and scripts
      <iframe title="Automations" data-testid="automations-webview" src={src} style={frameStyle} />
    );
  }
  return <HubGuest src={src} onEnrollmentToken={onEnrollmentToken} />;
}

function HubGuest({
  src,
  onEnrollmentToken,
}: {
  src: string;
  onEnrollmentToken?: (token: string) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const connectRef = useRef(onEnrollmentToken);
  connectRef.current = onEnrollmentToken;
  const enabled = onEnrollmentToken !== undefined;
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const frame = document.createElement("webview");
    configureHubWebview(frame, src);
    host.replaceChildren(frame);
    if (!enabled) {
      return () => {
        frame.remove();
      };
    }
    let stopped = false;
    let handedOff = false;
    const timer = window.setInterval(() => {
      void handoff();
    }, HubDaemonLink.intervalMs());

    /**
     * The Hub session cookie lives in the guest. The page approves its own
     * device login, and this computer's daemon enrolls with the token.
     */
    async function handoff(): Promise<void> {
      if (stopped || handedOff) {
        return;
      }
      const guest = guestScript(frame);
      if (guest === null) {
        return;
      }
      try {
        const raw = await guest.executeJavaScript(HubDaemonLink.script());
        if (stopped) {
          return;
        }
        if (HubDaemonLink.readPhase(raw) === "blocked") {
          stopped = true;
          window.clearInterval(timer);
          return;
        }
        const token = HubDaemonLink.readEnrollmentToken(raw);
        if (token === null) {
          return;
        }
        const connect = connectRef.current;
        if (connect === undefined) {
          return;
        }
        handedOff = true;
        try {
          await connect(token);
          stopped = true;
          window.clearInterval(timer);
        } catch {
          handedOff = false;
          await guest.executeJavaScript(HubDaemonLink.resetScript()).catch(() => undefined);
        }
      } catch {
        // The guest is still loading. The next tick tries again.
      }
    }

    void handoff();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      frame.remove();
    };
  }, [src, enabled]);
  return <div ref={hostRef} data-testid="automations-webview-host" style={guestHostStyle} />;
}

interface HubGuestScript {
  executeJavaScript(code: string): Promise<unknown>;
}

/**
 * Electron's guest element can run a script in the Hub page. A plain element cannot.
 *
 * @param frame - Element created for the Hub guest.
 * @returns The guest when it can run a script.
 */
function guestScript(frame: HTMLElement): HubGuestScript | null {
  if (!("executeJavaScript" in frame)) {
    return null;
  }
  const execute = frame.executeJavaScript;
  if (typeof execute !== "function") {
    return null;
  }
  return {
    executeJavaScript: (code) => execute.call(frame, code),
  };
}
