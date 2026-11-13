import { useState } from "react";
import { Modal } from "./ui";

// ─── Order list and Home alerts ─────────────────────────────────────────────
// Built from lib/ingredientPlan (a month of brews: the calendar plus the
// planner's suggestions) and the brew plan's back orders.

const fmt = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" }) : "");
const num = (n) => (Math.round(n * 100) / 100).toLocaleString("en-NZ");
const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px", marginBottom: 12 };
const btn = { background: "#5C9A3C", border: "none", borderRadius: 5, padding: "7px 12px", color: "#16191A", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" };
const btn2 = { background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "7px 12px", color: "#2A3324", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" };

export function OrderListModal({ plan, onClose, onNewPO, onSettings }) {
  const [showCovered, setShowCovered] = useState(false);
  const bySupplier = {};
  plan.toOrder.forEach((r) => (bySupplier[r.supplier || "No supplier set"] = bySupplier[r.supplier || "No supplier set"] || []).push(r));
  const covered = plan.items.filter((r) => r.shortfall <= 0);
  return (
    <Modal title={`Order list — next ${plan.days % 30 === 0 ? `${plan.days / 30} month${plan.days === 30 ? "" : "s"}` : `${plan.days} days`}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {onSettings && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: "#5C6B54" }}>
            <label>Order covers{" "}
              <select value={plan.days} onChange={(e) => onSettings({ orderEveryDays: Number(e.target.value) })} style={{ fontSize: 13, padding: "4px 6px" }}>
                {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d === 45 ? "6 weeks" : `${d / 30} month${d === 30 ? "" : "s"}`}</option>)}
              </select>
            </label>
            <label>Extra for growth{" "}
              <select value={plan.bufferPct} onChange={(e) => onSettings({ orderBufferPct: Number(e.target.value) })} style={{ fontSize: 13, padding: "4px 6px" }}>
                {[0, 5, 10, 15, 20, 25].map((p) => <option key={p} value={p}>{p}%</option>)}
              </select>
            </label>
          </div>
        )}
        <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.5 }}>
          Order amounts include {plan.bufferPct}% extra in case sales pick up. Every brew from now to {fmt(plan.end)} — {plan.brews.filter((b) => b.kind === "scheduled").length} on the calendar and {plan.brews.filter((b) => b.kind === "suggested").length} the brew planner suggests — checked against what's in stock, in date order. "Order by" allows for each supplier's usual delivery time (7 days if there's no history yet).
        </div>
        {plan.toOrder.length === 0 ? (
          <div style={{ fontSize: 13, color: "#5C9A3C" }}>Nothing to order — you've got enough of everything for the next month.</div>
        ) : (
          Object.entries(bySupplier).sort((a, b) => a[0].localeCompare(b[0])).map(([sup, rows]) => (
            <div key={sup}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9A5A2E", marginBottom: 6 }}>{sup}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((r) => (
                  <div key={r.key} style={{ background: r.late ? "#FBE5D2" : "#FFFBF5", border: `1px solid ${r.late ? "#E3B37A" : "#E8C9A8"}`, borderRadius: 5, padding: "9px 11px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: "#2A3324" }}>
                      <span style={{ fontWeight: 500 }}>{r.name}{!r.inStock && <span style={{ color: "#B5502F", fontSize: 11 }}> · not in stock list</span>}</span>
                      <strong style={{ whiteSpace: "nowrap" }}>order {num(Math.ceil(r.shortfall * 10) / 10)} {r.unit}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 2 }}>
                      Need {num(r.needed)} {r.unit}, have {num(r.onHand)}. Runs out for the {fmt(r.shortBy)} brew
                      {r.orderBy ? <> · <strong style={{ color: r.late ? "#B5502F" : "#2A3324" }}>{r.late ? "order now" : `order by ${fmt(r.orderBy)}`}</strong></> : null}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 2 }}>
                      {r.brews.map((b) => `${fmt(b.date)} ${b.name}${b.kind === "suggested" ? " (suggested)" : ""}: ${num(b.qty)}`).join(" · ")}
                    </div>
                    {r.unitMismatch && <div style={{ fontSize: 11.5, color: "#B5502F" }}>The recipe's unit doesn't convert to the stock unit — check this one.</div>}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        {plan.noRecipe.length > 0 && (
          <div style={{ fontSize: 12, color: "#9A5A2E" }}>
            No recipe to work from for: {plan.noRecipe.map((b) => `${b.name} (${fmt(b.date)})`).join(", ")}. Link a recipe to include them.
          </div>
        )}
        {covered.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowCovered((v) => !v)} style={{ background: "none", border: "none", padding: 0, color: "#5C6B54", fontSize: 12.5, cursor: "pointer", textDecoration: "underline" }}>
              {showCovered ? "Hide" : "Show"} {covered.length} ingredient{covered.length === 1 ? "" : "s"} you've got enough of
            </button>
            {showCovered && covered.map((r) => (
              <div key={r.key} style={{ fontSize: 12.5, color: "#2A3324", padding: "4px 0", borderTop: "1px solid #F0EDE0" }}>
                {r.name}: need {num(r.needed)} {r.unit}, have {num(r.onHand)}
              </div>
            ))}
          </div>
        )}
        {onNewPO && plan.toOrder.length > 0 && <button type="button" onClick={onNewPO} style={{ ...btn, padding: "11px" }}>Start a purchase order</button>}
      </div>
    </Modal>
  );
}

// Home: what needs you now — back orders nothing covers, and what to order.
export function HomeAlerts({ brewPlan, ingPlan, backOrders = [], customers = [], onAddBrew, onOpenPlanner, onOpenOrderList }) {
  const [added, setAdded] = useState({});
  const [busy, setBusy] = useState(null);
  const uncovered = (brewPlan?.backOrders || []).filter((e) => e.needsBrew);
  const movable = (brewPlan?.backOrders || []).filter((e) => e.move);
  const toOrder = ingPlan?.toOrder || [];
  const urgent = toOrder.filter((r) => r.late || (r.orderBy && r.orderBy <= ingPlan.start));
  if (!uncovered.length && !movable.length && !toOrder.length) return null;
  const ordersFor = (name) => {
    const n = String(name || "").toLowerCase();
    return backOrders.filter((b) => String(b.line.batchName || "").toLowerCase() === n || String(b.productKey || "").startsWith(`${n}::`));
  };
  const nameOf = (id) => customers.find((c) => c.id === id)?.name || "a customer";
  return (
    <div style={{ marginBottom: 6 }}>
      {uncovered.map((e) => {
        const sug = brewPlan.suggestions.find((x) => x.key === e.key && x.startDate);
        const short = sug ? ingPlan?.perBrew?.[sug.id] || [] : [];
        const orders = ordersFor(e.name);
        return (
          <div key={e.key} style={{ ...card, borderColor: "#E3B37A", background: "#FFFBF5" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9A5A2E", marginBottom: 4 }}>Back order not covered</div>
            <div style={{ fontSize: 14.5, color: "#2A3324", fontWeight: 500 }}>{e.name} · {e.litres} L owed</div>
            {orders.length > 0 && <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 2 }}>{orders.map((b) => `${nameOf(b.order.customerId)} (${b.order.orderNumber})`).join(", ")}</div>}
            <div style={{ fontSize: 12.5, color: "#5C6B54", marginTop: 4 }}>
              Nothing in stock, in tank or on the calendar covers it.{sug ? ` Earliest brew ${fmt(sug.startDate)}${sug.tankName ? ` in ${sug.tankName}` : ""}, ready about ${fmt(sug.readyDate)}.` : " No free tank in the next 2 months."}
            </div>
            {short.length > 0 && (
              <div style={{ fontSize: 12, color: "#B5502F", marginTop: 3 }}>Short for this brew: {short.map((x) => `${x.name} ${num(x.short)} ${x.unit}`).join(", ")}</div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {sug && onAddBrew && (
                <button type="button" disabled={added[sug.id] || busy === sug.id} onClick={async () => { setBusy(sug.id); await onAddBrew(sug); setBusy(null); setAdded((p) => ({ ...p, [sug.id]: true })); }} style={{ ...btn, opacity: added[sug.id] ? 0.6 : 1 }}>
                  {added[sug.id] ? "Added ✓" : busy === sug.id ? "Adding…" : "Add brew"}
                </button>
              )}
              <button type="button" onClick={onOpenPlanner} style={btn2}>Brew planner</button>
            </div>
          </div>
        );
      })}
      {movable.length > 0 && (
        <div style={{ ...card, borderColor: "#E8C9A8" }}>
          <div style={{ fontSize: 13.5, color: "#2A3324" }}>
            {movable.length === 1 ? `The ${movable[0].name} brew` : `${movable.length} brews`} on the calendar could start sooner to cover back orders.
          </div>
          <button type="button" onClick={onOpenPlanner} style={{ ...btn2, marginTop: 8 }}>Review in the brew planner</button>
        </div>
      )}
      {toOrder.length > 0 && (
        <div style={{ ...card, borderColor: urgent.length ? "#E3B37A" : "#DDE0C8" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 14, color: "#2A3324", fontWeight: 500 }}>{toOrder.length} ingredient{toOrder.length === 1 ? "" : "s"} to order for the next {ingPlan.days === 60 ? "2 months" : ingPlan.days === 90 ? "3 months" : ingPlan.days === 30 ? "month" : `${ingPlan.days} days`}</div>
              <div style={{ fontSize: 12, color: urgent.length ? "#B5502F" : "#5C6B54", marginTop: 2 }}>
                {urgent.length
                  ? `Order now: ${urgent.slice(0, 4).map((r) => r.name).join(", ")}${urgent.length > 4 ? "…" : ""}`
                  : `First by ${fmt(toOrder.filter((r) => r.orderBy).map((r) => r.orderBy).sort()[0])}: ${toOrder.slice(0, 3).map((r) => r.name).join(", ")}${toOrder.length > 3 ? "…" : ""}`}
              </div>
            </div>
            <button type="button" onClick={onOpenOrderList} style={btn}>Order list</button>
          </div>
        </div>
      )}
    </div>
  );
}
