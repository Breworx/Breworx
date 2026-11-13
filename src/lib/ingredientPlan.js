// ─── Ingredients for the next month ─────────────────────────────────────────
// Every brew in the window, in date order: what's on the calendar plus what
// the brew planner suggests. Each one's recipe is scaled to its volume,
// converted to the stock item's unit and taken from what's on hand in date
// order, so the list says what runs short, by which brew, and when to order
// given each supplier's real delivery time.
import { isScheduledBatch, sameItemName, supplierPerformance, unitFactor } from "./production";
import { addDays, today } from "./utils";

const round = (n) => Math.round(n * 1000) / 1000;

export function ingredientPlan({ batches, recipes, inventory, suggestions = [], suppliers = [], purchaseOrders = [], recipeForSuggestion, days = 30 }) {
  const start = today();
  const end = addDays(start, days);
  const brews = [];
  (batches || [])
    .filter((b) => !b.mergedIntoBatchId && isScheduledBatch(b) && b.startDate >= start && b.startDate <= end)
    .forEach((b) => brews.push({ kind: "scheduled", id: b.id, name: b.name, number: b.number, date: b.startDate, volume: Number(b.volume) || 0, recipe: b.recipeId ? recipes.find((r) => r.id === b.recipeId) : null, own: b.ingredients || [] }));
  suggestions
    .filter((s) => s.startDate && s.startDate <= end)
    .forEach((s) => brews.push({ kind: "suggested", id: s.id, name: s.name, date: s.startDate, volume: Number(s.volume) || 0, recipe: recipeForSuggestion ? recipeForSuggestion(s, recipes) : null, own: [] }));
  brews.sort((a, b) => a.date.localeCompare(b.date));

  const items = {}; // key -> row
  const perBrew = {}; // brew id -> [{ name, short, unit }]
  const noRecipe = [];
  brews.forEach((br) => {
    const src = br.recipe && (br.recipe.ingredients || []).length ? br.recipe.ingredients : br.own;
    if (!src.length) { noRecipe.push(br); return; }
    const scale = br.recipe && Number(br.recipe.volume) > 0 && br.volume > 0 ? br.volume / Number(br.recipe.volume) : 1;
    src.forEach((ing) => {
      const name = String(ing.name || "").trim();
      if (!name) return;
      const stock = (inventory || []).find((it) => sameItemName(it.name, name));
      const unit = stock ? stock.unit : ing.unit;
      const f = stock ? unitFactor(ing.unit, stock.unit) : 1;
      const qty = (Number(ing.qty) || 0) * scale * (f == null ? 1 : f);
      if (!(qty > 0)) return;
      const key = stock ? `id:${stock.id}` : `name:${name.toLowerCase()}`;
      if (!items[key]) {
        const supplier = stock?.supplierId ? suppliers.find((s) => s.id === stock.supplierId) : null;
        const perf = supplier ? supplierPerformance(supplier.name, purchaseOrders) : null;
        items[key] = { key, name: stock ? stock.name : name, unit, category: stock?.category || ing.category || "", onHand: stock ? Math.max(0, Number(stock.qty) || 0) : 0, inStock: !!stock, needed: 0, left: stock ? Math.max(0, Number(stock.qty) || 0) : 0, shortBy: null, supplier: supplier?.name || "", leadDays: perf?.avgLeadTimeDays != null ? Math.ceil(perf.avgLeadTimeDays) : null, unitMismatch: stock && f == null, brews: [] };
      }
      const row = items[key];
      row.needed += qty;
      const before = row.left;
      row.left -= qty;
      row.brews.push({ name: br.name, date: br.date, kind: br.kind, qty: round(qty) });
      if (row.left < 0 && before >= 0 && !row.shortBy) row.shortBy = br.date;
      if (row.left < 0) (perBrew[br.id] = perBrew[br.id] || []).push({ name: row.name, short: round(Math.min(qty, -row.left)), unit });
    });
  });
  const list = Object.values(items).map((r) => {
    const shortfall = round(Math.max(0, r.needed - r.onHand));
    const orderBy = r.shortBy ? addDays(r.shortBy, -(r.leadDays ?? 7)) : null;
    return { ...r, needed: round(r.needed), shortfall, orderBy, late: orderBy ? orderBy < start : false };
  });
  list.sort((a, b) => (b.shortfall > 0) - (a.shortfall > 0) || String(a.orderBy || "9999").localeCompare(String(b.orderBy || "9999")) || a.name.localeCompare(b.name));
  return { brews, items: list, toOrder: list.filter((r) => r.shortfall > 0), perBrew, noRecipe, start, end };
}
