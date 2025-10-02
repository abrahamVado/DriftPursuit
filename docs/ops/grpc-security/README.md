# gRPC mTLS Certificate Management

Mutual TLS hardens the time-sync gRPC endpoint so only trusted services can establish streaming sessions. Production deployments **must** provision certificates from the platform's PKI. Development environments may fall back to the shared-secret metadata flow (`BROKER_GRPC_AUTH_MODE=shared_secret`).

## Bootstrap Steps

1. Generate a dedicated certificate authority (CA) if your infrastructure does not provide one:
   ```bash
   openssl req -new -x509 -days 365 -nodes -out ca.pem -keyout ca.key -subj "/CN=driftpursuit-local-ca"
   ```
2. Issue a server certificate signed by the CA for the broker hostnames:
   ```bash
   openssl req -new -nodes -out broker.csr -keyout broker.key -subj "/CN=broker.internal"
   openssl x509 -req -in broker.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out broker.pem -days 180 -sha256
   ```
3. Distribute `broker.pem` and `broker.key` to the broker runtime and configure:
   ```bash
   export BROKER_GRPC_AUTH_MODE=mtls
   export BROKER_GRPC_TLS_CERT=/etc/driftpursuit/tls/broker.pem
   export BROKER_GRPC_TLS_KEY=/etc/driftpursuit/tls/broker.key
   export BROKER_GRPC_CLIENT_CA=/etc/driftpursuit/tls/ca.pem
   ```
4. Provision client certificates signed by the same CA for every consumer, storing the CA bundle alongside the client key pair. Client SDKs must present the certificate during the TLS handshake.

## Rotation Checklist

//1.- Track certificate expiry dates and stage replacements at least one week prior to expiry.
//2.- Reload broker pods or services after updating `BROKER_GRPC_TLS_*` secrets.
//3.- Rotate client certificates in lockstep to avoid authentication gaps.
//4.- Update `BROKER_GRPC_CLIENT_CA` whenever the trusted CA bundle changes.

## Development Shortcut

For local testing run with:

```bash
export BROKER_GRPC_AUTH_MODE=shared_secret
export BROKER_GRPC_SHARED_SECRET=local-secret
```

The broker will enforce `x-broker-shared-secret` metadata instead of mutual TLS. **Do not** ship this configuration to production.
