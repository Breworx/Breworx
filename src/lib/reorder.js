// When cans, lids, cartons and labels will run out, from how fast they've
// actually been used, and when to order so the new stock lands in time.
// Cans, lids and cartons: from canning runs. Labels: from cans sold under
// the Xero item codes set on the label (so Gents and house labels on the
// same beer are told apart); a label with no codes falls back to the
// canning runs, using the label each run used.
import { CANS_PER_CASE, packagingEvents } from "./production";
import { labelForEvent } from "./batchCost";
import { addDays, daysBetween, today } from "./utils";

export const DEFAULT_LEAD_DAYS = { Label: 28, Can: 21, Lid: 21, Box: 10 };
const TRACKED = Object.keys(DEFAULT_LEAD_DAYS);
const WINDOW_DAYS = 180; // usage rate from the last six months of canning
const BUFFER_DAYS = 7; // order a week before the last safe day

export const leadDaysFor = (c) => (Number(c.leadDays) > 0 ? Number(c.leadDays) : DEFAULT_LEAD_DAYS[c.category] || 14);

export function reorderForecast({ consumables, batches, packageTypes, salesOrders, todayStr }) {
  const t = todayStr || today();
  const from = addDays(t, -WINDOW_DAYS);
  const items = (consumables || []).filter((c) => TRACKED.includes(c.category));
  const used = {};
  let firstRun = null;
  const newest = (cat) => items.filter((c) => c.category === cat).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
  const can = newest("Can"), lid = newest("Lid"), box = newest("Box");
  (batches || []).forEach((b) => {
    if (b.mergedIntoBatchId) return;
    packagingEvents(b).forEach((e) => {
      const n = Number(e.cans330) || 0;
      const d = String(e.date || "").slice(0, 10);
      if (!n || !d || d < from || d > t) return;
      if (!firstRun || d < firstRun) firstRun = d;
      const add = (item, q) => { if (item) used[item.id] = (used[item.id] || 0) + q; };
      add(can, n); add(lid, n); add(box, n / CANS_PER_CASE);
      const label = labelForEvent(b, e, consumables, packageTypes);
      if (label && !(label.salesCodes || []).length) add(label, n);
    });
  });
  // Labels with Xero codes: cans sold under those codes. If two labels share
  // a code (an old run and its reprint), it goes to the one with stock.
  const byCode = {};
  items.filter((c) => c.category === "Label").forEach((c) =>
    (c.salesCodes || []).forEach((code) => {
      const k = String(code).trim().toLowerCase();
      if (!byCode[k] || (Number(byCode[k].qty) <= 0 && Number(c.qty) > 0)) byCode[k] = c;
    })
  );
  let firstSale = null;
  (salesOrders || []).forEach((o) => {
    if (o.status === "Draft" || o.status === "Cancelled") return;
    const d = String(o.orderDate || "").slice(0, 10);
    if (!d || d < from || d > t) return;
    (o.lines || []).forEach((l) => {
      if (l.containerKey !== "cans330") return;
      const label = byCode[String(l.xeroItemCode || "").trim().toLowerCase()];
      if (!label) return;
      used[label.id] = (used[label.id] || 0) + (Number(l.qty) || 0);
      if (!firstSale || d < firstSale) firstSale = d;
    });
  });
  const spanFrom = (d) => Math.max(30, d ? daysBetween(d, t) : WINDOW_DAYS);
  const runSpan = spanFrom(firstRun), saleSpan = spanFrom(firstSale);
  return items
    .map((c) => {
      const bySales = c.category === "Label" && (c.salesCodes || []).length > 0;
      const perDay = (used[c.id] || 0) / (bySales ? saleSpan : runSpan);
      const qty = Math.max(0, Number(c.qty) || 0);
      const lead = leadDaysFor(c);
      if (perDay <= 0) return { item: c, perDay: 0, qty, lead, runOut: null, orderBy: null, status: "idle" };
      const daysLeft = Math.floor(qty / perDay);
      const runOut = addDays(t, daysLeft);
      const orderBy = addDays(runOut, -(lead + BUFFER_DAYS));
      const status = orderBy <= t ? "order_now" : daysBetween(t, orderBy) <= 21 ? "order_soon" : "ok";
      return { item: c, perDay, perMonth: perDay * 30, qty, lead, daysLeft, runOut, orderBy, status };
    })
    .sort((a, b) => String(a.orderBy || "9999").localeCompare(String(b.orderBy || "9999")));
}
