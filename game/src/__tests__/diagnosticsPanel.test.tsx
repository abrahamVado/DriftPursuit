import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";

const OK_RESPONSE = {
  ok: true,
  json: async () => ({ activeClients: 3 }),
  status: 200
};

const ERROR_RESPONSE = {
  ok: false,
  json: async () => ({}),
  status: 503
};

describe("DiagnosticsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows success feedback when the broker responds", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(OK_RESPONSE as Response);

    render(
      <DiagnosticsPanel
        config={{
          wsUrl: "ws://broker:43127/ws",
          httpUrl: "http://broker:43127"
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Broker responded successfully./i)).toBeTruthy();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:43127/api/stats",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/OK/i);
    expect(screen.getByText(/"activeClients": 3/i)).toBeTruthy();
  });

  it("surfaces an error when the diagnostics request fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(ERROR_RESPONSE as Response);

    render(
      <DiagnosticsPanel
        config={{
          wsUrl: "ws://broker:43127/ws",
          httpUrl: "http://broker:43127"
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Broker replied with status 503/i)).toBeTruthy();
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:43127/api/stats",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/ERROR/i);
  });
});
