import { canonicalBeerName } from "./production";

// ─── Product suggestions per venue ─────────────────────────────────────────
// Worked out fresh from every order each time (Xero invoices, Upstock drafts,
// Brewpoint orders), so it keeps learning as orders come in — no training.
//
// For each customer, a beer scores points for:
//  • "Venues like you" — other customers who order a similar range
//    (Jaccard overlap of the beers they buy) and also take this beer.
//  • "Lapsed" — they used to order it regularly and have gone quiet for
//    well past their usual gap.
//  • Season — beers that sell more than usual at this time of year.
//  • New beers — something in the tanks or on the calendar that's never been
//    sold is matched by style to venues that buy that kind of beer.
// Only beers that are in stock, brewing or coming up are suggested.

const DAY = 86400000;
const beerKeyOf = (line) => {
  const k = String(line.productKey || "").split("::")[0];
  return (k || canonicalBeerName(line.batchName || "")).trim().toLowerCase();
};
const containerOf = (line) => line.containerKey || String(line.productKey || "").split("::")[1] || "";
const isKeg = (ck) => /keg/i.test(ck);

// Broad style families, so a brand-new beer can be matched to venues that
// buy that kind of thing.
export function styleFamily(text) {
  const t = String(text || "").toLowerCase();
  if (/cider|perry/.test(t)) return "cider";
  if (/lemonade|iced tea|seltzer|rtd|soda/.test(t)) return "rtd";
  if (/sour|gose|berliner|lambic|wild|fruit/.test(t)) return "sour";
  if (/stout|porter|dark|black|schwarz|mild/.test(t)) return "dark";
  if (/hazy|neipa|juicy/.test(t)) return "hazy";
  if (/ipa|pale ale|apa|hop/.test(t)) return "hoppy";
  if (/lager|pils|helles|kolsch|kölsch|light|draught|draft/.test(t)) return "lager";
  if (/red|amber|brown|bitter|esb/.test(t)) return "malty";
  if (/wheat|weiss|weizen|wit|hefe/.test(t)) return "wheat";
  return null;
}
const FAMILY_LABEL = { cider: "cider", rtd: "RTDs", sour: "sours", dark: "dark beers", hazy: "hazies", hoppy: "hoppy pale ales & IPAs", lager: "lagers", malty: "reds & ambers", wheat: "wheat beers" };

export function computeSuggestions({ salesOrders = [], availableStock = [], batches = [], today = new Date() }) {
  const now = today instanceof Date ? today : new Date(today);
  const month = now.getMonth();
  const orders = salesOrders.filter((o) => o.customerId && o.status !== "Cancelled" && o.orderDate);

  const names = new Map(); // beerKey -> display name
  const perCust = new Map(); // customerId -> Map(beerKey -> {dates:Set, qty, last, kegQty, canQty})
  const monthly = new Map(); // beerKey -> number[12]
  for (const o of orders) {
    const d = new Date(`${o.orderDate}T12:00:00`);
    for (const l of o.lines || []) {
      const key = beerKeyOf(l);
      if (!key) continue;
      if (!names.has(key)) names.set(key, canonicalBeerName(l.batchName || key) || key);
      const qty = Number(l.qty) || 0;
      if (!perCust.has(o.customerId)) perCust.set(o.customerId, new Map());
      const m = perCust.get(o.customerId);
      if (!m.has(key)) m.set(key, { dates: new Set(), qty: 0, last: null, kegQty: 0, canQty: 0 });
      const e = m.get(key);
      e.dates.add(o.orderDate);
      e.qty += qty;
      if (!e.last || o.orderDate > e.last) e.last = o.orderDate;
      if (isKeg(containerOf(l))) e.kegQty += qty; else e.canQty += qty;
      if (!monthly.has(key)) monthly.set(key, new Array(12).fill(0));
      monthly.get(key)[d.getMonth()] += 1;
    }
  }

  // What can actually be supplied: in stock now, or brewing.
  const inStock = new Set(availableStock.filter((r) => Number(r.available) > 0).map((r) => canonicalBeerName(r.batchName || "").trim().toLowerCase()));
  const brewing = new Set(
    batches
      .filter((b) => !b.mergedIntoBatchId && b.stage !== "Packaged" && (!b.startDate || new Date(`${b.startDate}T12:00:00`) - now < 45 * DAY))
      .map((b) => canonicalBeerName(b.name || "").trim().toLowerCase()),
  );
  const supply = (key) => (inStock.has(key) ? "stock" : brewing.has(key) ? "brewing" : null);

  // Each beer's style family, from its batches (newest wins) or its name.
  const famOf = new Map();
  [...batches].sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || ""))).forEach((b) => {
    const k = canonicalBeerName(b.name || "").trim().toLowerCase();
    const f = styleFamily(b.style) || styleFamily(b.name);
    if (k && f) famOf.set(k, f);
  });
  const family = (k) => famOf.get(k) || styleFamily(names.get(k) || k);
  // Brand-new beers: in the tanks or on the calendar (next 60 days) but never sold yet.
  const newBeers = new Map();
  for (const b of batches) {
    if (b.mergedIntoBatchId) continue;
    const k = canonicalBeerName(b.name || "").trim().toLowerCase();
    if (!k || names.has(k) && [...perCust.values()].some((m) => m.has(k))) continue;
    const upcoming = b.stage !== "Packaged" && (!b.startDate || new Date(`${b.startDate}T12:00:00`) - now < 60 * DAY);
    const stocked = inStock.has(k);
    if (!upcoming && !stocked) continue;
    const f = styleFamily(b.style) || styleFamily(b.name);
    if (!f) continue;
    if (!newBeers.has(k)) newBeers.set(k, { key: k, name: canonicalBeerName(b.name) || b.name, family: f, startDate: b.startDate, stocked });
  }

  // Seasonal lift: share of this beer's orders in this month ±1 vs an even spread.
  const seasonOf = (key) => {
    const m = monthly.get(key);
    if (!m) return 1;
    const total = m.reduce((a, b) => a + b, 0);
    if (total < 8) return 1;
    const win = m[(month + 11) % 12] + m[month] + m[(month + 1) % 12];
    return Math.max(0.7, Math.min(1.6, win / total / (3 / 12)));
  };

  const custIds = [...perCust.keys()];
  const sets = new Map(custIds.map((c) => [c, new Set(perCust.get(c).keys())]));
  const byCustomer = new Map();

  for (const c of custIds) {
    const mine = sets.get(c);
    const cand = new Map();
    const add = (key, pts, reason, kind) => {
      if (!cand.has(key)) cand.set(key, { beerKey: key, beerName: names.get(key) || key, score: 0, reasons: [], kinds: new Set(), similar: 0 });
      const s = cand.get(key);
      s.score += pts;
      if (reason && !s.reasons.includes(reason)) s.reasons.push(reason);
      s.kinds.add(kind);
    };

    // Venues like this one: the closest few by overlap of what they buy.
    const neighbours = [];
    for (const d of custIds) {
      if (d === c) continue;
      const theirs = sets.get(d);
      let inter = 0;
      for (const k of mine) if (theirs.has(k)) inter++;
      if (!inter) continue;
      const sim = inter / (mine.size + theirs.size - inter);
      if (sim >= 0.15) neighbours.push([d, sim]);
    }
    neighbours.sort((a, b) => b[1] - a[1]);
    for (const [d, sim] of neighbours.slice(0, 8)) {
      for (const k of sets.get(d)) {
        if (mine.has(k)) continue;
        add(k, sim, null, "similar");
        cand.get(k).similar += 1;
      }
    }
    for (const s of cand.values()) if (s.similar) s.reasons.push(`Taken by ${s.similar} similar venue${s.similar === 1 ? "" : "s"}`);

    // Lapsed regulars
    for (const [k, e] of perCust.get(c)) {
      const dates = [...e.dates].sort();
      if (dates.length < 2) continue;
      const first = new Date(`${dates[0]}T12:00:00`), last = new Date(`${e.last}T12:00:00`);
      const avgGap = Math.max(7, (last - first) / DAY / (dates.length - 1));
      const since = (now - last) / DAY;
      if (since > Math.max(35, avgGap * 1.8) && since <= 365) {
        add(k, 1 + Math.min(since / avgGap, 4) * 0.3, `Used to order about every ${Math.round(avgGap / 7)} wk${Math.round(avgGap / 7) === 1 ? "" : "s"} — none for ${Math.round(since / 7)} wks`, "lapsed");
      }
    }

    // Brand-new beers that match what this venue already buys
    if (newBeers.size) {
      const famQty = {};
      let tot = 0;
      for (const [k, e] of perCust.get(c)) { const f = family(k); if (f) { famQty[f] = (famQty[f] || 0) + e.dates.size; } tot += e.dates.size; }
      for (const nb of newBeers.values()) {
        const share = tot ? (famQty[nb.family] || 0) / tot : 0;
        if (share <= 0) continue;
        if (!names.has(nb.key)) names.set(nb.key, nb.name);
        add(nb.key, 0.6 + share * 1.5, `New beer — they buy ${FAMILY_LABEL[nb.family] || nb.family}`, "new");
        cand.get(nb.key).beerName = nb.name;
        cand.get(nb.key).isNew = true;
      }
    }

    // Season + supply + format
    const kegs = [...perCust.get(c).values()].reduce((a, e) => a + e.kegQty, 0);
    const cans = [...perCust.get(c).values()].reduce((a, e) => a + e.canQty, 0);
    const format = kegs >= cans ? "kegs" : "cans";
    const list = [];
    for (const s of cand.values()) {
      const sup = supply(s.beerKey) || (s.isNew ? "brewing" : null);
      if (!sup) continue;
      const lift = seasonOf(s.beerKey);
      s.score *= lift;
      if (lift >= 1.2) s.reasons.push("Sells more this time of year");
      s.reasons.push(sup === "stock" ? `In stock — pitch ${format}` : s.isNew ? `Coming up — pre-sell it (${format})` : "Brewing now — pre-sell it");
      s.supply = sup;
      s.format = format;
      s.kinds = [...s.kinds];
      list.push(s);
    }
    list.sort((a, b) => b.score - a.score);
    if (list.length) byCustomer.set(c, list.slice(0, 5));
  }

  const beers = [...new Set([...byCustomer.values()].flat().map((s) => s.beerKey))].map((k) => ({ key: k, name: names.get(k) || k })).sort((a, b) => a.name.localeCompare(b.name));
  return { byCustomer, beers, newBeers: [...newBeers.values()] };
}
