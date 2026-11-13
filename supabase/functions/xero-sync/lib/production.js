import { daysBetween, today } from "./utils.js";

// The path a batch follows depends on whether the brewery has any Brite Beer
// Tanks configured — if so, beer moves through one before packaging.
export function getStages(hasBriteTanks) {
  return hasBriteTanks
    ? ["Brewing", "Primary", "Cooling", "Brite Tank", "Packaged"]
    : ["Brewing", "Primary", "Cooling", "Packaged"];
}

export const STAGE_COLOR = {
  Brewing: "#E08A3C",
  Primary: "#4FB83D",
  Cooling: "#4AA8C9",
  "Brite Tank": "#F0B429",
  Aging: "#8E6FB5",
  // Kept for any batches created before this stage restructure.
  Secondary: "#4AA8C9",
  Conditioning: "#F0B429",
  Packaged: "#9BA88A",
};

// The specific sub-stage within a brew day — shared between the batch
// detail page and the batches list, so a batch mashing or in the kettle
// shows the same detail wherever it appears, not just a generic
// "Brewing" pill on one screen and the real stage on another.
export const BREW_STAGE_INFO = {
  Mashing: { label: "Mashing in", color: "#D9A441" },
  Recirculating: { label: "Recirculating", color: "#D9A441" },
  Kettle: { label: "In the kettle", color: "#E08A3C" },
};

// A tank's CIP cycle once it's empty — null/unset is treated as "Needs CIP"
// by default, since assuming a tank is dirty until proven otherwise is the
// safer default for a food-safety-adjacent status. Brite tanks branch after
// "Rinsed" — acid and caustic are alternatives, not both required — so
// stages are advanced via a map rather than a fixed sequence.
export const CLEAN_STAGE_COLOR = {
  "Needs CIP": "#B5502F",
  Rinsed: "#D9A441",
  "Acid clean": "#8E6FB5",
  "Caustic clean": "#4AA8C9",
  Sanitised: "#5C9A3C",
};
export const NEXT_CLEAN_STAGE = {
  "Needs CIP": "Rinsed",
  Rinsed: "Caustic clean",
  "Caustic clean": "Sanitised",
  "Acid clean": "Sanitised",
  Sanitised: "Needs CIP",
};

export const CONTAINERS = [
  { key: "cans330", label: "330ml Can", shortLabel: "Can", volumeL: 0.33 },
  { key: "kegs20", label: "20L Keg", shortLabel: "20L Keg", volumeL: 20 },
  { key: "kegs30", label: "30L Keg", shortLabel: "30L Keg", volumeL: 30 },
  { key: "kegs50", label: "50L Keg", shortLabel: "50L Keg", volumeL: 50 },
];

// The key a specific product (a beer in a specific container) is
// identified by for Xero item mapping — shared globally so the mapping
// modal (outside the main app component) computes the exact same key a
// real packaged batch will use when it's actually sold.
export const CANS_PER_CASE = 24;
// Batch names grouped into one beer (Settings → Xero → Same beer), so
// "Basecamp 240L" and "Base Camp Hazy" are one product for Xero matching,
// stock and tracing. Split-tank letters (" — A") are ignored too.
export let BEER_ALIASES = {}; // lower-case batch name -> beer name
// Imports are read-only elsewhere, so the app replaces the map through this.
export function setBeerAliasMap(map) { BEER_ALIASES = map || {}; }
export const splitFreeName = (name) => String(name || "").replace(/\s+—\s+[A-Z0-9]{1,3}$/, "").trim();
export const canonicalBeerName = (name) => {
  const base = splitFreeName(name);
  return BEER_ALIASES[base.toLowerCase()] || base;
};
export const productKeyFor = (name, containerKey) => `${canonicalBeerName(name).trim().toLowerCase()}::${containerKey}`;

// The actual point of a triangle test — a raw "8/12 correct" tells a
// brewer nothing on its own, since even random guessing gets roughly a
// third right by chance. This computes the real, one-tailed binomial
// significance (exact, not approximated) at the standard 5% threshold,
// matching how the method is actually used in sensory science — see
// ISO 4120 / ASTM E1885.
export function binomialCoeff(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}
export function triangleTestSignificance(correct, total) {
  if (total === 0) return { pValue: 1, significant: false };
  const p = 1 / 3;
  let pValue = 0;
  for (let i = correct; i <= total; i++) {
    pValue += binomialCoeff(total, i) * Math.pow(p, i) * Math.pow(1 - p, total - i);
  }
  return { pValue, significant: pValue <= 0.05 };
}

export const packagedVolume = (packaging) =>
  !packaging ? 0 : CONTAINERS.reduce((sum, c) => sum + (packaging[c.key] || 0) * c.volumeL, 0);

// Packaging is stored as { events: [{id,date,cans330,kegs20,...}], discarded: number }.
// Batches packaged before this feature existed have the old shape (container
// counts directly on the packaging object) — read those as a single legacy event.
export function packagingEvents(batch) {
  if (!batch.packaging) return [];
  if (Array.isArray(batch.packaging.events)) return batch.packaging.events;
  const hasLegacyCounts = CONTAINERS.some((c) => batch.packaging[c.key] != null);
  if (hasLegacyCounts) {
    const legacy = { id: "legacy", date: batch.startDate };
    CONTAINERS.forEach((c) => (legacy[c.key] = batch.packaging[c.key] || 0));
    return [legacy];
  }
  return [];
}

export const packagingDiscarded = (batch) => (batch.packaging && batch.packaging.discarded) || 0;

// Sums every packaging event on a batch into one {cans330: N, kegs20: N, ...}
// total — how much of each container size this batch has ever produced.
export function packagedTotalsByContainer(batch) {
  const totals = {};
  CONTAINERS.forEach((c) => (totals[c.key] = 0));
  packagingEvents(batch).forEach((e) => {
    CONTAINERS.forEach((c) => {
      totals[c.key] += e[c.key] || 0;
    });
  });
  return totals;
}

// Same cost-per-container math already shown on a batch's own packaging
// section — spreads the batch's total ingredient cost across every litre
// actually packaged, then prices a specific container by its volume
// share. Pulled out here so sales analytics can use the identical, real
// cost basis rather than a separate approximation.
export function batchCostPerContainer(batch, containerKey) {
  if (!batch.ingredientCost || batch.ingredientCost <= 0) return null;
  const totals = packagedTotalsByContainer(batch);
  const totalVolumePackaged = CONTAINERS.reduce((sum, c) => sum + (totals[c.key] || 0) * c.volumeL, 0);
  if (totalVolumePackaged <= 0) return null;
  const costPerLitre = batch.ingredientCost / totalVolumePackaged;
  const container = CONTAINERS.find((c) => c.key === containerKey);
  if (!container) return null;
  return costPerLitre * container.volumeL;
}

// Sums how much of a batch's stock is already spoken for by sales orders —
// Draft and Cancelled orders don't reserve anything, everything else does.
export function soldTotalsByContainer(batchId, salesOrders) {
  const totals = {};
  CONTAINERS.forEach((c) => (totals[c.key] = 0));
  (salesOrders || []).forEach((so) => {
    if (so.status === "Draft" || so.status === "Cancelled") return;
    // Orders brought in from Xero invoices: the Xero sync already took that stock.
    if (so.source === "xero") return;
    (so.lines || []).forEach((line) => {
      if (line.batchId === batchId && totals[line.containerKey] != null) {
        totals[line.containerKey] += Number(line.qty) || 0;
      }
    });
  });
  return totals;
}

// Every batch+container combination that's ever had stock packaged into it,
// with how much is actually still available to sell right now. This is
// what a sales order line picker is built from.
// How much of a specific batch+container has already gone into an
// assembled mixed pack — same idea as soldTotalsByContainer, just a
// different way stock leaves the "available to sell on its own" pool.
export function mixedPackConsumptionByContainer(batchId, mixedPackAssemblies) {
  const totals = {};
  (mixedPackAssemblies || []).forEach((a) => {
    (a.composition || []).forEach((line) => {
      if (line.batchId !== batchId) return;
      totals[line.containerKey] = (totals[line.containerKey] || 0) + line.qtyPerPack * a.quantity;
    });
  });
  return totals;
}

// Open Xero drafts (Upstock orders) hold stock: each line takes from the
// oldest packed batches of that beer, oldest order first, and whatever's
// short is a back order. Worked out fresh every time from what's on hand,
// so packaging new beer fills back orders by itself and a cancelled draft
// gives its stock straight back.
export const isOpenXeroDraft = (o) => o && o.source === "xero" && o.status === "Confirmed";

export function allocateDraftOrders(list, batches, salesOrders) {
  const drafts = (salesOrders || []).filter(isOpenXeroDraft).sort((a, b) => String(a.orderDate || "").localeCompare(String(b.orderDate || "")) || String(a.orderNumber || "").localeCompare(String(b.orderNumber || "")));
  const allocations = {}; // orderId -> { [lineId]: { reserved: [{ batchId, batchName, batchNumber, qty }], backOrder } }
  const backOrders = []; // { order, line, qty, productKey }
  if (!drafts.length) return { allocations, backOrders };
  const packedOn = {};
  batches.forEach((b) => (packedOn[b.id] = packagingEvents(b).reduce((m, e) => (e.date && (!m || e.date < m) ? e.date : m), "") || b.startDate || ""));
  drafts.forEach((o) => {
    allocations[o.id] = {};
    (o.lines || []).forEach((l) => {
      const productKey = l.productKey || productKeyFor(l.batchName || "", l.containerKey);
      let need = Math.max(0, Math.round(Number(l.qty) || 0));
      const reserved = [];
      list
        .filter((r) => r.containerKey === l.containerKey && r.available > 0 && productKeyFor(r.batchName, r.containerKey) === productKey)
        .sort((a, b) => String(packedOn[a.batchId]).localeCompare(String(packedOn[b.batchId])))
        .forEach((r) => {
          if (need <= 0) return;
          const take = Math.min(need, r.available);
          r.available -= take;
          r.reserved = (r.reserved || 0) + take;
          need -= take;
          reserved.push({ batchId: r.batchId, batchName: r.batchName, batchNumber: r.batchNumber, qty: take });
        });
      allocations[o.id][l.id] = { reserved, backOrder: need };
      if (need > 0) backOrders.push({ order: o, line: l, qty: need, productKey });
    });
  });
  return { allocations, backOrders };
}

export function draftOrderAllocations(batches, salesOrders, mixedPackAssemblies) {
  const list = availableStockList(batches, (salesOrders || []).filter((o) => !isOpenXeroDraft(o)), mixedPackAssemblies);
  return allocateDraftOrders(list, batches, salesOrders);
}

export function availableStockList(batches, salesOrders, mixedPackAssemblies) {
  const list = [];
  batches.forEach((b) => {
    if (!b.packaging) return;
    const packaged = packagedTotalsByContainer(b);
    const sold = soldTotalsByContainer(b.id, salesOrders);
    const consumedByMixedPacks = mixedPackConsumptionByContainer(b.id, mixedPackAssemblies);
    // Stock written off with "Clear stock" — kept off the packaging itself
    // so the excise records behind it never change.
    const cleared = {};
    // Repacked beer (a declared keg moved into cans or other kegs) is an
    // entry here too: the units it came out of count as cleared, the units
    // it went into count as packaged stock on the same batch. Excise only
    // ever looks at the packaging events, so it never changes.
    const repackedIn = {};
    (b.stockCleared || []).forEach((e) =>
      Object.entries(e.counts || {}).forEach(([k, v]) => {
        if (e.kind === "repack" && v < 0) repackedIn[k] = (repackedIn[k] || 0) - v;
        else cleared[k] = (cleared[k] || 0) + v;
      })
    );
    // Sold on invoices raised straight in Xero (see planXeroSales).
    (b.xeroSold || []).forEach((e) => (cleared[e.containerKey] = (cleared[e.containerKey] || 0) + (Number(e.qty) || 0)));
    CONTAINERS.forEach((c) => {
      const total = (packaged[c.key] || 0) + (repackedIn[c.key] || 0);
      if (total > 0) {
        list.push({
          batchId: b.id,
          batchName: b.name,
          batchNumber: b.number,
          containerKey: c.key,
          containerLabel: c.label,
          packaged: total,
          repackedIn: repackedIn[c.key] || 0,
          available: total - (sold[c.key] || 0) - (consumedByMixedPacks[c.key] || 0) - (cleared[c.key] || 0),
        });
      }
    });
  });
  allocateDraftOrders(list, batches, salesOrders);
  return list;
}

// ─── Two-way stock with Xero: sales invoiced in Xero take stock off ─────────
// Works out what a batch of Xero invoices/credit notes means for Brewpoint's
// stock, without touching anything — the caller saves the result. Every
// Xero line is recorded once (by its line id) so nothing is counted twice,
// and a voided invoice gives its stock back.
//
//  - Invoices for Brewpoint's own orders (reference = a Brewpoint order
//    number) are skipped — those orders already took the stock off.
//  - Each Xero item is matched to a beer + container, with how many
//    Brewpoint units one Xero unit holds (a case of 24 = 24 cans).
//  - Stock comes off the oldest batch first; a credit note puts it back on
//    the newest batch of that beer.
export function planXeroSales({ docs, ledger, salesMap, itemMappings, batches, available, brewpointOrderNumbers }) {
  const ledgerByLine = {};
  (ledger || []).forEach((r) => (ledgerByLine[r.xero_line_id] = r));
  const orderNos = new Set((brewpointOrderNumbers || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
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

  const packedOn = {};
  batches.forEach((b) => (packedOn[b.id] = packagingEvents(b).reduce((mx, e) => (e.date && e.date > mx ? e.date : mx), "")));
  const avail = {};
  (available || []).forEach((s) => (avail[`${s.batchId}::${s.containerKey}`] = s.available));
  const batchesFor = (productKey, containerKey) =>
    batches.filter((b) => productKeyFor(b.name, containerKey) === productKey && packagingEvents(b).length > 0);

  const soldChanges = {}; // batchId -> new xeroSold array
  const soldOf = (b) => soldChanges[b.id] || (soldChanges[b.id] = [...(b.xeroSold || [])]);
  const batchById = Object.fromEntries(batches.map((b) => [b.id, b]));
  const rows = [];
  const unmatched = {};
  const summary = { applied: 0, units: 0, returned: 0, reversed: 0, short: 0, skipped: 0, unmapped: 0 };

  const sorted = [...(docs || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  sorted.forEach((doc) => {
    const active = doc.status === "AUTHORISED" || doc.status === "PAID";
    const ownOrder = doc.docType === "invoice" && doc.reference && orderNos.has(String(doc.reference).trim().toLowerCase());
    doc.lines.forEach((line) => {
      const prev = ledgerByLine[line.lineId];
      const base = {
        xero_line_id: line.lineId,
        xero_doc_id: doc.docId,
        doc_type: doc.docType,
        doc_number: doc.number,
        doc_date: doc.date,
        contact_name: doc.contactName,
        item_code: line.itemCode,
        xero_qty: line.qty,
      };

      if (!active) {
        // Voided or deleted in Xero: give back whatever it took.
        if (prev && (prev.status === "applied" || prev.status === "short")) {
          (prev.allocations || []).forEach((a) => {
            const b = batchById[a.batchId];
            if (!b) return;
            soldChanges[b.id] = soldOf(b).filter((x) => x.lineId !== line.lineId);
            avail[`${a.batchId}::${a.containerKey}`] = (avail[`${a.batchId}::${a.containerKey}`] || 0) + a.qty;
          });
          rows.push({ ...prev, ...base, status: "reversed", allocations: [] });
          summary.reversed += 1;
        }
        return;
      }
      if (prev && prev.status !== "unmapped") return; // already dealt with

      if (ownOrder) {
        rows.push({ ...base, units: 0, status: "skipped", allocations: [] });
        summary.skipped += 1;
        return;
      }
      const map = resolve(line.itemCode);
      if (!map || map.ignore) {
        if (map && map.ignore) {
          rows.push({ ...base, units: 0, status: "skipped", allocations: [] });
          summary.skipped += 1;
        } else {
          rows.push({ ...base, units: 0, status: "unmapped", allocations: [] });
          unmatched[line.itemCode] = (unmatched[line.itemCode] || 0) + 1;
          summary.unmapped += 1;
        }
        return;
      }

      const units = Math.round(line.qty * map.units * 1000) / 1000;
      const candidates = batchesFor(map.productKey, map.containerKey);
      const allocations = [];
      if (doc.docType === "invoice") {
        let need = units;
        [...candidates]
          .sort((a, b) => packedOn[a.id].localeCompare(packedOn[b.id]))
          .forEach((b) => {
            if (need <= 0) return;
            const key = `${b.id}::${map.containerKey}`;
            const take = Math.min(need, Math.max(0, avail[key] || 0));
            if (take <= 0) return;
            avail[key] = (avail[key] || 0) - take;
            need -= take;
            allocations.push({ batchId: b.id, containerKey: map.containerKey, qty: take });
          });
        allocations.forEach((a) => soldOf(batchById[a.batchId]).push({ lineId: line.lineId, docNumber: doc.number, date: doc.date, containerKey: a.containerKey, qty: a.qty, customer: doc.contactName || "" }));
        const status = need > 0.0005 ? "short" : "applied";
        if (status === "short") summary.short += 1;
        summary.applied += 1;
        summary.units += units - Math.max(0, need);
        rows.push({ ...base, units, status, allocations });
      } else {
        // Customer credit note: the stock comes back on the newest batch.
        const newest = [...candidates].sort((a, b) => packedOn[b.id].localeCompare(packedOn[a.id]))[0];
        if (newest) {
          soldOf(newest).push({ lineId: line.lineId, docNumber: doc.number, date: doc.date, containerKey: map.containerKey, qty: -units, customer: doc.contactName || "" });
          avail[`${newest.id}::${map.containerKey}`] = (avail[`${newest.id}::${map.containerKey}`] || 0) + units;
          allocations.push({ batchId: newest.id, containerKey: map.containerKey, qty: -units });
          summary.returned += units;
        }
        rows.push({ ...base, units, status: newest ? "applied" : "short", allocations });
        if (!newest) summary.short += 1;
      }
    });
  });

  const batchChanges = Object.entries(soldChanges)
    .filter(([id, list]) => JSON.stringify(list) !== JSON.stringify(batchById[id].xeroSold || []))
    .map(([id, xeroSold]) => ({ id, xeroSold }));
  return { rows, batchChanges, unmatched, summary };
}

// A first guess at which beer and container a Xero item is, from its code
// and name — "BC50" / "Base Camp Hazy IPA 50L keg" → Base Camp Hazy, 50L
// keg; anything mentioning 24, case or 330ml → cans, 24 to a unit.
export function guessXeroItemMatch(item, beerNames) {
  const text = `${item.code} ${item.name}`.toLowerCase();
  let containerKey = "";
  let units = 1;
  if (/\b50\s*l|50l|50$|\b50\b/.test(text)) containerKey = "kegs50";
  else if (/\b30\s*l|30l|\b30\b/.test(text)) containerKey = "kegs30";
  else if (/\b20\s*l|20l|\b20\b/.test(text)) containerKey = "kegs20";
  if (/1x24|24\s*x|\bcase\b|\b24\b|24$|330/.test(text)) {
    containerKey = "cans330";
    units = /4\s*pack|4pk/.test(text) ? 4 : /6\s*pack|6pk/.test(text) ? 6 : /\bsingle\b|1x330/.test(text) ? 1 : 24;
  }
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["beer", "keg", "kegs", "case", "cans", "can", "the", "and", "ipa", "330ml", "50l", "20l", "30l"].includes(w));
  const itemWords = new Set(words(item.name));
  let best = "";
  let bestScore = 0;
  (beerNames || []).forEach((n) => {
    const score = words(n).filter((w) => itemWords.has(w)).length;
    if (score > bestScore) { best = n; bestScore = score; }
  });
  return { beerName: best, containerKey, units };
}

// A mixed pack's own available-to-sell count — how many have been put
// together minus how many have already sold. Kept separate from the
// per-beer list above since it's a different kind of "product" entirely.
export function mixedPackStockList(mixedPackTypes, mixedPackAssemblies, salesOrders) {
  return (mixedPackTypes || []).map((t) => {
    const assembled = (mixedPackAssemblies || [])
      .filter((a) => a.mixedPackTypeId === t.id)
      .reduce((sum, a) => sum + a.quantity, 0);
    const sold = (salesOrders || [])
      .filter((o) => o.status !== "Draft" && o.status !== "Cancelled")
      .reduce((sum, o) => sum + (o.lines || []).filter((l) => l.mixedPackTypeId === t.id).reduce((s, l) => s + (l.qty || 0), 0), 0);
    return { ...t, assembled, available: assembled - sold };
  });
}

// Sales-driven production forecast — different from ingredientsNeededForScheduled
// above, which only forecasts raw material needs for brews already
// scheduled. This looks the other way: at current sales velocity, is a
// recipe going to run out of packaged stock before a fresh batch could
// realistically be brewed and ready? Only flags recipes that are
// actually selling (avoids nonsense suggestions for anything dormant),
// and never flags one that already has a batch in the pipeline.
export function recipeDemandForecast(recipes, batches, salesOrders, windowDays = 60, leadTimeDays = 21) {
  const stockList = availableStockList(batches, salesOrders, []);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return activeRecipesByFamily(recipes)
    .map((recipe) => {
      const recipeBatchIds = new Set(batches.filter((b) => b.recipeId === recipe.id).map((b) => b.id));
      if (recipeBatchIds.size === 0) return null;

      const currentStock = stockList
        .filter((s) => recipeBatchIds.has(s.batchId))
        .reduce((sum, s) => sum + Math.max(0, s.available), 0);

      let unitsSoldRecently = 0;
      (salesOrders || []).forEach((o) => {
        if (o.status === "Draft" || o.status === "Cancelled") return;
        if (!o.orderDate || o.orderDate < cutoffStr) return;
        (o.lines || []).forEach((l) => {
          if (recipeBatchIds.has(l.batchId)) unitsSoldRecently += l.fulfilledQty || 0;
        });
      });
      const dailyVelocity = unitsSoldRecently / windowDays;
      if (dailyVelocity <= 0) return null;

      const hasUpcomingBatch = batches.some((b) => b.recipeId === recipe.id && b.stage !== "Packaged");
      const daysOfStockRemaining = currentStock / dailyVelocity;
      const needsAttention = daysOfStockRemaining < leadTimeDays && !hasUpcomingBatch;

      return { recipe, currentStock, dailyVelocity, daysOfStockRemaining, hasUpcomingBatch, needsAttention };
    })
    .filter(Boolean)
    .sort((a, b) => a.daysOfStockRemaining - b.daysOfStockRemaining);
}

// Deterministic per-user color for the reminders calendar — same person
// always gets the same color, without needing to store one anywhere.
export const USER_COLORS = ["#5C9A3C", "#D9A441", "#4AA8C9", "#B5502F", "#8E6FB5", "#5C6B54"];
export function userColor(name) {
  if (!name) return "#9BA88A";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length];
}

export const totalPackagedVolume = (batch) =>
  packagingEvents(batch).reduce((sum, e) => sum + packagedVolume(e), 0);

export const remainingVolume = (batch) => {
  const rem = batch.volume - totalPackagedVolume(batch) - packagingDiscarded(batch);
  return Math.max(0, Math.round(rem * 100) / 100);
};

// What's actually still in stock is worth its real, weighted cost across
// whatever lots remain — not just current qty times the most recent price,
// which would misstate value whenever older stock was bought at a
// different price than what's most recently arrived. Falls back to the
// flat costPerUnit for items with no lot-level history (consumables, or
// anything added before lot tracking existed).
export function inventoryItemValue(item) {
  if (item.lots && item.lots.length > 0) {
    return item.lots.reduce((sum, lot) => sum + (lot.remainingQty || 0) * (lot.unitCost || 0), 0);
  }
  return (item.qty || 0) * (item.costPerUnit || 0);
}

// A tank is occupied if some batch is sitting on it and hasn't been fully
// packaged out yet. excludeBatchId lets a batch ignore its own current
// assignment when checking whether it can stay put.
// A batch can sit on a single tank (tankId) or be split across several
// (splitTanks) — this returns every tank id it currently occupies either way.
// Natural sort: "Tank 2" before "Tank 10", numeric chunks compared as
// numbers rather than character-by-character; falls back to plain
// alphabetical for tanks with non-numbered names.
export function compareTankNames(a, b) {
  const chunks = /(\d+)|(\D+)/g;
  const ax = (a || "").match(chunks) || [];
  const bx = (b || "").match(chunks) || [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const av = ax[i] ?? "";
    const bv = bx[i] ?? "";
    const bothNumeric = /^\d+$/.test(av) && /^\d+$/.test(bv);
    const cmp = bothNumeric ? Number(av) - Number(bv) : av.localeCompare(bv);
    if (cmp !== 0) return cmp;
  }
  return 0;
}
export const sortedTanks = (tanks) => [...tanks].sort((a, b) => compareTankNames(a.name, b.name));

export const COMMON_FAULTS = [
  "Diacetyl",
  "DMS",
  "Acetaldehyde",
  "Oxidation",
  "Infection/Sour",
  "Phenolic (band-aid)",
  "Astringency",
  "Hop creep",
  "Sulfur",
  "Yeast bite",
];
export const FAULT_SEVERITY_COLOR = { Low: "#D9A441", Medium: "#E08A3C", High: "#B5502F" };
export const FAULT_SEVERITY_NEXT = { none: "Low", Low: "Medium", Medium: "High", High: null };

// batch.faults is a log of dated entries (multiple per fault name allowed,
// one per day it was reassessed) so a fault noticed one day and gone the
// next doesn't erase the earlier observation. This collapses it down to
// just the latest entry per fault — i.e. "what's the current read."
export function currentFaults(batch) {
  const byName = {};
  (batch.faults || []).forEach((f) => {
    if (!byName[f.fault] || f.date > byName[f.fault].date) byName[f.fault] = f;
  });
  return Object.values(byName);
}

// Same logic as currentFaults above, but for a plain faults array rather
// than a whole batch — used for one split-tank side's own faults list,
// where there's no batch-shaped object to pass in.
export function currentFaultsList(faultsList) {
  const byName = {};
  (faultsList || []).forEach((f) => {
    if (!byName[f.fault] || f.date > byName[f.fault].date) byName[f.fault] = f;
  });
  return Object.values(byName);
}

export function batchTankIds(batch) {
  // A brew day merged into another batch no longer has a tank of its own —
  // its wort went into the batch it was merged into.
  if (batch.mergedIntoBatchId) return [];
  if (batch.splitTanks && batch.splitTanks.length > 0) return batch.splitTanks.map((t) => t.tankId);
  if (batch.tankId) return [batch.tankId];
  return [];
}

// Real lead time and spend from actual received orders — not a manually
// typed guess. Matches by supplier name, the same way every other PO
// lookup in the app already does, since a PO stores the supplier as
// plain text rather than a reference id.
export function supplierPerformance(supplierName, purchaseOrders) {
  const received = (purchaseOrders || []).filter((po) => po.supplier === supplierName && po.status === "Received" && po.receivedDate);
  if (received.length === 0) return null;

  const leadTimes = received.map((po) => daysBetween(po.orderDate, po.receivedDate)).filter((d) => d >= 0);
  const avgLeadTimeDays = leadTimes.length > 0 ? Math.round((leadTimes.reduce((sum, d) => sum + d, 0) / leadTimes.length) * 10) / 10 : null;
  const totalSpend = received.reduce((sum, po) => {
    const lineTotal = (po.lines || []).reduce((s, l) => s + (Number(l.costPerUnit) || 0) * (Number(l.qty) || 0), 0);
    return sum + lineTotal + (po.deliveryCost || 0);
  }, 0);
  const lastOrderDate = received.reduce((latest, po) => (!latest || po.orderDate > latest ? po.orderDate : latest), null);

  return { poCount: received.length, avgLeadTimeDays, totalSpend, lastOrderDate };
}

export function batchTankSummary(batch) {
  if (batch.splitTanks && batch.splitTanks.length > 0) {
    return batch.splitTanks.map((t) => `${t.tankName} (${t.volume}L)`).join(" + ");
  }
  return batch.tankName || "";
}

// Shows sub-1kg amounts in grams instead — 0.05kg is much easier to read as 50g.
export function formatQty(qty, unit) {
  const n = Number(qty);
  if (unit === "kg" && n > 0 && n < 1) {
    return `${Math.round(n * 1000)}g`;
  }
  const display = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  return `${display} ${unit}`;
}

// Groups recipes by family and picks the one to actually use for each —
// whichever version is explicitly pinned as active, or the latest if none is.
export function activeRecipesByFamily(recipes) {
  const groups = {};
  recipes.forEach((r) => {
    const fam = r.familyId || r.id;
    if (!groups[fam]) groups[fam] = [];
    groups[fam].push(r);
  });
  return Object.values(groups).map((versions) => {
    const pinned = versions.find((v) => v.isActive);
    if (pinned) return pinned;
    return versions.reduce((a, b) => ((b.version || 1) > (a.version || 1) ? b : a));
  });
}

export function tankIsOccupied(batches, tankId, excludeBatchId) {
  return batches.some((b) => {
    if (!batchTankIds(b).includes(tankId)) return false;
    if (excludeBatchId && b.id === excludeBatchId) return false;
    const fullyDone = b.stage === "Packaged" && remainingVolume(b) === 0;
    return !fullyDone;
  });
}

export function occupyingBatch(batches, tankId, excludeBatchId) {
  const candidates = batches.filter((b) => {
    if (!batchTankIds(b).includes(tankId)) return false;
    if (excludeBatchId && b.id === excludeBatchId) return false;
    const fullyDone = b.stage === "Packaged" && remainingVolume(b) === 0;
    return !fullyDone;
  });
  if (candidates.length === 0) return undefined;
  // A tank can genuinely have both something actively in it AND a future
  // brew already queued up for after it's out — scheduling deliberately
  // allows that. Whatever's physically in the tank right now should
  // always win here; only fall back to a scheduled one if nothing has
  // actually started yet. Without this, batch order (not reality) would
  // decide which one showed.
  return candidates.find((b) => b.startDate <= today()) || candidates[0];
}

export function aggregatePackagingCounts(batch) {
  const totals = {};
  CONTAINERS.forEach((c) => (totals[c.key] = 0));
  packagingEvents(batch).forEach((e) => CONTAINERS.forEach((c) => (totals[c.key] += e[c.key] || 0)));
  return totals;
}

export const BP_TANK_PATH = "M11 5 Q9 5 9 7 V21.5 L18.3 33.2 Q19 34 19.7 33.2 L29 21.5 V7 Q29 5 27 5 Z";

export const SCHEDULE_USE_PRIORITY = { Mash: 0, Boil: 1, Aroma: 2, "Dry Hop": 3 };
export function compareScheduleItems(a, b) {
  const pa = SCHEDULE_USE_PRIORITY[a.use] ?? 4;
  const pb = SCHEDULE_USE_PRIORITY[b.use] ?? 4;
  if (pa !== pb) return pa - pb;
  if (a.use === "Dry Hop") return (a.time ?? 0) - (b.time ?? 0);
  return (b.time ?? 0) - (a.time ?? 0);
}

export const uid = () => Math.random().toString(36).slice(2, 9);
// Inventory items are matched by name. Ignore case, stray spaces and
// doubled-up spaces, so "Citra " and "citra" don't become two items.
export const normItemName = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();
export const sameItemName = (a, b) => normItemName(a) === normItemName(b);
// How to turn a quantity in one unit into another (only within weight or volume).
export const UNIT_TO_BASE = { kg: ["mass", 1000], g: ["mass", 1], L: ["vol", 1000], mL: ["vol", 1], ml: ["vol", 1] };
// A receive-time choice to put a PO line into an existing inventory item
// (picked because the names don't quite match): the line takes that item's
// name and unit, with qty and cost converted to match.
export function applyLineMatch(line, matches) {
  const m = matches && matches[line.id];
  if (!m) return line;
  const f = unitFactor(line.unit, m.unit) ?? 1;
  const conv = (n) => (n == null || n === "" ? n : Math.round(Number(n) * f * 1000) / 1000);
  return { ...line, name: m.name, unit: m.unit, category: m.category || line.category, qty: conv(line.qty), costPerUnit: line.costPerUnit != null ? Number(line.costPerUnit) / f : line.costPerUnit, _f: f };
}
export function unitFactor(from, to) {
  if (from === to) return 1;
  const a = UNIT_TO_BASE[from];
  const b = UNIT_TO_BASE[to];
  if (!a || !b || a[0] !== b[0]) return null;
  return a[1] / b[1];
}

// A planned brew stays "scheduled" (movable on the calendar) on its own day
// until something is actually done to it: ingredients taken, a reading, a
// brew day logged, an OG or packaging. Before, it counted as started the
// moment its date arrived, so it couldn't be dragged on the day.
export function isScheduledBatch(b) {
  if (!b || b.stage !== "Brewing") return false;
  const t = today();
  if (b.startDate > t) return true;
  if (b.startDate !== t) return false;
  const touched =
    (b.ingredients || []).length > 0 || Number(b.ingredientCost) > 0 || (b.readings || []).length > 0 ||
    (b.brewDays || []).length > 0 || !!b.og || packagingEvents(b).length > 0;
  return !touched;
}
