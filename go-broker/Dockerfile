# syntax=docker/dockerfile:1

FROM golang:1.21-alpine AS builder
WORKDIR /src
RUN apk add --no-cache build-base ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/broker ./

FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=builder /out/broker ./broker
EXPOSE 43127
ENTRYPOINT ["/app/broker"]
