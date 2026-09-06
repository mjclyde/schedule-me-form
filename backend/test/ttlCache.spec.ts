import { assert } from "chai";
import { TtlCache } from "../src/utils/ttlCache";

describe("TtlCache", () => {
  it("serves a cached value without calling the factory again", async () => {
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const factory = async () => ++calls;

    assert.equal(await cache.wrap("k", factory), 1);
    assert.equal(await cache.wrap("k", factory), 1);
    assert.equal(calls, 1);
  });

  it("keeps distinct keys apart", async () => {
    const cache = new TtlCache<string>(1000);

    assert.equal(await cache.wrap("a", async () => "A"), "A");
    assert.equal(await cache.wrap("b", async () => "B"), "B");
  });

  it("collapses concurrent callers onto one in-flight request", async () => {
    // The whole point: a burst of identical availability requests should make
    // one Google call, not one per visitor.
    const cache = new TtlCache<number>(1000);
    let calls = 0;
    const factory = () =>
      new Promise<number>((resolve) => {
        calls++;
        setTimeout(() => resolve(calls), 10);
      });

    const results = await Promise.all([
      cache.wrap("k", factory),
      cache.wrap("k", factory),
      cache.wrap("k", factory),
    ]);

    assert.deepEqual(results, [1, 1, 1]);
    assert.equal(calls, 1);
  });

  it("re-fetches once the entry has expired", async () => {
    const cache = new TtlCache<number>(5);
    let calls = 0;
    const factory = async () => ++calls;

    assert.equal(await cache.wrap("k", factory), 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(await cache.wrap("k", factory), 2);
  });

  it("does not cache a failure", async () => {
    // A transient Google error must not be replayed for the rest of the TTL.
    const cache = new TtlCache<string>(10_000);
    let calls = 0;
    const factory = async () => {
      calls++;
      if (calls === 1) {
        throw new Error("boom");
      }
      return "ok";
    };

    try {
      await cache.wrap("k", factory);
      assert.fail("expected the first call to reject");
    } catch (err) {
      assert.equal((err as Error).message, "boom");
    }

    assert.equal(await cache.wrap("k", factory), "ok");
    assert.equal(calls, 2);
  });

  it("clears everything on demand", async () => {
    const cache = new TtlCache<number>(10_000);
    let calls = 0;
    const factory = async () => ++calls;

    await cache.wrap("k", factory);
    cache.clear();
    assert.equal(await cache.wrap("k", factory), 2);
  });
});
