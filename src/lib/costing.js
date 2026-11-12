// Recipe costing: what a brew will cost before it's made, and the margin on
// each keg and case at your sale prices. Pure functions, no React.
//
// Ingredient prices come from stock: the latest received lot with a cost,
// which already includes its share of the order's freight. When stock has
// no usable price (none, $0, or one that's way off the costing-sheet
// price), the price from the imported costing sheet is used instead and the
// line is flagged. A price set by hand on the costing page beats both.

import { unitFactor, sameItemName, normItemName } from "./production";
import { exciseBandForAbv, exciseRateOn, levyRateOn } from "./excise";
import { calcABV } from "./brewing";

export const COSTING_FORMATS = [
  { key: "keg50", label: "50L keg", packagingLabel: "Keg hire" },
  { key: "keg20", label: "20L keg", packagingLabel: "Keg hire" },
  { key: "case24", label: "24 × 330ml case", packagingLabel: "Cans, labels & box", rrp: true },
];
export const DEFAULT_COSTING = {
  rrpMarkupPct: 35,
  formats: {
    keg50: { litres: 50, packaging: 30, delivery: 20 },
    keg20: { litres: 20, packaging: 30, delivery: 12 },
    case24: { litres: 7.92, packaging: 20.18, delivery: 5.5 },
  },
};

const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const tokens = (s) =>
  new Set(
    String(s || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, "")
      .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|%)\b/g, "")
      .replace(/amyglucoside/g, "amyloglucosidase")
      .replace(/kviek/g, "kveik")
      .match(/[a-z]+/g)
      ?.filter((w) => !["malt", "malted", "gladfield", "clayton", "amplifire", "yeast", "bag", "of", "the"].includes(w))
      .map((w) => w.replace(/s$/, "")) || [],
  );
const similarity = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((t) => B.has(t) && n++);
  return n / new Set([...A, ...B]).size;
};

// The costing sheet's price for an ingredient: an entry already matched to
// this stock name, else the closest name (at least half the words shared).
export function sheetPriceFor(name, sheetPrices) {
  const list = sheetPrices || [];
  const exact = list.find((p) => (p.stockName && sameItemName(p.stockName, name)) || sameItemName(p.name, name));
  if (exact) return exact;
  let best = null, score = 0;
  list.forEach((p) => {
    const s = similarity(p.name, name);
    if (s > score) { score = s; best = p; }
  });
  return score >= 0.5 ? best : null;
}

// Latest received lot with a cost above $0 (per the stock item's unit), and
// whether there are $0 lots.
export function stockPriceFor(item) {
  if (!item) return { price: null, date: null, hasZero: false };
  const lots = (item.lots || []).filter((l) => l.unitCost != null && l.unitCost !== "");
  const sorted = [...lots].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const good = sorted.find((l) => Number(l.unitCost) > 0);
  return { price: good ? Number(good.unitCost) : null, date: good ? good.date : null, hasZero: sorted.some((l) => Number(l.unitCost) <= 0) };
}

// Price of one recipe line, per the line's own unit.
export function priceIngredient(line, { inventory, sheetPrices, manualPrices }) {
  const unit = line.unit;
  const item = (inventory || []).find((it) => sameItemName(it.name, line.name)) || null;
  const manual = (manualPrices || {})[normItemName(line.name)];
  const sheet = sheetPriceFor(line.name, sheetPrices);
  const per = (price, fromUnit) => {
    if (price == null) return null;
    if (fromUnit === unit) return price;
    const f = unitFactor(unit, fromUnit); // how many fromUnits in one line unit
    return f == null ? null : price * f;
  };
  const stock = stockPriceFor(item);
  const stockPer = per(stock.price, item?.unit);
  const sheetPer = sheet ? per(sheet.price, sheet.unit) : null;
  const manualPer = manual ? per(manual.price, manual.unit) : null;

  let price = null, source = "none", flag = null;
  if (manualPer != null) { price = manualPer; source = "manual"; }
  else if (stockPer != null) {
    price = stockPer; source = "stock";
    if (sheetPer != null && sheetPer > 0 && (stockPer / sheetPer > 3 || sheetPer / stockPer > 3)) {
      flag = "odd"; price = sheetPer; source = "sheet";
    }
  } else if (sheetPer != null) { price = sheetPer; source = "sheet"; flag = stock.hasZero ? "zero" : "missing"; }
  else flag = stock.hasZero ? "zero" : "missing";

  const qty = num(line.qty) || 0;
  return {
    id: line.id, name: line.name, category: line.category, qty, unit,
    price, source, flag, cost: price != null ? price * qty : 0,
    item, stockPrice: stock.price, stockUnit: item?.unit || null, stockDate: stock.date,
    sheetPrice: sheet ? sheet.price : null, sheetUnit: sheet ? sheet.unit : null, sheetName: sheet ? sheet.name : null,
  };
}

// Excise + Pae Ora levy (ex GST) per litre of product at this strength, today.
export function dutyPerLitre(abv, dateStr, productType = "Beer") {
  if (!abv || abv <= 0) return { excise: 0, levy: 0, rate: 0, basis: null };
  const band = exciseBandForAbv(abv, productType);
  const rate = exciseRateOn(band, dateStr);
  const excise = band.basis === "alcohol" ? rate * (abv / 100) : band.basis === "beverage" ? rate : 0;
  return { excise, levy: levyRateOn(abv, dateStr) || 0, rate, basis: band.basis };
}

// Strength used for duty: the label strength set for this beer, else the
// recipe's OG/FG estimate.
export function costingAbv(recipe, labelStrengths) {
  const label = num((labelStrengths || {})[`recipe:${recipe.familyId || recipe.id}`]);
  if (label != null && label > 0) return { abv: label, source: "label" };
  const est = recipe.og && recipe.fg ? calcABV(recipe.og, recipe.fg) : null;
  return est && est > 0 ? { abv: Math.round(est * 10) / 10, source: "recipe" } : { abv: null, source: "none" };
}

// A costing is a product you're pricing: { id, name, productType, yieldL,
// abv, ingredients: [{ id, name, qty, unit, category }], formats: { key:
// { price, packaging, delivery, litres } }, recipeFamilyId? }. It can be a
// brand-new idea that has never been brewed, a product from the costing
// sheet, or a copy of a recipe. Company defaults fill any packaging or
// delivery cost the costing doesn't set itself.
export function costProduct(product, { inventory, costing, todayStr }) {
  const data = costing || {};
  const defaults = { ...DEFAULT_COSTING, ...(data.defaults || {}), formats: { ...DEFAULT_COSTING.formats, ...((data.defaults || {}).formats || {}) } };
  const lines = (product.ingredients || []).map((l) => priceIngredient(l, { inventory, sheetPrices: data.sheetPrices, manualPrices: data.prices }));
  const ingredients = lines.reduce((s, l) => s + l.cost, 0);
  const yieldL = num(product.yieldL) || 0;
  const abv = num(product.abv);
  const duty = dutyPerLitre(abv, todayStr, product.productType || "Beer");
  const ingredientsPerL = yieldL > 0 ? ingredients / yieldL : 0;
  const markup = num(product.rrpMarkupPct) ?? num(defaults.rrpMarkupPct) ?? 35;
  const formats = COSTING_FORMATS.map((f) => {
    const d = defaults.formats[f.key] || {};
    const s = (product.formats || {})[f.key] || {};
    const litres = num(s.litres) ?? num(d.litres) ?? 0;
    const packaging = num(s.packaging) ?? num(d.packaging) ?? 0;
    const delivery = num(s.delivery) ?? num(d.delivery) ?? 0;
    const liquid = ingredientsPerL * litres;
    const excise = (duty.excise + duty.levy) * litres;
    const cost = liquid + excise + packaging + delivery;
    const price = num(s.price);
    const margin = price != null ? price - cost : null;
    return {
      ...f, litres, packaging, delivery, liquid, excise, cost, price, margin,
      marginPct: price ? (margin / price) * 100 : null,
      rrp: f.rrp && price != null ? (price * (1 + markup / 100)) / 4 : null,
      defaults: { litres: num(d.litres), packaging: num(d.packaging), delivery: num(d.delivery) },
    };
  });
  return { lines, ingredients, yieldL, abv, ingredientsPerL, duty, formats, markup, flagged: lines.filter((l) => l.flag) };
}

// A new costing that starts as a copy of a recipe.
export function costingFromRecipe(recipe, labelStrengths, newId) {
  const strength = costingAbv(recipe, labelStrengths);
  return {
    id: newId(),
    name: recipe.name,
    productType: recipe.productType || "Beer",
    recipeFamilyId: recipe.familyId || recipe.id,
    yieldL: num(recipe.volume) || null,
    abv: strength.abv,
    ingredients: (recipe.ingredients || []).map((l) => ({ id: newId(), name: l.name, qty: num(l.qty) || 0, unit: l.unit, category: l.category })),
    formats: {},
    source: "recipe",
  };
}

// Price you'd need for a target margin %, given the cost.
export const priceForMargin = (cost, pct) => (pct >= 100 ? null : cost / (1 - pct / 100));
