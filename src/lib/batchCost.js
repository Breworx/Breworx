// What a batch actually cost, from what was packaged: ingredients used (at
// the prices paid), excise and levy (at the rate on each packaging date),
// cans, lids, cartons and labels (at the stock price around each packaging
// date), plus keg hire and delivery from Costing. All ex GST.
//
// Packaging items are priced, not counted from stock movements: older runs
// were packaged before cans and labels were tracked, so the price per can
// is what can + lid + label + a 24th of a carton cost at the time.

import { CONTAINERS, CANS_PER_CASE, packagingEvents, packagedTotalsByContainer, canonicalBeerName, normItemName } from "./production";
import { exciseRowsForBatches } from "./excise";
import { DEFAULT_COSTING, labelPriceEach } from "./costing";

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// A consumable's price on a date: the latest lot received on or before it,
// else the earliest lot (stock bought just after still shows what it cost).
export function consumablePriceOn(item, date) {
  if (!item) return null;
  const lots = (item.lots || []).filter((l) => Number(l.unitCost) > 0).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  if (lots.length) {
    const before = lots.filter((l) => !date || String(l.date || "") <= String(date));
    return Number((before.length ? before[before.length - 1] : lots[0]).unitCost);
  }
  return num(item.costPerUnit) > 0 ? num(item.costPerUnit) : null;
}

const beerKey = (s) => normItemName(canonicalBeerName(String(s || "")).replace(/\blabels?\b/gi, " "));

// This beer's label in Consumables (category Label, named after the beer).
export function labelFor(batch, consumables) {
  const key = beerKey(batch.name);
  const labels = (consumables || []).filter((c) => c.category === "Label");
  return labels.find((c) => beerKey(c.name) === key) || labels.find((c) => key && (beerKey(c.name).includes(key) || key.includes(beerKey(c.name)))) || null;
}

// The costing this batch belongs to: made from its recipe, else same beer name.
export function costingFor(batch, costing, recipes) {
  const products = (costing && costing.products) || [];
  const recipe = (recipes || []).find((r) => r.id === batch.recipeId);
  const family = recipe ? recipe.familyId || recipe.id : null;
  return (
    products.find((p) => p.recipeFamilyId && family && p.recipeFamilyId === family) ||
    products.find((p) => beerKey(p.name) === beerKey(batch.name)) ||
    null
  );
}

const FORMAT_FOR = { kegs50: "keg50", kegs30: "keg50", kegs20: "keg20", cans330: "case24" };

export function batchFullCost(batch, { consumables, costing, abvMethod, recipes }) {
  const totals = packagedTotalsByContainer(batch);
  const totalL = CONTAINERS.reduce((s, c) => s + (totals[c.key] || 0) * c.volumeL, 0);
  if (totalL <= 0) return null;

  const ingredients = num(batch.ingredientCost) || 0;
  const rows = exciseRowsForBatches([batch], abvMethod || "measured");
  const excise = rows.reduce((s, r) => s + (r.duty || 0), 0);
  const levy = rows.reduce((s, r) => s + (r.levy || 0), 0);
  const liquidPerL = (ingredients + excise + levy) / totalL;

  const data = costing || {};
  const defaults = { ...DEFAULT_COSTING.formats, ...(((data.defaults || {}).formats) || {}) };
  const product = costingFor(batch, data, recipes);
  const fmt = (key) => ({ ...(defaults[key] || {}), ...(((product && product.formats) || {})[key] || {}) });

  // Cans: can + lid + label + 1/24 carton, priced at each run's date.
  const byCat = (cat) => (consumables || []).filter((c) => c.category === cat).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
  const can = byCat("Can"), lid = byCat("Lid"), carton = byCat("Box");
  const label = labelFor(batch, consumables);
  const costingLabel = product && product.casePack ? labelPriceEach(product.casePack.label) : null;
  let canPack = 0, cansCounted = 0;
  const missing = new Set();
  packagingEvents(batch).forEach((e) => {
    const n = Number(e.cans330) || 0;
    if (!n) return;
    const p = (item, name) => { const v = consumablePriceOn(item, e.date); if (v == null) missing.add(name); return v || 0; };
    const labelEach = label ? p(label, "labels") : costingLabel != null ? costingLabel : (missing.add("labels"), 0);
    canPack += n * (p(can, "cans") + p(lid, "lids") + labelEach + p(carton, "cartons") / CANS_PER_CASE);
    cansCounted += n;
  });
  const packPerCan = cansCounted ? canPack / cansCounted : 0;

  const containers = CONTAINERS.filter((c) => (totals[c.key] || 0) > 0).map((c) => {
    const f = fmt(FORMAT_FOR[c.key]);
    const liquid = liquidPerL * c.volumeL;
    if (c.key === "cans330") {
      const caseCost = liquid * CANS_PER_CASE + packPerCan * CANS_PER_CASE + (num(f.delivery) || 0);
      const price = num(f.price);
      return {
        ...c, count: totals[c.key], unitLabel: "case", each: caseCost, liquid: liquid * CANS_PER_CASE, packaging: packPerCan * CANS_PER_CASE, delivery: num(f.delivery) || 0,
        price, margin: price != null ? price - caseCost : null, marginPct: price ? ((price - caseCost) / price) * 100 : null,
        total: (caseCost / CANS_PER_CASE) * totals[c.key], perCan: caseCost / CANS_PER_CASE,
      };
    }
    const hire = num(f.packaging) || 0, delivery = num(f.delivery) || 0;
    const each = liquid + hire + delivery;
    const price = c.key === "kegs30" ? null : num(f.price);
    return {
      ...c, count: totals[c.key], unitLabel: "keg", each, liquid, packaging: hire, delivery,
      price, margin: price != null ? price - each : null, marginPct: price ? ((price - each) / price) * 100 : null,
      total: each * totals[c.key],
    };
  });

  return {
    totalL, ingredients, excise, levy, liquidPerL, canPack, containers, product,
    total: containers.reduce((s, c) => s + c.total, 0),
    missing: [...missing],
    noIngredients: ingredients <= 0,
  };
}
