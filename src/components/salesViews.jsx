import { addDays } from "../lib/utils";
import { batchTankIds, isScheduledBatch, sortedTanks, occupyingBatch } from "../lib/production";
import { TankWallCard } from "./tanks";

// ─── Sales: what's in each tank and what's coming ───────────────────────────
// Read-only. For each fermenter or brite: the beer in it now, how far along
// it is and roughly when it'll be ready to package; then the brews planned
// into that tank. Below, every planned brew in date order.

const fmt = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" }) : "");
const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px" };
const head = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", margin: "18px 0 8px" };

export function SalesTanksView({ tanks, batches, onOpenBatch }) {
  const planned = batches.filter((b) => !b.mergedIntoBatchId && isScheduledBatch(b)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const vessels = sortedTanks(tanks).filter((t) => t.type === "Fermenter" || t.type === "Brite Tank");
  const ready = (b) => (b.plannedDays ? addDays(b.startDate, b.plannedDays) : null);
  const tankNames = (b) => batchTankIds(b).map((id) => tanks.find((t) => t.id === id)?.name).filter(Boolean).join(" + ");

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{`
        @keyframes bp-wave-drift { from { transform: translateX(0); } to { transform: translateX(-60px); } }
        @keyframes bp-swirl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          [style*="bp-wave-drift"], [style*="bp-swirl-spin"] { animation: none !important; }
        }
      `}</style>
      {[
        { label: "Fermenters", type: "Fermenter" },
        { label: "Brite tanks", type: "Brite Tank" },
      ].map(({ label, type }) => {
        const group = vessels.filter((t) => t.type === type);
        if (!group.length) return null;
        return (
          <div key={type}>
            <div style={head}>{label}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12, alignItems: "start" }}>
              {group.map((t) => {
                const occ = occupyingBatch(batches, t.id);
                const scheduled = occ && isScheduledBatch(occ);
                const now = scheduled ? null : occ;
                const r = now && ready(now);
                const next = planned.filter((b) => batchTankIds(b).includes(t.id))[0];
                return (
                  <div key={t.id}>
                    <TankWallCard tank={t} batch={now} scheduledBatch={scheduled ? occ : null} onOpen={onOpenBatch} readOnly />
                    {(r || (next && !scheduled)) && (
                      <div style={{ fontSize: 11, color: "#9BA88A", textAlign: "center", marginTop: 5, lineHeight: 1.4 }}>
                        {r && now.stage !== "Packaging" && <div>Ready ~{fmt(r)}</div>}
                        {next && !scheduled && <div>Next: {next.name} {fmt(next.startDate)}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

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
      <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 14 }}>Ready dates are estimates from each batch's planned days.</div>
    </div>
  );
}
