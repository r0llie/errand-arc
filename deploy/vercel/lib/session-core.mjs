export const DEFAULT_INTENT = "I am making meatballs for 4 people";

export const ACTIONS = Object.freeze({
  start: { from: 0, to: 1 },
  research: { from: 1, to: 2 },
  plans: { from: 2, to: 3 },
  fund: { from: 3, to: 4 },
  preparing: { from: 4, to: 5 },
  ready: { from: 5, to: 6 },
  release: { from: 6, to: 7 },
});

export function createSession(now = Date.now()) {
  return {
    phase: 0,
    intent: DEFAULT_INTENT,
    revision: 0,
    lastAction: "reset",
    lastRequestId: null,
    updatedAt: new Date(now).toISOString(),
  };
}

export function normalizeSessionId(value) {
  const id = String(value || "public")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9-]{1,48}$/.test(id)) {
    throw new SessionError(
      400,
      "Session must be 1-48 lowercase letters, numbers, or hyphens.",
    );
  }
  return id;
}

export class SessionError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "SessionError";
    this.status = status;
  }
}

export function applyAction(current, input, now = Date.now()) {
  const action = String(input?.action || "");
  const requestId = String(input?.requestId || "");
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
    throw new SessionError(400, "A valid requestId is required.");
  }

  if (current.lastRequestId === requestId) {
    return { ...current, replayed: true };
  }

  if (action === "reset") {
    return {
      ...createSession(now),
      revision: current.revision + 1,
      lastRequestId: requestId,
    };
  }

  const transition = ACTIONS[action];
  if (!transition) {
    throw new SessionError(400, `Unknown action: ${action || "(empty)"}.`);
  }

  if (current.phase >= transition.to) {
    return { ...current, replayed: true };
  }

  if (current.phase !== transition.from) {
    throw new SessionError(
      409,
      `Action ${action} requires phase ${transition.from}; current phase is ${current.phase}.`,
    );
  }

  if (
    Number.isInteger(input.expectedRevision) &&
    input.expectedRevision !== current.revision
  ) {
    throw new SessionError(
      409,
      `Stale revision ${input.expectedRevision}; current revision is ${current.revision}.`,
    );
  }

  let intent = current.intent;
  if (action === "start") {
    intent = String(input.intent || "").trim();
    if (intent.length < 3 || intent.length > 240) {
      throw new SessionError(
        400,
        "Intent must be between 3 and 240 characters.",
      );
    }
  }

  return {
    ...current,
    phase: transition.to,
    intent,
    revision: current.revision + 1,
    lastAction: action,
    lastRequestId: requestId,
    updatedAt: new Date(now).toISOString(),
  };
}
