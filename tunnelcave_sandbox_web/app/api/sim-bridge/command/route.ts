import { missingBridgeConfigMessage, resolveBridgeBaseUrl } from '../config'

export async function POST(request: Request): Promise<Response> {
  //1.- Resolve the upstream simulation bridge URL before forwarding the command payload.
  const baseUrl = resolveBridgeBaseUrl()
  if (!baseUrl) {
    const payload = { status: 'error', message: missingBridgeConfigMessage() }
    //2.- Reject the request when configuration is missing so the caller can update the environment.
    return new Response(JSON.stringify(payload), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    //3.- Forward the command to the bridge while preserving the caller-provided body.
    const clonedRequest = request.clone()
    const upstream = await fetch(`${baseUrl}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await clonedRequest.text(),
    })
    const body = await upstream.json()
    return new Response(JSON.stringify(body), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    //4.- Surface a gateway error that includes the upstream address for easier troubleshooting.
    const message = error instanceof Error ? error.message : 'Unknown error'
    const payload = {
      status: 'error',
      message: `Failed to forward command to simulation bridge at ${baseUrl}: ${message}`,
    }
    return new Response(JSON.stringify(payload), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
