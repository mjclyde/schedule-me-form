import { assert } from "chai";
import { signState, verifyState } from "../src/google/oauthState";

const SECRET = "test-secret";

describe("oauthState", () => {
  it("round-trips the person id", () => {
    assert.equal(verifyState(signState("abc123", SECRET), SECRET), "abc123");
  });

  it("rejects a state signed with a different secret", () => {
    // Otherwise anyone could bind a Google account to any person id by
    // hand-crafting the callback URL.
    const state = signState("abc123", SECRET);

    assert.isNull(verifyState(state, "other-secret"));
  });

  it("rejects a tampered payload", () => {
    const [, signature] = signState("abc123", SECRET).split(".");
    const forged = Buffer.from(
      JSON.stringify({ personId: "victim", exp: Date.now() + 60000 }),
    ).toString("base64url");

    assert.isNull(verifyState(`${forged}.${signature}`, SECRET));
  });

  it("rejects an expired state", () => {
    const state = signState("abc123", SECRET, { ttlMs: 1000, now: 0 });

    assert.equal(verifyState(state, SECRET, { now: 500 }), "abc123");
    assert.isNull(verifyState(state, SECRET, { now: 1001 }));
  });

  it("rejects malformed input rather than throwing", () => {
    assert.isNull(verifyState("", SECRET));
    assert.isNull(verifyState("no-dot", SECRET));
    assert.isNull(verifyState("...", SECRET));
    assert.isNull(verifyState("not-base64.signature", SECRET));
  });

  it("refuses to verify anything when no secret is configured", () => {
    assert.isNull(verifyState(signState("abc123", SECRET), ""));
  });

  it("refuses to sign without a secret", () => {
    assert.throws(() => signState("abc123", ""), /without a secret/);
  });
});
