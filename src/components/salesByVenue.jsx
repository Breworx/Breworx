import { useMemo, useState } from "react";
import { canonicalBeerName, CANS_PER_CASE } from "../lib/production";

// Who bought what, month by month: every order (Xero invoices included),
// grouped by venue, with quantities in kegs and cases and the ex-GST total.
const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-NZ", { month: "long", year: "numeric" });
};
const qtyText = (key, qty) => {
  if (key === "cans330") {
    const cases = qty / CANS_PER_CASE;
    if (Number.isInteger(cases)) return `${cases} × 24-pack`;
    return `${qty} cans (${Math.round(cases * 10) / 10} cases)`;
  }
  return `${qty} ×`;
};

export function SalesByVenue({ salesOrders, customers }) {
  const orders = useMemo(() => (salesOrders || []).filter((o) => o.status !== "Draft" && o.status !== "Cancelled" && o.orderDate), [salesOrders]);
  const months = useMemo(() => [...new Set(orders.map((o) => o.orderDate.slice(0, 7)))].sort().reverse(), [orders]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(months.includes(thisMonth) ? thisMonth : months[0] || thisMonth);
  const [showPending, setShowPending] = useState(true);
  const [open, setOpen] = useState({});

  const data = useMemo(() => {
    const venues = {};
    let pendingCount = 0;
    orders.filter((o) => o.orderDate.slice(0, 7) === month).forEach((o) => {
      const pending = o.status !== "Fulfilled";
      if (pending) { if (!showPending) return; pendingCount += 1; }
      const cust = customers.find((c) => c.id === o.customerId);
      const name = cust?.name || o.customerName || "Unknown customer";
      const v = venues[name] || (venues[name] = { name, total: 0, orders: new Set(), lines: {}, kegs: 0, cases: 0, litres: 0, pending: false });
      v.orders.add(o.orderNumber || o.id);
      if (pending) v.pending = true;
      (o.lines || []).forEach((l) => {
        const qty = pending ? Number(l.qty) || 0 : Number(l.fulfilledQty) > 0 ? Number(l.fulfilledQty) : Number(l.qty) || 0;
        if (qty <= 0) return;
        const revenue = qty * (Number(l.unitPrice) || 0);
        const beer = l.mixedPackTypeId ? l.mixedPackTypeName : canonicalBeerName(l.batchName || l.name || "Item");
        const ck = l.mixedPackTypeId ? "mixed" : l.containerKey || "other";
        const key = `${beer}::${ck}`;
        const line = v.lines[key] || (v.lines[key] = { beer, containerKey: ck, label: l.mixedPackTypeId ? "" : l.containerLabel || "", qty: 0, revenue: 0 });
        line.qty += qty;
        line.revenue += revenue;
        v.total += revenue;
        if (ck === "cans330") { v.cases += qty / CANS_PER_CASE; v.litres += qty * 0.33; }
        else if (/^kegs(\d+)$/.test(ck)) { v.kegs += qty; v.litres += qty * Number(ck.slice(4)); }
      });
    });
    const list = Object.values(venues).filter((v) => Object.keys(v.lines).length).sort((a, b) => b.total - a.total);
    const totals = list.reduce((t, v) => ({ total: t.total + v.total, kegs: t.kegs + v.kegs, cases: t.cases + v.cases, litres: t.litres + v.litres }), { total: 0, kegs: 0, cases: 0, litres: 0 });
    return { list, totals, pendingCount };
  }, [orders, customers, month, showPending]);

  const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 8, padding: "12px 14px" };
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>Sales by venue</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: "9px 12px", borderRadius: 6, border: "1px solid #DDE0C8", background: "#FFFFFF", fontSize: 14, color: "#2A3324" }}>
          {(months.length ? months : [thisMonth]).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#5C6B54" }}>
          <input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} style={{ accentColor: "#5C9A3C" }} />
          Include orders not yet delivered
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 12 }}>
        {[["Venues", data.list.length], ["Sales (ex GST)", money(data.totals.total)], ["Kegs", data.totals.kegs], ["24-packs", Math.round(data.totals.cases * 10) / 10], ["Litres", Math.round(data.totals.litres)]].map(([k, v]) => (
          <div key={k} style={card}><div style={{ fontSize: 11, color: "#9BA88A" }}>{k}</div><div style={{ fontSize: 18, fontWeight: 600, color: "#2A3324" }}>{v}</div></div>
        ))}
      </div>
      {data.pendingCount > 0 && <div style={{ fontSize: 12, color: "#9BA88A", marginBottom: 8 }}>Includes {data.pendingCount} order{data.pendingCount === 1 ? "" : "s"} not yet delivered (marked "pending").</div>}
      {data.list.length === 0 && <div style={{ ...card, color: "#9BA88A", fontSize: 13 }}>No sales recorded for {monthName(month)}.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.list.map((v) => {
          const isOpen = open[v.name] ?? true;
          const lines = Object.values(v.lines).sort((a, b) => b.revenue - a.revenue);
          return (
            <div key={v.name} style={card}>
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [v.name]: !isOpen }))} style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontWeight: 600, color: "#2A3324", fontSize: 14.5 }}>{v.name}{v.pending && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: "#B07A2A" }}>pending</span>}</span>
                <span style={{ fontWeight: 600, color: "#2A3324", fontSize: 14.5, whiteSpace: "nowrap" }}>{money(v.total)}</span>
              </button>
              <div style={{ fontSize: 12, color: "#9BA88A", marginTop: 2 }}>
                {v.orders.size} order{v.orders.size === 1 ? "" : "s"}{v.kegs ? ` · ${v.kegs} keg${v.kegs === 1 ? "" : "s"}` : ""}{v.cases ? ` · ${Math.round(v.cases * 10) / 10} × 24-pack` : ""} · {Math.round(v.litres)} L
              </div>
              {isOpen && (
                <div style={{ marginTop: 8, borderTop: "1px solid #EEF0E2", paddingTop: 6 }}>
                  {lines.map((l) => (
                    <div key={l.beer + l.containerKey} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "#2A3324", padding: "3px 0" }}>
                      <span>{l.containerKey === "cans330" ? `${qtyText("cans330", l.qty)} ${l.beer}` : l.containerKey === "mixed" ? `${l.qty} × ${l.beer}` : `${l.qty} × ${l.beer}${l.label ? ` (${l.label})` : ""}`}</span>
                      <span style={{ color: "#5C6B54", whiteSpace: "nowrap" }}>{money(l.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
