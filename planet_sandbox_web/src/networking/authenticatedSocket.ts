import { appendTokenToURL, buildHMACToken } from "@client/authToken";

export type SocketAuthConfig = {
  subject: string;
  token?: string;
  secret?: string;
  audience?: string;
  ttlSeconds?: number;
};

export type SocketDialOptions = {
  url: string;
  protocols?: string | string[];
  auth: SocketAuthConfig;
};

//1.- Materialise a token using the supplied secret or reuse a pre-issued credential.
async function resolveToken(config: SocketAuthConfig): Promise<string> {
  if (config.token && config.token.trim() !== "") {
    return config.token;
  }
  if (!config.secret) {
    throw new Error("either token or secret must be provided for WebSocket authentication");
  }
  const ttlSeconds = config.ttlSeconds ?? 60;
  const expiresAtMs = Date.now() + ttlSeconds * 1_000;
  return buildHMACToken(config.secret, {
    subject: config.subject,
    expiresAtMs,
    audience: config.audience,
  });
}

//2.- Inject the bearer token into the connection URL and establish the WebSocket.
export async function openAuthenticatedSocket(options: SocketDialOptions): Promise<WebSocket> {
  const token = await resolveToken(options.auth);
  const urlWithToken = appendTokenToURL(options.url, token);
  return new WebSocket(urlWithToken, options.protocols);
}
