// "Order soon" on Consumables: when cans, lids, cartons and labels run out
// at the rate they're being used, and when to order them.
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { reorderForecast, DEFAULT_LEAD_DAYS } from "../lib/reorder";

const ink = "#2A3324", muted = "#5C6B54", faint = "#9BA88A", warn = "#B5502F", amber = "#8A6D0B";
const fmt = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "2-digit" }) : "—");

export function ReorderPanel({ consumables, batches, packageTypes, salesOrders, onSetLeadDays }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const rows = reorderForecast({ consumables, batches, packageTypes, salesOrders });
  const urgent = rows.filter((r) => r.status === "order_now" || r.status === "order_soon");
  const shown = open ? rows.filter((r) => r.status !== "idle") : urgent;
  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${urgent.length ? "#E4C9B8" : "#DDE0C8"}`, borderRadius: 6, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: urgent.length ? warn : faint }}>
          {urgent.length > 0 && <AlertTriangle size={13} />}
          {urgent.length ? `${urgent.length} to order soon` : "Nothing to order yet"}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", color: muted, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
          {open ? "Just what's due" : "All run-out dates"} {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      {!urgent.length && !open && <div style={{ color: faint, fontSize: 12, marginTop: 4 }}>Worked out from your canning runs and can sales — you'll get a task on the order-by day.</div>}
      {shown.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {shown.map((r) => {
            const c = r.status === "order_now" ? warn : r.status === "order_soon" ? amber : muted;
            return (
              <div key={r.item.id} style={{ borderTop: "1px solid #EBE8D6", paddingTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: ink }}>
                  <span style={{ minWidth: 0 }}>{r.item.name}</span>
                  <span style={{ color: c, whiteSpace: "nowrap", fontSize: 12.5 }}>{r.status === "order_now" ? "Order now" : `Order by ${fmt(r.orderBy)}`}</span>
                </div>
                <div style={{ fontSize: 11.5, color: faint, marginTop: 2 }}>
                  {Math.round(r.qty)} left · ~{Math.round(r.perMonth)}/month · runs out ~{fmt(r.runOut)} ·{" "}
                  {editing === r.item.id ? (
                    <input
                      type="number" min="1" autoFocus defaultValue={r.lead}
                      onBlur={(e) => { const v = Number(e.target.value); setEditing(null); if (v > 0 && v !== r.lead) onSetLeadDays(r.item.id, Math.round(v)); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      style={{ width: 52, fontSize: 12, padding: "1px 4px", border: "1px solid #C9D1AC", borderRadius: 4 }}
                    />
                  ) : (
                    <button type="button" onClick={() => setEditing(r.item.id)} title={`Default for ${r.item.category}: ${DEFAULT_LEAD_DAYS[r.item.category]} days`} style={{ background: "none", border: "none", padding: 0, color: "#5C9A3C", fontSize: 11.5, cursor: "pointer", textDecoration: "underline dotted" }}>
                      {r.lead} days to arrive
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
