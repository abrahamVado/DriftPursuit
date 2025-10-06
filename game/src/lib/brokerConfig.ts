export type BrokerConfig = {
  wsUrl: string;
  httpUrl: string;
};

export const DEFAULT_WS_URL = "ws://localhost:43127/ws";
export const DEFAULT_HTTP_URL = "http://localhost:43127";

export function getBrokerConfig(): BrokerConfig {
  //1.- Pull the WebSocket endpoint from the public runtime env with a localhost fallback.
  const wsUrl = process.env.NEXT_PUBLIC_BROKER_WS_URL?.trim() || DEFAULT_WS_URL;
  //2.- Pull the HTTP endpoint used for diagnostics polling with a localhost fallback.
  const httpUrl = process.env.NEXT_PUBLIC_BROKER_HTTP_URL?.trim() || DEFAULT_HTTP_URL;

  return { wsUrl, httpUrl };
}

export function resolveBrowserUrl(url: string): string {
  //3.- Normalise broker hostnames so assets served via Docker map to the viewer's origin.
  try {
    const parsed = new URL(url);

    if (typeof window !== "undefined" && parsed.hostname === "broker") {
      const replacement = window.location.hostname || "localhost";
      parsed.hostname = replacement;
    }

    return parsed.toString();
  } catch {
    return url;
  }
}
