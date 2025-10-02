const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type HMACTokenClaims = {
  subject: string;
  expiresAtMs: number;
  issuedAtMs?: number;
  audience?: string;
};

const header = { alg: "HS256", typ: "JWT" } as const;

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(data: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(data);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      buffer[i] = binary.charCodeAt(i);
    }
    return buffer;
  }
  return new Uint8Array(Buffer.from(data, "base64"));
}

//1.- Encode arbitrary binary data into a URL-safe base64 string without padding.
function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return encodeBase64(view).replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

//2.- Decode a URL-safe base64 string back into a sequence of bytes.
function base64UrlDecode(data: string): Uint8Array {
  const normalized = data.replace(/-/gu, "+").replace(/_/gu, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return decodeBase64(padded);
}

async function importHMACKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

//3.- Produce a compact JWT-style token signed with an HMAC SHA-256 signature.
export async function buildHMACToken(secret: string, claims: HMACTokenClaims): Promise<string> {
  if (!secret) {
    throw new Error("HMAC secret must be provided");
  }
  if (!claims.subject) {
    throw new Error("subject is required");
  }
  if (!Number.isFinite(claims.expiresAtMs)) {
    throw new Error("expiresAtMs must be a finite number");
  }
  const issuedAtMs = claims.issuedAtMs ?? Date.now();
  const payload = {
    sub: claims.subject,
    exp: Math.floor(claims.expiresAtMs / 1000),
    iat: Math.floor(issuedAtMs / 1000),
    aud: claims.audience,
  };
  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importHMACKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(signingInput));
  const encodedSignature = base64UrlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

//4.- Append a bearer token to the WebSocket URL as an auth_token query parameter.
export function appendTokenToURL(url: string, token: string): string {
  const target = new URL(url);
  target.searchParams.set("auth_token", token);
  return target.toString();
}

//5.- Quickly sanity-check a token by decoding and returning its subject claim.
export function peekTokenSubject(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = JSON.parse(textDecoder.decode(base64UrlDecode(parts[1]!)));
    if (typeof payload.sub === "string" && payload.sub.trim() !== "") {
      return payload.sub;
    }
  } catch (_err) {
    return null;
  }
  return null;
}

export { base64UrlEncode, base64UrlDecode };
