import { addDays } from "../lib/utils";
import { batchTankIds, isScheduledBatch, sortedTanks, remainingVolume } from "../lib/production";
import { today } from "../lib/utils";

// ─── Sales: what's in each tank and what's coming ───────────────────────────
// Read-only. For each fermenter or brite: the beer in it now, how far along
// it is and roughly when it'll be ready to package; then the brews planned
// into that tank. Below, every planned brew in date order.

const fmt = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" }) : "");
const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px" };
const head = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", margin: "18px 0 8px" };

export function SalesTanksView({ tanks, batches, onOpenBatch }) {
  const t0 = today();
  const live = batches.filter((b) => !b.mergedIntoBatchId && !isScheduledBatch(b) && b.stage !== "Packaged" && b.stage !== "Aging");
  const planned = batches.filter((b) => !b.mergedIntoBatchId && isScheduledBatch(b)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const vessels = sortedTanks(tanks).filter((t) => !["Mash Tun", "Kettle"].includes(t.type));
  const ready = (b) => (b.plannedDays ? addDays(b.startDate, b.plannedDays) : null);
  const tankNames = (b) => batchTankIds(b).map((id) => tanks.find((t) => t.id === id)?.name).filter(Boolean).join(" + ");

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={head}>In the tanks now</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {vessels.map((t) => {
          const now = live.find((b) => batchTankIds(b).includes(t.id));
          const next = planned.filter((b) => batchTankIds(b).includes(t.id));
          const r = now && ready(now);
          return (
            <div key={t.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, color: "#2A3324" }}>{t.name}</div>
                <div style={{ fontSize: 11.5, color: "#9BA88A" }}>{t.capacity}L {t.type}</div>
              </div>
              {now ? (
                <button type="button" onClick={() => onOpenBatch && onOpenBatch(now.id)} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, marginTop: 4, cursor: onOpenBatch ? "pointer" : "default" }}>
                  <div style={{ fontSize: 14, color: "#2A3324" }}>
                    {now.name} <span style={{ color: "#9BA88A", fontSize: 12 }}>#{now.number}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#5C6B54", marginTop: 2 }}>
                    {now.stage}{now.stage === "Packaging" ? ` · ${Math.round(remainingVolume(now))}L still to package` : ""} · in since {fmt(now.startDate)}
                    {r && now.stage !== "Packaging" ? ` · ready about ${fmt(r)}` : ""}
                  </div>
                </button>
              ) : (
                <div style={{ fontSize: 13, color: "#9BA88A", marginTop: 4 }}>Empty</div>
              )}
              {next.length > 0 && (
                <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 6, paddingTop: 6, borderTop: "1px solid #EEF0E2" }}>
                  Next: {next.slice(0, 3).map((b) => `${b.name} (${fmt(b.startDate)})`).join(" · ")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={head}>Coming up</div>
      {planned.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9BA88A" }}>No brews planned yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {planned.map((b) => {
            const r = ready(b);
            return (
              <div key={b.id} style={{ ...card, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: "#2A3324" }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: "#9BA88A" }}>{tankNames(b) || "No tank yet"} · {b.volume ? `${b.volume}L` : ""}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 12.5, color: "#5C6B54", whiteSpace: "nowrap" }}>
                  Brew {fmt(b.startDate)}
                  {r && <div style={{ fontSize: 11.5, color: "#9BA88A" }}>ready ~{fmt(r)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {t0 && <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 14 }}>Ready dates are estimates from each batch's planned days.</div>}
    </div>
  );
}
