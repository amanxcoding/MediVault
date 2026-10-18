import test from "node:test";
import assert from "node:assert/strict";
import { createShareToken, hashShareToken } from "../lib/share-token.ts";

test("share tokens are 256-bit URL-safe opaque values", () => {
  const first = createShareToken();
  const second = createShareToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("share-token lookup stores a fixed-size SHA-256 hash, not the token", () => {
  const token = createShareToken();
  const hash = hashShareToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashShareToken(token), hash);
  assert.notEqual(hashShareToken(createShareToken()), hash);
});
