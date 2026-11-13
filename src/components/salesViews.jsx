import { addDays } from "../lib/utils";
import { batchTankIds, isScheduledBatch, learnedTankDays, sortedTanks, occupyingBatch } from "../lib/production";
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
  const tankDays = learnedTankDays(batches);
  const ready = (b) => { const d = tankDays.daysFor(b); return d ? addDays(b.startDate, d) : null; };
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

// ─── Sales: Upstock orders and back orders ─────────────────────────────────
// Read-only. Draft invoices waiting in Xero (Upstock orders): what stock is
// held for each and what's on back order, with when the beer should be
// ready. Updates by itself as Xero changes.
const qtyText = (key, n) => (key === "cans330" ? (n % 24 === 0 ? `${n / 24} case${n / 24 === 1 ? "" : "s"}` : `${n} cans`) : `${n} keg${n === 1 ? "" : "s"}`);

export function SalesOpenOrdersView({ salesOrders, customers, draftAlloc, etaFor }) {
  const drafts = salesOrders.filter((o) => o.source === "xero" && o.status === "Confirmed").sort((a, b) => String(a.orderDate || "").localeCompare(String(b.orderDate || "")));
  const nameOf = (id) => customers.find((c) => c.id === id)?.name || "Unknown customer";
  const owed = {};
  draftAlloc.backOrders.forEach((b) => {
    if (!owed[b.productKey]) owed[b.productKey] = { key: b.productKey, label: `${b.line.batchName} — ${b.line.containerLabel}`, containerKey: b.line.containerKey, qty: 0, orders: [] };
    owed[b.productKey].qty += b.qty;
    owed[b.productKey].orders.push(b);
  });
  const owedList = Object.values(owed).sort((a, b) => a.label.localeCompare(b.label));
  const etaText = (key) => {
    const e = etaFor ? etaFor(key) : null;
    if (!e) return null;
    if (!e.date) return "No brew planned yet";
    return `${e.kind === "tank" ? "In tank, ready" : e.kind === "scheduled" ? "Brew on the calendar, ready" : "Not on the calendar yet — earliest ready"} about ${fmt(e.date)}`;
  };
  return (
    <div>
      <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: "0 0 4px", fontWeight: 500 }}>Upstock orders</h1>
      <div style={{ fontSize: 12.5, color: "#5C6B54", marginBottom: 14, lineHeight: 1.5 }}>
        Draft invoices waiting in Xero. Stock is held for each one; anything not in stock is a back order. This updates by itself as orders change in Xero.
      </div>

      <div style={head}>Back orders ({owedList.length})</div>
      {owedList.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: "#5C6B54" }}>Nothing on back order — every open order is covered by stock on hand.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {owedList.map((g) => (
            <div key={g.key} style={{ ...card, borderColor: "#E8C9A8", background: "#FFFBF5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14, color: "#2A3324" }}>
                <span style={{ fontWeight: 500 }}>{g.label}</span>
                <strong>{qtyText(g.containerKey, g.qty)}</strong>
              </div>
              {etaText(g.key) && <div style={{ fontSize: 12, color: "#9A5A2E", marginTop: 3 }}>{etaText(g.key)}</div>}
              {g.orders.map((b) => (
                <div key={`${b.order.id}-${b.line.id}`} style={{ fontSize: 12, color: "#5C6B54", marginTop: 3 }}>
                  {b.order.orderNumber} · {nameOf(b.order.customerId)} · {qtyText(b.line.containerKey, b.qty)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={head}>Open orders ({drafts.length})</div>
      {drafts.length === 0 && <div style={{ ...card, fontSize: 13, color: "#5C6B54" }}>No draft orders in Xero right now.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {drafts.map((o) => {
          const alloc = draftAlloc.allocations[o.id] || {};
          return (
            <div key={o.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14.5, color: "#2A3324", fontWeight: 500 }}>{nameOf(o.customerId)}</span>
                <span style={{ fontSize: 12, color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>{o.orderNumber} · {fmt(o.orderDate)}</span>
              </div>
              {(o.lines || []).map((l) => {
                const a = alloc[l.id] || { reserved: [], backOrder: 0 };
                const held = a.reserved.reduce((t, r) => t + r.qty, 0);
                return (
                  <div key={l.id} style={{ padding: "5px 0", borderTop: "1px solid #F0EDE0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#2A3324" }}>
                      <span>{l.batchName} — {l.containerLabel}</span>
                      <span style={{ whiteSpace: "nowrap" }}>{qtyText(l.containerKey, l.qty)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                      {held > 0 && <span style={{ color: "#5C9A3C" }}>In stock: {qtyText(l.containerKey, held)}{a.reserved.length ? ` (batch ${a.reserved.map((r) => `#${r.batchNumber || "?"}`).join(", ")})` : ""}</span>}
                      {held > 0 && a.backOrder > 0 && " · "}
                      {a.backOrder > 0 && <span style={{ color: "#B5502F" }}>Back order: {qtyText(l.containerKey, a.backOrder)}</span>}
                    </div>
                  </div>
                );
              })}
              {o.notes && <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 4 }}>{o.notes}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
