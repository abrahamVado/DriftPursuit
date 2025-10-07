'use client'
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrokerConfig, getBrokerConfig, resolveBrowserUrl } from "../lib/brokerConfig";

type DiagnosticsState = "idle" | "checking" | "ok" | "error";

type DiagnosticsPanelProps = {
  config?: BrokerConfig;
};

export function DiagnosticsPanel({ config = getBrokerConfig() }: DiagnosticsPanelProps) {
  //1.- Track the most recent connectivity state that the UI should surface.
  const [state, setState] = useState<DiagnosticsState>("idle");
  //2.- Capture a human readable message so the operator knows why a status changed.
  const [message, setMessage] = useState<string>("Ready to check connectivity.");
  const [lastChecked, setLastChecked] = useState<string>("");
  const [statsJson, setStatsJson] = useState<string>("{}\n");

  //3.- Build the checker function so we can reuse it for the auto probe and manual retry button.
  const browserHttpUrl = useMemo(() => resolveBrowserUrl(config.httpUrl), [config.httpUrl]);
  const browserWsUrl = useMemo(() => resolveBrowserUrl(config.wsUrl), [config.wsUrl]);

  const runDiagnostics = useCallback(async () => {
    setState("checking");
    setMessage("Pinging broker diagnostics endpoint...");

    try {
      const statsUrl = new URL("/api/stats", browserHttpUrl);
      const response = await fetch(statsUrl.toString(), {
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`Broker replied with status ${response.status}`);
      }

      const payload = await response.json();
      setState("ok");
      setMessage("Broker responded successfully.");
      setStatsJson(JSON.stringify(payload, null, 2));
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Unknown diagnostics failure");
      setStatsJson("{}\n");
    } finally {
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, [browserHttpUrl]);

  //4.- Trigger the diagnostics probe when the component first hydrates on the client.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    runDiagnostics().catch((error) => {
      console.error("Diagnostics bootstrap failed", error);
    });
  }, [runDiagnostics]);

  return (
    <section>
      <header>
        <h1>DriftPursuit Diagnostics</h1>
        <p>
          WebSocket target: <code>{browserWsUrl}</code>
          <br />HTTP target: <code>{browserHttpUrl}</code>
        </p>
      </header>
      <p role="status" aria-live="polite">
        Status: <strong>{state.toUpperCase()}</strong>
      </p>
      <p>{message}</p>
      {lastChecked ? <p>Last checked at {lastChecked}</p> : null}
      <button type="button" onClick={runDiagnostics}>
        Run diagnostics again
      </button>
      <details open>
        <summary>Latest /api/stats payload</summary>
        <pre>{statsJson}</pre>
      </details>
      <p>
        Visit <code>{browserWsUrl}</code> from your bot runner or use the in-browser
        inspector to monitor live telemetry.
      </p>
    </section>
  );
}
