import { sameItemName, uid } from "./production";

// Xero OAuth — Client ID is safe to expose in the browser (it's public by
// design in OAuth2), the Client Secret never leaves the Edge Function.
export const XERO_CLIENT_ID = "83E79CF2CB94484C97FD75D0E103C070";
export const XERO_REDIRECT_URI = "https://breworx.vercel.app/xero-callback";
export const XERO_SCOPES = "offline_access accounting.invoices accounting.contacts accounting.settings accounting.reports.profitandloss.read accounting.reports.balancesheet.read";

export function buildXeroAuthUrl(companyId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state: companyId,
  });
  return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
}

export const CATEGORIES = ["Grain", "Hops", "Yeast", "Juice", "Other"];

export const CATEGORY_COLOR = {
  Grain: "#5C9A3C",
  Hops: "#D9A441",
  Yeast: "#B8925A",
  Juice: "#C77D2E",
  Other: "#9BA88A",
  Can: "#5C9A3C",
  Bottle: "#D9A441",
  Lid: "#B8925A",
  Label: "#D4A24C",
  Box: "#8A6A3D",
  Carton: "#9BA88A",
};

export const CONSUMABLE_CATEGORIES = ["Can", "Bottle", "Lid", "Label", "Box", "Carton", "Other"];

export const STEP_FOR_UNIT = { kg: 0.5, g: 50, L: 1, ea: 1 };

export function seedInventory() {
  const d0 = new Date();
  const mk = (offset) => {
    const d = new Date(d0);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  return [
    {
      id: uid(),
      name: "Maris Otter",
      category: "Grain",
      qty: 42,
      unit: "kg",
      threshold: 20,
      lots: [{ id: uid(), lotNumber: "MO-2291", qty: 42, date: mk(14), poNumber: "PO-101" }],
    },
    {
      id: uid(),
      name: "Cascade",
      category: "Hops",
      qty: 0.8,
      unit: "kg",
      threshold: 1,
      lots: [{ id: uid(), lotNumber: "CAS-0087", qty: 0.8, date: mk(30), poNumber: "PO-098" }],
    },
    {
      id: uid(),
      name: "Citra",
      category: "Hops",
      qty: 1.6,
      unit: "kg",
      threshold: 1,
      lots: [{ id: uid(), lotNumber: "CIT-1142", qty: 1.6, date: mk(14), poNumber: "PO-101" }],
    },
    {
      id: uid(),
      name: "US-05 Ale Yeast",
      category: "Yeast",
      qty: 6,
      unit: "ea",
      threshold: 4,
      lots: [{ id: uid(), lotNumber: "US05-6631", qty: 6, date: mk(14), poNumber: "PO-101" }],
    },
    {
      id: uid(),
      name: "Crystal 60L",
      category: "Grain",
      qty: 9,
      unit: "kg",
      threshold: 10,
      lots: [{ id: uid(), lotNumber: "C60-0459", qty: 9, date: mk(30), poNumber: "PO-098" }],
    },
    {
      id: uid(),
      name: "Irish Moss",
      category: "Other",
      qty: 250,
      unit: "g",
      threshold: 100,
      lots: [{ id: uid(), lotNumber: "IM-0021", qty: 250, date: mk(30), poNumber: "PO-098" }],
    },
  ];
}

export function seedPurchaseOrders() {
  const d0 = new Date();
  const mk = (offset) => {
    const d = new Date(d0);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  return [
    {
      id: uid(),
      poNumber: "PO-101",
      supplier: "Riverbend Malt & Hop Co.",
      orderDate: mk(16),
      receivedDate: mk(14),
      status: "Received",
      lines: [
        { id: uid(), name: "Maris Otter", category: "Grain", qty: 42, unit: "kg", lotNumber: "MO-2291" },
        { id: uid(), name: "Citra", category: "Hops", qty: 1.6, unit: "kg", lotNumber: "CIT-1142" },
        { id: uid(), name: "US-05 Ale Yeast", category: "Yeast", qty: 6, unit: "ea", lotNumber: "US05-6631" },
      ],
    },
    {
      id: uid(),
      poNumber: "PO-102",
      supplier: "Cold Coast Hop Supply",
      orderDate: mk(2),
      receivedDate: null,
      status: "Ordered",
      lines: [
        { id: uid(), name: "Cascade", category: "Hops", qty: 2, unit: "kg", lotNumber: "" },
        { id: uid(), name: "Simcoe", category: "Hops", qty: 1, unit: "kg", lotNumber: "" },
      ],
    },
  ];
}

export function seedRecipes() {
  return [
    {
      id: uid(),
      name: "Foghorn Amber",
      style: "American Amber Ale",
      volume: 20,
      og: 1.058,
      fg: 1.012,
      ingredients: [
        { id: uid(), name: "Maris Otter", category: "Grain", qty: 4.5, unit: "kg" },
        { id: uid(), name: "Crystal 60L", category: "Grain", qty: 0.5, unit: "kg" },
        { id: uid(), name: "Cascade", category: "Hops", qty: 0.05, unit: "kg" },
        { id: uid(), name: "US-05 Ale Yeast", category: "Yeast", qty: 1, unit: "ea" },
        { id: uid(), name: "Irish Moss", category: "Other", qty: 5, unit: "g" },
      ],
    },
    {
      id: uid(),
      name: "Low Tide Saison",
      style: "Farmhouse Saison",
      volume: 18,
      og: 1.052,
      fg: 1.004,
      ingredients: [
        { id: uid(), name: "Maris Otter", category: "Grain", qty: 4, unit: "kg" },
        { id: uid(), name: "Citra", category: "Hops", qty: 0.03, unit: "kg" },
        { id: uid(), name: "US-05 Ale Yeast", category: "Yeast", qty: 1, unit: "ea" },
      ],
    },
  ];
}

// Case-insensitive, de-duplicated — a recipe calling for "Cascade" twice
// only needs to be offered once, and matching ignores capitalization so
// "citra" doesn't get treated as different from "Citra" already on hand.
// Standard edit-distance — counts the fewest single-character changes
// (insert/delete/swap) to turn one string into the other. Used to catch
// close spelling variants ("Pilsner" vs "Pilsener") that word-overlap
// matching alone would miss.
export function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = row[j];
      row[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = temp;
    }
  }
  return row[n];
}

// A generic term that appears in dozens of unrelated ingredient names
// isn't useful for spotting a near-duplicate — "Malt" alone shouldn't
// flag every grain in the shelf as "similar" to "Pilsner Malt".
export const INGREDIENT_STOPWORDS = new Set(["malt", "malted", "hops", "hop", "yeast", "extract", "grain", "the", "and", "of"]);

export function areNamesSimilar(a, b) {
  const nameA = a.trim().toLowerCase();
  const nameB = b.trim().toLowerCase();
  if (!nameA || !nameB || nameA === nameB) return false;

  // Close overall spelling, e.g. "Pilsner Malt" vs "Pilsener Malt"
  const maxLen = Math.max(nameA.length, nameB.length);
  if (levenshteinDistance(nameA, nameB) <= Math.max(2, Math.round(maxLen * 0.2))) return true;

  // Shared meaningful word, e.g. "Pilsner" in "German Pilsner Malt"
  const wordsA = nameA.split(/\s+/).filter((w) => w.length > 2 && !INGREDIENT_STOPWORDS.has(w));
  const wordsB = nameB.split(/\s+/).filter((w) => w.length > 2 && !INGREDIENT_STOPWORDS.has(w));
  return wordsA.some((wa) => wordsB.some((wb) => wa === wb || (Math.min(wa.length, wb.length) >= 4 && levenshteinDistance(wa, wb) <= 1)));
}

export function findMissingIngredients(ingredientLines, inventory) {
  const seen = new Set();
  const missing = [];
  (ingredientLines || []).forEach((l) => {
    const name = (l.name || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const exists = inventory.some((it) => sameItemName(it.name, name));
    if (!exists) missing.push({ name, category: l.category, unit: l.unit });
  });
  return missing;
}

// A batch scheduled ahead of time (via the lightweight "Schedule a brew"
// flow) has genuinely no readings yet, until brewing actually starts —
// this must never return undefined, or anything that does latest.gravity
// crashes outright rather than just showing an empty/neutral state.
export function latestReading(batch, tankId) {
  if (tankId && batch.splitTanks && batch.splitTanks.length > 0) {
    const side = batch.splitTanks.find((t) => t.tankId === tankId);
    if (side && side.readings && side.readings.length > 0) return side.readings[side.readings.length - 1];
    // A split side with no readings of its own yet still starts from
    // wherever the shared, pre-split history left off — not from
    // scratch — since both sides came from the same wort right up
    // until the split happened.
    if (batch.readings && batch.readings.length > 0) return batch.readings[batch.readings.length - 1];
    return { gravity: batch.og ?? null, temp: null, date: batch.startDate };
  }
  if (batch.readings && batch.readings.length > 0) return batch.readings[batch.readings.length - 1];
  return { gravity: batch.og ?? null, temp: null, date: batch.startDate };
}
