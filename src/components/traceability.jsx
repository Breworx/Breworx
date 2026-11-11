import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import { canCasesText } from "./finishedStock";
import { EmptyState } from "./ui";
import { formatHistoryStamp } from "../lib/brewing";
import { CONTAINERS, packagingEvents, productKeyFor, sameItemName } from "../lib/production";
import { today } from "../lib/utils";

export const secondaryBtnStyle = {
  background: "#EBE8D6",
  border: "1px solid #C9D1AC",
  borderRadius: 5,
  padding: "10px",
  color: "#2A3324",
  fontFamily: "'Inter', sans-serif",
  fontSize: 12.5,
  cursor: "pointer",
};

// Estimated NZ Customs excise duty on packaged beer — grouped by month
// since that's the natural reporting cycle, broken down by the duty band
// each batch actually falls into. Built from packaging events + each
// batch's measured ABV (OG and its latest logged gravity reading).
// Real one-step-forward traceability: pick a received lot, and trace it
// through every batch that used it, then everywhere those batches went —
// direct sales, or folded into a mixed pack that was sold on. This is
// what an MPI or council audit actually tests, not just "we have a
// checklist for it."
// FIFO deduction shared by batch creation and manual adjustments — oldest
// lot first by default, or a chosen lot first if preferredLotId is given
// (falling through to the rest in order if that lot doesn't cover it all).
// Returns lots in their original array order so display order never shuffles.
export function deductFromLotsFIFO(lots, amount, preferredLotId) {
  let remainingToDeduct = amount;
  const lotsUsed = [];
  let costAccum = 0;
  const ordered = preferredLotId
    ? [...(lots || [])].sort((a, b) => (a.id === preferredLotId ? -1 : b.id === preferredLotId ? 1 : 0))
    : lots || [];
  const remainingById = {};
  ordered.forEach((lot) => {
    const currentRemaining = lot.remainingQty ?? lot.qty;
    if (remainingToDeduct <= 0 || currentRemaining <= 0) {
      remainingById[lot.id] = currentRemaining;
      return;
    }
    const take = Math.round(Math.min(currentRemaining, remainingToDeduct) * 100) / 100;
    remainingToDeduct = Math.round((remainingToDeduct - take) * 100) / 100;
    if (take > 0) {
      lotsUsed.push({ lotNumber: lot.lotNumber, qty: take });
      if (lot.unitCost != null) costAccum += take * lot.unitCost;
    }
    remainingById[lot.id] = Math.round((currentRemaining - take) * 100) / 100;
  });
  const updatedLots = (lots || []).map((lot) => ({ ...lot, remainingQty: remainingById[lot.id] }));
  return { updatedLots, lotsUsed, cost: Math.round(costAccum * 100) / 100 };
}

// What's needed across every scheduled (not-yet-brewed) batch, checked
// against current stock — a forecast, not a snapshot, since it's driven
// by what's coming up rather than just a fixed low-stock threshold.
// Ingredient quantities scale with the batch's own planned volume if it
// differs from the linked recipe's base volume.
export function ingredientsNeededForScheduled(batches, recipes, inventory) {
  const scheduled = batches.filter((b) => b.startDate > today() && b.stage === "Brewing");
  const needed = {};
  scheduled.forEach((b) => {
    const recipe = b.recipeId ? recipes.find((r) => r.id === b.recipeId) : null;
    const source = recipe && recipe.ingredients.length > 0 ? recipe.ingredients : b.ingredients || [];
    if (source.length === 0) return;
    const scale = recipe && recipe.volume > 0 && b.volume > 0 ? b.volume / recipe.volume : 1;
    source.forEach((ing) => {
      if (!ing.name || !ing.name.trim()) return;
      const key = ing.name.trim().toLowerCase();
      const scaledQty = (Number(ing.qty) || 0) * scale;
      if (!needed[key]) needed[key] = { name: ing.name.trim(), unit: ing.unit, totalQty: 0, batches: [] };
      needed[key].totalQty += scaledQty;
      needed[key].batches.push({ batchName: b.name, batchDate: b.startDate, qty: Math.round(scaledQty * 100) / 100 });
    });
  });
  return Object.values(needed)
    .map((n) => {
      const item = inventory.find((it) => sameItemName(it.name, n.name));
      const available = item ? item.qty : 0;
      const shortfall = Math.max(0, Math.round((n.totalQty - available) * 100) / 100);
      return { ...n, totalQty: Math.round(n.totalQty * 100) / 100, available, shortfall, inStock: !!item };
    })
    .sort((a, b) => b.shortfall - a.shortfall);
}

export function traceLot(item, lotNumber, batches, salesOrders, mixedPackAssemblies, customers) {
  const usageEntries = (item.history || []).filter((h) => h.type === "batch" && (h.lots || []).some((l) => l.lotNumber === lotNumber));
  return usageEntries
    .map((h) => {
      const qtyUsed = (h.lots || []).find((l) => l.lotNumber === lotNumber)?.qty || 0;
      const batch = batches.find((b) => h.note === `${b.name} (#${b.number})`);
      if (!batch) return null;
      // Draft and Cancelled orders don't count as product having actually
      // left the building — same definition of "sold" used everywhere
      // else in the app. Matters a lot here specifically, since this
      // feeds both the Traceability report and Mock Recall.
      const directOrders = salesOrders
        .filter((o) => o.status !== "Draft" && o.status !== "Cancelled")
        .flatMap((o) =>
          (o.lines || [])
            .filter((l) => l.batchId === batch.id)
            .map((l) => ({ order: o, line: l, customer: customers.find((c) => c.id === o.customerId) }))
        );
      const packAssemblies = mixedPackAssemblies.filter((a) => (a.composition || []).some((c) => c.batchId === batch.id));
      const packOrders = packAssemblies.flatMap((a) =>
        salesOrders
          .filter((o) => o.status !== "Draft" && o.status !== "Cancelled")
          .flatMap((o) =>
            (o.lines || [])
              .filter((l) => l.mixedPackTypeId === a.mixedPackTypeId && o.orderDate >= a.assembledDate)
              .map((l) => ({ order: o, line: l, customer: customers.find((c) => c.id === o.customerId), viaPack: a.mixedPackTypeName }))
          )
      );
      // Sold through Xero (incl. Upstock orders) — taken off this batch by the Xero sales check.
      const xeroSales = [...(batch.salesHistory || []), ...(batch.xeroSold || [])].filter((e) => Number(e.qty) > 0);
      return { batch, qtyUsed, date: h.date, directOrders, packAssemblies, packOrders, xeroSales };
    })
    .filter(Boolean);
}

// Ingredient lots that went into a batch, from each stock item's history.
export function lotsForBatch(batch, inventory) {
  const label = `${batch.name} (#${batch.number})`;
  return inventory.flatMap((it) =>
    (it.history || [])
      .filter((h) => h.type === "batch" && h.note === label)
      .flatMap((h) => (h.lots || []).map((l) => ({ item: it.name, lotNumber: l.lotNumber, qty: l.qty, unit: it.unit })))
  );
}

// Backwards from a customer or venue: every batch they've had (Xero/Upstock
// invoices and Brewpoint orders) and the ingredient lots in each.
export function CustomerTrace({ inventory, batches, salesOrders, customers }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [focused, setFocused] = useState(false);
  const norm = (n) => String(n || "").trim().toLowerCase();
  const names = useMemo(() => {
    const set = new Map();
    batches.forEach((b) => [...(b.xeroSold || []), ...(b.salesHistory || [])].forEach((e) => { if (e.customer) set.set(norm(e.customer), e.customer); }));
    salesOrders.forEach((o) => { const c = customers.find((x) => x.id === o.customerId); if (c?.name) set.set(norm(c.name), c.name); });
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [batches, salesOrders, customers]);
  const matches = names.filter((n) => norm(n).includes(norm(query))).slice(0, 40);
  const sales = useMemo(() => {
    if (!picked) return [];
    const out = [];
    batches.forEach((b) =>
      [...(b.xeroSold || []), ...(b.salesHistory || [])].forEach((e) => {
        if (norm(e.customer) === norm(picked) && Number(e.qty) !== 0) out.push({ batch: b, date: e.date, qty: Number(e.qty), containerKey: e.containerKey, ref: String(e.docNumber || "").startsWith("Xero sales") ? "Xero summary" : `Xero ${e.docNumber || "invoice"}` });
      })
    );
    salesOrders
      .filter((o) => o.status !== "Draft" && o.status !== "Cancelled" && norm(customers.find((c) => c.id === o.customerId)?.name) === norm(picked))
      .forEach((o) =>
        (o.lines || []).forEach((l) => {
          const b = batches.find((x) => x.id === l.batchId);
          if (b) out.push({ batch: b, date: o.orderDate, qty: Number(l.qty), containerKey: l.containerKey, label: l.containerLabel, ref: `Order #${o.orderNumber}` });
        })
      );
    return out;
  }, [picked, batches, salesOrders, customers]);
  const byBatch = useMemo(() => {
    const g = {};
    sales.forEach((x) => (g[x.batch.id] = g[x.batch.id] || { batch: x.batch, lines: [] }).lines.push(x));
    return Object.values(g).sort((a, b) => String(b.lines[0].date).localeCompare(String(a.lines[0].date)));
  }, [sales]);
  const qtyText = (x) => {
    const n = Math.abs(x.qty);
    const what = x.containerKey === "cans330" ? canCasesText(n) : `${n} × ${x.label || CONTAINERS.find((c) => c.key === x.containerKey)?.shortLabel || x.containerKey}`;
    return x.qty < 0 ? `${what} returned` : what;
  };
  return (
    <div>
      <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 14 }}>
        Pick a customer or venue to see every batch they've received — from Xero invoices (including Upstock orders) and Brewpoint orders — and the ingredient lots that went into each one.
      </div>
      <div style={{ position: "relative", marginBottom: 18 }}>
        <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Customer</div>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPicked(""); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={names.length ? "Search customers…" : "No customers yet — sales show up once Xero is connected and items are matched"}
          style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
        />
        {focused && matches.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 240, overflowY: "auto" }}>
            {matches.map((n) => (
              <button key={n} onMouseDown={() => { setPicked(n); setQuery(n); setFocused(false); }} style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}>
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
      {picked && byBatch.length === 0 && <EmptyState icon={Search} title="Nothing found for this customer" subtitle="No invoices or orders linked to a batch yet." />}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {byBatch.map(({ batch, lines }) => {
          const lots = lotsForBatch(batch, inventory);
          const juice = (batch.dayRecipe?.lots || batch.juiceIntake || []).filter((l) => l.itemName || l.lotNumber);
          return (
            <div key={batch.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, color: "#2A3324" }}>
                {batch.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>#{batch.number}</span>
              </div>
              <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 8 }}>Brewed {batch.startDate}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {lines.sort((a, b) => String(b.date).localeCompare(String(a.date))).map((x, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "6px 10px", background: "#EEF4FA", border: "1px solid #C9DBEC", borderRadius: 4 }}>
                    <span style={{ color: "#2A3324" }}>{qtyText(x)}</span>
                    <span style={{ color: "#9BA88A", whiteSpace: "nowrap" }}>{x.ref} · {x.date}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Ingredient lots in this batch</div>
              {lots.length === 0 && juice.length === 0 ? (
                <div style={{ color: "#9BA88A", fontSize: 12.5 }}>No lots recorded — ingredients weren't taken from stock with lot numbers for this batch.</div>
              ) : (
                <div style={{ fontSize: 12.5, color: "#2A3324", lineHeight: 1.6 }}>
                  {lots.map((l, i) => <div key={i}>{l.item} — lot {l.lotNumber || "—"} ({l.qty} {l.unit})</div>)}
                  {lots.length === 0 && juice.map((l, i) => <div key={`j${i}`}>{l.itemName || "Juice"} — lot {l.lotNumber || "—"} ({l.litres} L)</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Past Xero invoices, for tracing only: who got which batch, worked out the
// same way as live sales (oldest packaged batch first, never more than the
// batch packaged in that container by the invoice date) but without taking
// any stock off — that stock was already cleared or matched.
export function planXeroSalesHistory({ docs, beforeDate, salesMap, itemMappings, batches }) {
  const mapByCode = {};
  (salesMap || []).forEach((m) => (mapByCode[String(m.xero_item_code).toLowerCase()] = m));
  const resolve = (code) => {
    const m = mapByCode[String(code).toLowerCase()];
    if (m) {
      if (m.ignore) return { ignore: true };
      if (m.product_key) return { productKey: m.product_key, containerKey: m.container_key || m.product_key.split("::")[1], units: Number(m.units_per_xero_unit) || 1 };
    }
    const fm = (itemMappings || []).find((x) => String(x.xero_item_code).toLowerCase() === String(code).toLowerCase());
    if (fm) return { productKey: fm.product_key, containerKey: fm.product_key.split("::")[1], units: 1 };
    return null;
  };
  const used = {}; // batchId::container -> units placed so far
  const packedBy = (b, containerKey, date) => packagingEvents(b).filter((e) => !e.date || e.date <= date).reduce((t, e) => t + (Number(e[containerKey]) || 0), 0);
  const firstPacked = (b) => packagingEvents(b).reduce((m, e) => (e.date && (!m || e.date < m) ? e.date : m), "");
  const out = {}; // batchId -> entries
  const summary = { lines: 0, placed: 0, unplaced: 0, unmapped: new Set() };
  [...(docs || [])]
    .filter((d) => d.date && d.date < beforeDate && (d.status === "AUTHORISED" || d.status === "PAID"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((doc) =>
      doc.lines.forEach((line) => {
        const map = resolve(line.itemCode);
        if (!map) { summary.unmapped.add(line.itemCode); return; }
        if (map.ignore) return;
        summary.lines += 1;
        const sign = doc.docType === "credit" ? -1 : 1;
        let units = Math.round(Math.abs(line.qty) * map.units);
        const candidates = batches
          .filter((b) => !b.mergedIntoBatchId && productKeyFor(b.name, map.containerKey) === map.productKey && firstPacked(b) && firstPacked(b) <= doc.date)
          .sort((a, b) => firstPacked(a).localeCompare(firstPacked(b)));
        for (const b of candidates) {
          if (units <= 0) break;
          const k = `${b.id}::${map.containerKey}`;
          const room = packedBy(b, map.containerKey, doc.date) - (used[k] || 0);
          if (room <= 0) continue;
          const take = sign > 0 ? Math.min(room, units) : units;
          used[k] = (used[k] || 0) + (sign > 0 ? take : 0);
          (out[b.id] = out[b.id] || []).push({ source: "xero-history", lineId: line.lineId, docNumber: doc.number, date: doc.date, containerKey: map.containerKey, qty: sign * take, customer: doc.contactName || "" });
          units -= take;
          summary.placed += take;
        }
        if (units > 0) summary.unplaced += units;
      })
    );
  return { byBatch: out, summary: { ...summary, unmapped: [...summary.unmapped] } };
}

export function TraceabilityView(props) {
  const [mode, setMode] = useState("lot");
  return (
    <div>
      <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 5, overflow: "hidden", marginBottom: 16 }}>
        {[["lot", "From an ingredient lot"], ["customer", "From a customer"]].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} style={{ flex: 1, background: mode === k ? "#5C9A3C" : "#F5F1E4", border: "none", padding: "10px", color: mode === k ? "#16191A" : "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13.5, fontWeight: mode === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
        ))}
      </div>
      {mode === "lot" ? <LotTraceView {...props} /> : <CustomerTrace {...props} />}
    </div>
  );
}

export function LotTraceView({ inventory, batches, salesOrders, mixedPackAssemblies, customers }) {
  const [itemId, setItemId] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemFocused, setItemFocused] = useState(false);
  const [lotNumber, setLotNumber] = useState("");
  const [lotQuery, setLotQuery] = useState("");
  const [lotFocused, setLotFocused] = useState(false);

  const item = inventory.find((it) => it.id === itemId);
  const lots = item ? [...new Map((item.lots || []).map((l) => [l.lotNumber, l])).values()] : [];
  const trace = item && lotNumber ? traceLot(item, lotNumber, batches, salesOrders, mixedPackAssemblies, customers) : [];

  const itemMatches = inventory.filter((it) => it.name.toLowerCase().includes(itemQuery.trim().toLowerCase()));
  const lotMatches = lots.filter((l) => l.lotNumber.toLowerCase().includes(lotQuery.trim().toLowerCase()));

  const pickItem = (it) => {
    setItemId(it.id);
    setItemQuery(it.name);
    setItemFocused(false);
    setLotNumber("");
    setLotQuery("");
  };
  const pickLot = (l) => {
    setLotNumber(l.lotNumber);
    setLotQuery(l.lotNumber);
    setLotFocused(false);
  };

  return (
    <div>
      <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 18 }}>
        Pick a received lot and see exactly which batches used it, and everywhere those batches went — direct sales, or folded into a mixed pack that was sold on. This is one-step-forward traceability: proof you could isolate and account for a specific lot if you ever needed to.
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Ingredient</div>
          <input
            type="text"
            value={itemQuery}
            onChange={(e) => {
              setItemQuery(e.target.value);
              if (itemId) { setItemId(""); setLotNumber(""); setLotQuery(""); }
            }}
            onFocus={() => setItemFocused(true)}
            onBlur={() => setTimeout(() => setItemFocused(false), 150)}
            placeholder="Search ingredients…"
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
          {itemFocused && itemMatches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 220, overflowY: "auto" }}>
              {itemMatches.map((it) => (
                <button
                  key={it.id}
                  onMouseDown={() => pickItem(it)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                >
                  {it.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1, position: "relative" }}>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Lot</div>
          <input
            type="text"
            value={lotQuery}
            onChange={(e) => {
              setLotQuery(e.target.value);
              if (lotNumber) setLotNumber("");
            }}
            onFocus={() => setLotFocused(true)}
            onBlur={() => setTimeout(() => setLotFocused(false), 150)}
            disabled={!item}
            placeholder={item ? "Search lots…" : "Choose an ingredient first"}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
          {lotFocused && lotMatches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 220, overflowY: "auto" }}>
              {lotMatches.map((l) => (
                <button
                  key={l.lotNumber}
                  onMouseDown={() => pickLot(l)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                >
                  {l.lotNumber}{l.date ? ` — received ${formatHistoryStamp(l.date)}` : ""}
                </button>
              ))}
            </div>
          )}
          {item && lotFocused && lots.length === 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, padding: "9px 10px", color: "#9BA88A", fontSize: 12.5 }}>
              No lots received for this ingredient yet — lots are created when a Purchase Order is received with a lot number.
            </div>
          )}
        </div>
      </div>

      {item && lotNumber && (
        trace.length === 0 ? (
          <EmptyState icon={Search} title="This lot hasn't been used in a batch yet" subtitle="Nothing to trace — it's still sitting in inventory, or was never drawn on." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {trace.map(({ batch, qtyUsed, date, directOrders, packAssemblies, packOrders, xeroSales = [] }) => (
              <div key={batch.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, color: "#2A3324" }}>
                  {batch.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>#{batch.number}</span>
                </div>
                <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 10 }}>
                  Used {qtyUsed} {item.unit} on {formatHistoryStamp(date)} — currently {batch.stage}
                </div>

                {directOrders.length === 0 && packOrders.length === 0 && xeroSales.length === 0 ? (
                  <div style={{ color: "#9BA88A", fontSize: 12.5 }}>Not yet on any sales order — still in production or in stock.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {xeroSales.map((e, i) => (
                      <div key={`x-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "6px 10px", background: "#EEF4FA", border: "1px solid #C9DBEC", borderRadius: 4 }}>
                        <span style={{ color: "#2A3324" }}>{e.customer || "Customer not recorded"} — {e.containerKey === "cans330" ? canCasesText(e.qty) : `${e.qty} × ${CONTAINERS.find((c) => c.key === e.containerKey)?.shortLabel || e.containerKey}`}</span>
                        <span style={{ color: "#9BA88A", whiteSpace: "nowrap" }}>Xero {e.docNumber || "invoice"} · {e.date}</span>
                      </div>
                    ))}
                    {directOrders.map((d, i) => (
                      <div key={`d-${i}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                        <span style={{ color: "#2A3324" }}>{d.customer ? d.customer.name : "Unknown customer"} — {d.line.qty} × {d.line.containerLabel}</span>
                        <span style={{ color: "#9BA88A" }}>Order #{d.order.orderNumber} · {d.order.orderDate}</span>
                      </div>
                    ))}
                    {packOrders.map((d, i) => (
                      <div key={`p-${i}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "6px 10px", background: "#F5F0FA", border: "1px solid #DCC9EC", borderRadius: 4 }}>
                        <span style={{ color: "#2A3324" }}>{d.customer ? d.customer.name : "Unknown customer"} — via {d.viaPack} ({d.line.qty} pack{d.line.qty !== 1 ? "s" : ""})</span>
                        <span style={{ color: "#9BA88A" }}>Order #{d.order.orderNumber} · {d.order.orderDate}</span>
                      </div>
                    ))}
                  </div>
                )}
                {packOrders.length > 0 && (
                  <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
                    Pack-level trace — this batch went into that pack type, but individual packs aren't serial-tracked, so this shows every order of that pack type placed after assembly.
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
