import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAction,
  createSession,
  normalizeSessionId,
} from "../lib/session-core.mjs";
import { createHandler } from "../api/session.mjs";

const request = (action, revision, suffix) => ({
  action,
  expectedRevision: revision,
  requestId: `request_${suffix}_12345678`,
  intent: "I am making meatballs for 4 people",
});

test("runs the complete ordered session lifecycle", () => {
  let state = createSession(0);
  for (const [index, action] of [
    "start",
    "research",
    "plans",
    "fund",
    "preparing",
    "ready",
    "release",
  ].entries()) {
    state = applyAction(
      state,
      request(action, state.revision, index),
      index + 1,
    );
  }
  assert.equal(state.phase, 7);
  assert.equal(state.revision, 7);
  assert.equal(state.lastAction, "release");
});

test("makes duplicate requests idempotent", () => {
  const initial = createSession(0);
  const input = request("start", 0, "same");
  const first = applyAction(initial, input, 1);
  const duplicate = applyAction(first, input, 2);
  assert.equal(duplicate.phase, 1);
  assert.equal(duplicate.revision, 1);
  assert.equal(duplicate.replayed, true);
});

test("rejects skipped and stale transitions", () => {
  const initial = createSession(0);
  assert.throws(
    () => applyAction(initial, request("research", 0, "skip")),
    /requires phase 1/,
  );
  const started = applyAction(initial, request("start", 0, "start"), 1);
  assert.throws(
    () => applyAction(started, request("research", 0, "stale")),
    /Stale revision/,
  );
});

test("validates shared session identifiers and shopper intent", () => {
  assert.equal(normalizeSessionId("Judge-Room"), "judge-room");
  assert.throws(() => normalizeSessionId("../escape"), /Session must/);
  assert.throws(
    () =>
      applyAction(createSession(), {
        ...request("start", 0, "tiny"),
        intent: "x",
      }),
    /Intent must/,
  );
});

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = JSON.parse(value);
    },
  };
}

test("serves and mutates one shared API session", async () => {
  const sessions = new Map();
  const store = {
    async get(id) {
      return sessions.get(id) || createSession(0);
    },
    async set(id, value) {
      sessions.set(id, value);
    },
  };
  const handler = createHandler(store);

  const post = responseRecorder();
  await handler(
    {
      method: "POST",
      url: "/api/session?session=judge-room",
      body: request("start", 0, "api"),
    },
    post,
  );
  assert.equal(post.statusCode, 200);
  assert.equal(post.body.state.phase, 1);
  assert.equal(post.headers["Cache-Control"], "no-store, max-age=0");

  const get = responseRecorder();
  await handler({ method: "GET", url: "/api/session?session=judge-room" }, get);
  assert.equal(get.statusCode, 200);
  assert.equal(get.body.session, "judge-room");
  assert.equal(get.body.state.phase, 1);
});
