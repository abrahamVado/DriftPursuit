# syntax=docker/dockerfile:1

FROM golang:1.21-bookworm AS builder
ENV GOTOOLCHAIN=auto
WORKDIR /src
RUN apt-get update \
    && apt-get install --no-install-recommends -y build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
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
