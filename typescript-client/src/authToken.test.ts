import assert from "node:assert";
import {
  appendTokenToURL,
  base64UrlDecode,
  base64UrlEncode,
  buildHMACToken,
  peekTokenSubject,
} from "./authToken";

(async () => {
  const secret = "topsecret";
  const expiresAtMs = Date.now() + 60_000;

  //1.- Round-trip arbitrary bytes through the base64url helpers.
  {
    const sample = new Uint8Array([1, 2, 3, 4, 250]);
    const encoded = base64UrlEncode(sample);
    const decoded = base64UrlDecode(encoded);
    assert.deepStrictEqual(Array.from(decoded), Array.from(sample));
  }

  //2.- Sign a short-lived token and confirm the subject can be inspected.
  const token = await buildHMACToken(secret, {
    subject: "pilot-1",
    expiresAtMs,
  });
  assert.ok(token.split(".").length === 3, "expected compact token structure");
  assert.strictEqual(peekTokenSubject(token), "pilot-1");

  //3.- Ensure the helper rewrites WebSocket URLs with the auth_token parameter.
  {
    const url = appendTokenToURL("wss://demo.example/socket", token);
    const parsed = new URL(url);
    assert.strictEqual(parsed.searchParams.get("auth_token"), token);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
