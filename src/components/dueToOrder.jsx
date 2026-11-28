import { useMemo } from "react";
import { canonicalBeerName, CANS_PER_CASE } from "../lib/production";

// Regular venues that have gone quiet: venues that order often (at least
// 4 separate orders in the last two years) and are now well past their usual
// gap between orders. Occasional buyers are left out on purpose.
const DAY = 86400000;
const fmtDate = (d) => new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
const weeks = (days) => (days < 14 ? `${Math.round(days)} days` : `${Math.round(days / 7)} weeks`);

export function dueToOrderList(salesOrders, customers, now = new Date()) {
  const cutoff = now.getTime() - 730 * DAY;
  const byVenue = {};
  (salesOrders || []).forEach((o) => {
    if (o.status === "Draft" || o.status === "Cancelled" || !o.orderDate) return;
    const t = new Date(o.orderDate + "T12:00:00").getTime();
    if (t > now.getTime() + 60 * DAY) return;
    const cust = customers.find((c) => c.id === o.customerId);
    if (cust?.stoppedOrdering) return; // marked as no longer a customer
    const name = cust?.name || o.customerName;
    if (!name) return;
    const v = byVenue[name] || (byVenue[name] = { name, customerId: cust?.id || null, dates: new Set(), items: {} });
    v.dates.add(o.orderDate);
    if (t >= cutoff) (o.lines || []).forEach((l) => {
      const beer = l.mixedPackTypeId ? l.mixedPackTypeName : canonicalBeerName(l.batchName || "");
      const k = l.mixedPackTypeId ? beer : `${beer}${l.containerKey === "cans330" ? " 24-pack" : l.containerLabel ? ` ${l.containerLabel}` : ""}`;
      const q = l.containerKey === "cans330" ? (Number(l.qty) || 0) / CANS_PER_CASE : Number(l.qty) || 0;
      v.items[k] = (v.items[k] || 0) + q;
    });
  });
  const out = [];
  Object.values(byVenue).forEach((v) => {
    const all = [...v.dates].sort();
    const recent = all.filter((d) => new Date(d + "T12:00:00").getTime() >= cutoff);
    if (recent.length < 4) return; // occasional buyer
    const gaps = [];
    for (let i = 1; i < recent.length; i++) gaps.push((new Date(recent[i]) - new Date(recent[i - 1])) / DAY);
    gaps.sort((a, b) => a - b);
    const usual = gaps[Math.floor(gaps.length / 2)];
    if (!usual || usual > 90) return;
    const last = all[all.length - 1];
    const since = (now.getTime() - new Date(last + "T12:00:00").getTime()) / DAY;
    const dueAfter = Math.max(usual * 1.5, usual + 10);
    if (since < dueAfter || since > 548) return; // over 18 months: long gone, not a nudge
    const usually = Object.entries(v.items).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
    out.push({ name: v.name, customerId: v.customerId, usual, last, since, overdueBy: since - usual, orders: recent.length, usually, level: since >= usual * 3 ? "quiet" : "due" });
  });
  return out.sort((a, b) => b.since / b.usual - a.since / a.usual);
}

export function DueToOrder({ salesOrders, customers, onStopped }) {
  const list = useMemo(() => dueToOrderList(salesOrders, customers), [salesOrders, customers]);
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Regulars who are overdue</div>
      <div style={{ color: "#9BA88A", fontSize: 12, marginBottom: 8, lineHeight: 1.45 }}>Venues that order regularly (4+ orders in the last two years) and are now well past their usual gap. Worth a call or a visit.</div>
      {list.length === 0 && <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 8, padding: "12px 14px", fontSize: 13, color: "#5C6B54" }}>All your regulars are ordering on time. 👍</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((v) => (
          <div key={v.name} style={{ background: "#FFFFFF", border: `1px solid ${v.level === "quiet" ? "#E3B8A8" : "#E8DFC0"}`, borderLeft: `4px solid ${v.level === "quiet" ? "#C0573E" : "#D9A23A"}`, borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontWeight: 600, fontSize: 14.5, color: "#2A3324" }}>{v.name}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: v.level === "quiet" ? "#C0573E" : "#B07A2A", whiteSpace: "nowrap" }}>{v.level === "quiet" ? "Gone quiet" : "Due"}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "#5C6B54", marginTop: 3, lineHeight: 1.45 }}>
              Usually orders every {weeks(v.usual)} · last order {fmtDate(v.last)} ({weeks(v.since)} ago)
              {v.usually.length > 0 && <><br />Usually gets: {v.usually.join(", ")}</>}
            </div>
            {onStopped && v.customerId && (
              <button type="button" onClick={() => { const note = window.prompt(`Take ${v.name} off this list? Add a short reason (optional):`, ""); if (note !== null) onStopped(v.customerId, note); }} style={{ marginTop: 6, background: "none", border: "none", padding: 0, color: "#9BA88A", fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>
                No longer a customer
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
