export interface DamageBreakdownEntry {
  source: string;
  amount: number;
}

const damagePrefix = "damage_";

//1.- extractDamageBreakdown maps metadata entries into structured breakdown entries for HUD widgets.
export function extractDamageBreakdown(metadata: Record<string, string>): DamageBreakdownEntry[] {
  const entries: DamageBreakdownEntry[] = [];
  Object.entries(metadata)
    .filter(([key]) => key.startsWith(damagePrefix) && key !== "damage_total" && key !== "damage_instant_kill")
    .forEach(([key, value]) => {
      const amount = Number.parseFloat(value);
      if (Number.isNaN(amount)) {
        return;
      }
      const source = key.substring(damagePrefix.length);
      if (!source) {
        return;
      }
      entries.push({ source, amount });
    });
  //2.- Sort descending so the HUD emphasises the largest contributor first.
  entries.sort((a, b) => b.amount - a.amount || a.source.localeCompare(b.source));
  return entries;
}

//2.- formatDamageSummary converts the breakdown into human readable HUD strings.
export function formatDamageSummary(metadata: Record<string, string>): string[] {
  const breakdown = extractDamageBreakdown(metadata);
  if (breakdown.length === 0) {
    return [];
  }
  const total = metadata["damage_total"] ?? "0";
  const header = `Total ${total}`;
  const lines = breakdown.map((entry) => `${entry.source.toUpperCase()} ${entry.amount.toFixed(2)}`);
  lines.unshift(header);
  if (metadata["damage_instant_kill"] === "true") {
    lines.push("INSTANT KILL");
  }
  return lines;
}
