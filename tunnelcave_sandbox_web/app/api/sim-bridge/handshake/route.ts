import { missingBridgeConfigMessage, resolveBridgeBaseUrl } from '../config'

export async function GET(): Promise<Response> {
  //1.- Resolve the upstream simulation bridge URL before issuing the proxy request.
  const baseUrl = resolveBridgeBaseUrl()
  if (!baseUrl) {
    const payload = { status: 'error', message: missingBridgeConfigMessage() }
    //2.- Surface a service unavailable response so clients can present actionable guidance.
    return new Response(JSON.stringify(payload), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    //3.- Forward the handshake to the bridge without caching to reflect the live availability state.
    const upstream = await fetch(`${baseUrl}/handshake`, { cache: 'no-store' })
    const body = await upstream.json()
    const responsePayload = {
      ...body,
      bridgeUrl: baseUrl,
    }
    return new Response(JSON.stringify(responsePayload), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    //4.- Map network failures to a gateway error so the UI can inform the operator.
    const message = error instanceof Error ? error.message : 'Unknown error'
    const payload = {
      status: 'error',
      message: `Failed to reach simulation bridge at ${baseUrl}: ${message}`,
    }
    return new Response(JSON.stringify(payload), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
