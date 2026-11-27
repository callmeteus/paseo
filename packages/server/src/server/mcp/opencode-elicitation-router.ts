/**
 * Process-wide routing for OpenCode MCP elicitation.
 *
 * OpenCode owns one helper server (and therefore one location-scoped MCP
 * registry) shared by sessions in the same directory. A per-session shim token
 * would let the last session in that directory own every other session's
 * dialog, so the loopback bridge and the (location, server) registration live
 * for the lifetime of the daemon and are refcounted. Requests are delivered to
 * the session with the in-flight tool call for that server.
 */

import { createHash } from "node:crypto";
import { readACPElicitation, type ACPElicitationForm } from "../agent/providers/acp-elicitation.js";
import type { ElicitationCard, McpElicitationAnswer } from "./elicitation-proxy.js";
import { startElicitationBridge, type ElicitationBridge } from "./elicitation-callback.js";

interface Candidate {
  sessionId: string;
  ask: (message: string, form: ACPElicitationForm) => ElicitationCard;
}

interface Registration {
  count: number;
  restore: () => Promise<void>;
  /** Shared services must never broadcast another client's elicitation to Paseo chats. */
  allowFallback: boolean;
}

function tokenFor(connectionId: string, location: string, server: string, config: unknown): string {
  const key = `${connectionId}\0${location}\0${server}\0${JSON.stringify(config)}`;
  return `opencode-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

class OpenCodeElicitationRouter {
  private bridge: Promise<ElicitationBridge> | null = null;
  private readonly registrations = new Map<string, Registration>();
  private readonly candidates = new Map<string, Map<string, Candidate>>();
  private readonly calls = new Map<string, Map<string, Candidate & { startedAt: number }>>();
  private readonly inflight = new Map<string, Map<string, ElicitationCard[]>>();

  async acquire(input: {
    token: string;
    restore: () => Promise<void>;
    allowFallback?: boolean;
  }): Promise<{ callback: string; first: boolean }> {
    if (!this.bridge) this.bridge = startElicitationBridge();
    let bridge = await this.bridge;
    try {
      const health = await fetch(`${bridge.origin}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (!health.ok) throw new Error(`bridge health ${health.status}`);
    } catch {
      // The listener died (worker restart between tests or daemon reload).
      // Rebind before handing a callback URL to a shim.
      this.bridge = startElicitationBridge();
      bridge = await this.bridge;
    }
    const existing = this.registrations.get(input.token);
    if (existing) {
      existing.count += 1;
      return { callback: `${bridge.origin}/elicit`, first: false };
    }
    const registration: Registration = {
      count: 1,
      restore: input.restore,
      allowFallback: input.allowFallback !== false,
    };
    this.registrations.set(input.token, registration);
    bridge.register(input.token, async (request) => {
      const envelope = request as { params?: unknown };
      const params = envelope.params ?? request;
      const form = readACPElicitation(params);
      if (!form) return { action: "decline" };
      const messageValue = (params as { message?: unknown }).message;
      const message = typeof messageValue === "string" ? messageValue : "Confirm MCP request";
      const requestId = (envelope as { id?: string | number }).id;
      return await this.ask(
        input.token,
        message,
        form,
        registration.allowFallback,
        requestId === undefined ? undefined : String(requestId),
      );
    });
    bridge.register(`cancel:${input.token}`, async (payload) => {
      const message = payload as { id?: string | number; reason?: string } | undefined;
      if (!message) return;
      const id = String(message.id ?? "");
      const cards = this.inflight.get(input.token)?.get(id);
      if (!cards) return;
      this.inflight.get(input.token)?.delete(id);
      for (const card of cards) card.cancel(message.reason ?? "cancelled");
    });
    return { callback: `${bridge.origin}/elicit`, first: true };
  }

  async release(input: { token: string; sessionId: string }): Promise<void> {
    this.unregisterCandidate(input);
    const registration = this.registrations.get(input.token);
    if (!registration) return;
    registration.count -= 1;
    if (registration.count > 0) return;
    this.registrations.delete(input.token);
    this.candidates.delete(input.token);
    this.calls.delete(input.token);
    const bridge = await this.bridge;
    bridge?.unregister(input.token);
    await registration.restore();
  }

  registerCandidate(token: string, candidate: Candidate): void {
    let bySession = this.candidates.get(token);
    if (!bySession) {
      bySession = new Map();
      this.candidates.set(token, bySession);
    }
    bySession.set(candidate.sessionId, candidate);
  }

  unregisterCandidate(input: { token: string; sessionId: string }): void {
    this.candidates.get(input.token)?.delete(input.sessionId);
    const active = this.calls.get(input.token);
    if (!active) return;
    for (const [id, call] of active) {
      if (call.sessionId === input.sessionId) active.delete(id);
    }
  }

  toolStarted(input: { token: string; sessionId: string; toolCallId: string }): void {
    const candidate = this.candidates.get(input.token)?.get(input.sessionId);
    if (!candidate) return;
    let active = this.calls.get(input.token);
    if (!active) {
      active = new Map();
      this.calls.set(input.token, active);
    }
    active.set(input.toolCallId, { ...candidate, startedAt: Date.now() });
  }

  toolStartedForSession(sessionId: string, toolCallId: string): void {
    const now = Date.now();
    for (const [token, bySession] of this.candidates) {
      if (!bySession.has(sessionId)) continue;
      let active = this.calls.get(token);
      if (!active) {
        active = new Map();
        this.calls.set(token, active);
      }
      active.set(toolCallId, { ...bySession.get(sessionId)!, startedAt: now });
    }
  }

  toolFinishedForSession(sessionId: string, toolCallId: string, token: string): void {
    if (token === "*") {
      // Code Mode call: registered against every wrapped server of this session.
      for (const [candidateToken, bySession] of this.candidates) {
        if (bySession.has(sessionId)) this.calls.get(candidateToken)?.delete(toolCallId);
      }
      return;
    }
    this.calls.get(token)?.delete(toolCallId);
  }

  toolFinished(input: { token: string; toolCallId: string }): void {
    this.calls.get(input.token)?.delete(input.toolCallId);
  }

  private async ask(
    token: string,
    message: string,
    form: ACPElicitationForm,
    allowFallback: boolean,
    requestId?: string,
  ): Promise<McpElicitationAnswer> {
    const active = [...(this.calls.get(token)?.values() ?? [])].sort(
      (a, b) => b.startedAt - a.startedAt,
    );
    let chosen: Candidate[];
    if (active.length > 0) {
      // Several sessions may have a call to this server in flight. Pick the
      // most recent one and leave every other session's dialogs untouched.
      chosen = [active[0]!];
    } else if (!allowFallback) {
      return { action: "decline" };
    } else {
      chosen = [...(this.candidates.get(token)?.values() ?? [])];
      if (chosen.length === 0) return { action: "decline" };
    }
    const cards = chosen.map((candidate) => candidate.ask(message, form));
    if (requestId) {
      let byId = this.inflight.get(token);
      if (!byId) {
        byId = new Map();
        this.inflight.set(token, byId);
      }
      byId.set(requestId, cards);
    }
    const forget = () => {
      if (requestId) this.inflight.get(token)?.delete(requestId);
    };
    if (cards.length === 1) {
      try {
        return await cards[0]!.answer;
      } finally {
        forget();
      }
    }
    // Truly ambiguous (no tool call): show this elicitation on all candidates.
    // First answer wins; cancel only this elicitation's copies on the others.
    return await new Promise<McpElicitationAnswer>((resolve) => {
      let winner = -1;
      cards.forEach((card, index) => {
        void card.answer.then((answer) => {
          if (winner !== -1) return;
          winner = index;
          cards.forEach((other, otherIndex) => {
            if (otherIndex !== index) other.cancel();
          });
          forget();
          resolve(answer);
          return answer;
        });
      });
    });
  }
}

export const openCodeElicitationRouter = new OpenCodeElicitationRouter();
export { tokenFor as openCodeElicitationToken };
