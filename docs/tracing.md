# Trace Propagation and Correlated Logging

The broker now emits structured JSON logs with an explicit `trace_id` field to enable end-to-end request correlation across services.

## Trace identifiers

* **HTTP header:** `X-Trace-ID`
* **Structured log field:** `trace_id`

Incoming HTTP requests should supply `X-Trace-ID`. When absent, the broker generates a new 16-byte hex identifier and returns it via the same header in the response. Downstream systems must forward the header and include the `trace_id` in their own logs to maintain observability.

## Python bot example

```python
import json
import logging
import uuid
from typing import Any, Dict

TRACE_HEADER = "X-Trace-ID"

class TraceAdapter(logging.LoggerAdapter):
    def process(self, msg: Any, kwargs: Dict[str, Any]):
        trace_id = self.extra.get("trace_id", "")
        payload = {"message": msg, "trace_id": trace_id}
        if "extra" in kwargs:
            payload.update(kwargs.pop("extra"))
        return json.dumps(payload), kwargs

def build_logger(trace_id: str) -> logging.LoggerAdapter:
    base_logger = logging.getLogger("bot")
    base_logger.setLevel(logging.INFO)
    if not base_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        base_logger.addHandler(handler)
    return TraceAdapter(base_logger, {"trace_id": trace_id})

trace_id = uuid.uuid4().hex  # reuse if provided by the broker
logger = build_logger(trace_id)
logger.info("queued action", extra={"action": "jump"})
```

Send the same `trace_id` with the WebSocket handshake or REST calls via the `X-Trace-ID` header.

## Web client example

```ts
const TRACE_HEADER = "X-Trace-ID";

function withTrace(fetchFn: typeof fetch, traceId?: string) {
  const id = traceId ?? crypto.randomUUID().replace(/-/g, "");
  const log = (message: string, extra: Record<string, unknown> = {}) => {
    console.info(JSON.stringify({ message, trace_id: id, ...extra }));
  };
  const tracedFetch: typeof fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set(TRACE_HEADER, id);
    return fetchFn(input, { ...init, headers });
  };
  return { traceId: id, log, fetch: tracedFetch };
}

const telemetry = withTrace(window.fetch);
telemetry.log("loading match view");
telemetry
  .fetch("/api/stats")
  .then((response) => response.json())
  .then((data) => telemetry.log("stats received", { data }));
```

All services should preserve `trace_id` to ensure a single player action can be followed through the broker, bots, and browser clients.
