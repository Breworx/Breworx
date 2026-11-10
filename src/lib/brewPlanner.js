// Brew planner: works out what to brew next and when, from how fast each
// product sells, what's packaged, what's in tank and what's already
// scheduled. Pure functions — the page in TankLog.jsx feeds it plain data.
//
// Demand: litres packaged per product over the chosen period (packaging is
// how this brewery has recorded sales), except months that have Xero sales
// imported, where the Xero figure is used instead.
// Cover: brew when packaged + in-tank + scheduled stock would last less than
// the cover target. The target starts at the base (4 weeks) and is raised
// for products whose monthly sales swing a lot, so it adjusts itself as
// more history comes in. Every figure can be overridden per product.

const DAY = 86400000;
export const addDaysISO = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
};
export const daysBetweenISO = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / DAY);
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const monthOf = (iso) => String(iso || "").slice(0, 7);

// Product key: the recipe family when the batch has a recipe, otherwise the
// batch name with split suffixes (" — A") and sizes ("240L") taken off.
export const cleanProductName = (name) =>
  String(name || "")
    .replace(/\s+—\s+.*$/, "")
    .replace(/\b\d+(\.\d+)?\s*l\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
export const productKeyForBatch = (b, recipeFamilyById) => {
  const fam = b.recipeId && recipeFamilyById[b.recipeId];
  return fam ? `recipe:${fam}` : `name:${cleanProductName(b.name).toLowerCase()}`;
};

// How to package one brew: follows what this beer sold in each container
// over the period, nudged towards whichever container is running low on
// stock (up to twice its usual share when it's empty). Kegs come out as
// whole kegs and cans as whole 24-can cases; leftover litres go to cans if
// the beer is canned, otherwise to the most-used keg size.
export function packagingSplit(pr, litresOut, containers, coverDays, override) {
  const vol = Object.fromEntries(containers.map((c) => [c.key, c.volumeL]));
  const sold = { ...(override || pr.soldByContainer || {}) };
  const keys = Object.keys(sold).filter((k) => vol[k] && sold[k] > 0);
  if (!keys.length || !(litresOut > 0)) return [];
  const total = keys.reduce((t, k) => t + sold[k], 0);
  const weights = {};
  keys.forEach((k) => {
    const rate = sold[k] / total; // share of sales
    const target = rate * (pr.ratePerDay || 0) * coverDays;
    const have = (pr.stockByContainer || {})[k] || 0;
    const shortfall = target > 0 ? Math.max(0, Math.min(1, (target - have) / target)) : 0;
    weights[k] = override ? rate : rate * (1 + shortfall);
  });
  const wTotal = keys.reduce((t, k) => t + weights[k], 0);
  const out = {};
  let left = litresOut;
  const kegKeys = keys.filter((k) => k !== "cans330").sort((a, b) => vol[b] - vol[a]);
  kegKeys.forEach((k) => {
    const n = Math.floor((litresOut * weights[k]) / wTotal / vol[k] + 0.35);
    const fit = Math.min(n, Math.floor(left / vol[k]));
    if (fit > 0) { out[k] = fit; left -= fit * vol[k]; }
  });
  const canned = keys.includes("cans330");
  if (canned && vol.cans330) {
    const cases = Math.floor(left / (vol.cans330 * 24));
    if (cases > 0) { out.cans330 = cases * 24; left -= cases * 24 * vol.cans330; }
  } else if (kegKeys.length) {
    const main = [...kegKeys].sort((a, b) => sold[b] - sold[a])[0];
    const extra = Math.floor(left / vol[main]);
    if (extra > 0) { out[main] = (out[main] || 0) + extra; left -= extra * vol[main]; }
  }
  return containers
    .filter((c) => out[c.key])
    .map((c) => ({ containerKey: c.key, label: c.label, units: out[c.key], litres: Math.round(out[c.key] * c.volumeL * 10) / 10, share: Math.round((weights[c.key] / wTotal) * 100) }));
}

/**
 * @param {object} p
 * @param {Array} p.batches  normalised: { id, key, name, productType, startDate, volume, stage, remainingL, packagedEvents:[{date,litres}], xeroSold:[{date,litres}], plannedDays, tankIds, recipeId, brewDaysPlanned }
 * @param {object} p.stockByKey  litres packaged and still available, by product key
 * @param {object} p.stockByKeyContainer  same, split by container: { [key]: { [containerKey]: litres } }
 * @param {Array} p.containers  [{ key, label, volumeL }] — packagedEvents/xeroSold carry byContainer / containerKey
 * @param {Array} p.tanks  { id, name, type, capacity }
 * @param {object} p.settings  { periodMonths, horizonWeeks, baseCoverWeeks, brewWeekdays:[0-6], brewsPerDay, kitLitres, products: { [key]: { include, coverWeeks, leadDays, batchL, combineInto } } }
 * @param {string} p.todayStr
 */
export function planBrews({ batches, stockByKey, stockByKeyContainer = {}, containers = [], tanks, settings, todayStr }) {
  const s = {
    periodMonths: 3,
    horizonWeeks: 12,
    baseCoverWeeks: 4,
    brewWeekdays: [1, 2, 3, 4, 5],
    brewsPerDay: 2,
    kitLitres: 240,
    products: {},
    ...settings,
  };
  const prodSettings = s.products || {};
  const finalKey = (k) => {
    let cur = k;
    for (let i = 0; i < 5 && prodSettings[cur] && prodSettings[cur].combineInto && prodSettings[cur].combineInto !== cur; i++) cur = prodSettings[cur].combineInto;
    return cur;
  };
  const periodStart = addDaysISO(todayStr, -Math.round(s.periodMonths * 30.44));
  const periodDays = daysBetweenISO(periodStart, todayStr) || 1;
  const xeroMonths = new Set();
  batches.forEach((b) => (b.xeroSold || []).forEach((e) => e.date && xeroMonths.add(monthOf(e.date))));

  // ── Per-product figures ───────────────────────────────────────────────
  const prods = {};
  const P = (key) =>
    prods[key] ||
    (prods[key] = { key, batches: [], soldInPeriod: 0, soldByContainer: {}, monthly: {}, stockL: 0, stockByContainer: {}, incoming: [], mergedFrom: {} });
  batches.forEach((b) => {
    const p = P(finalKey(b.key));
    p.batches.push(b);
    if (finalKey(b.key) !== b.key && !p.mergedFrom[b.key]) p.mergedFrom[b.key] = cleanProductName(b.name) || b.name;
    const demandEvents = [
      ...(b.packagedEvents || []).filter((e) => !xeroMonths.has(monthOf(e.date))),
      ...(b.xeroSold || []).filter((e) => xeroMonths.has(monthOf(e.date))),
    ];
    demandEvents.forEach((e) => {
      if (!e.date || !(e.litres > 0)) return;
      if (e.date >= periodStart && e.date <= todayStr) {
        p.soldInPeriod += e.litres;
        const by = e.byContainer || (e.containerKey ? { [e.containerKey]: e.litres } : {});
        Object.entries(by).forEach(([c, l]) => (p.soldByContainer[c] = (p.soldByContainer[c] || 0) + l));
      }
      if (e.date >= addDaysISO(todayStr, -365) && e.date <= todayStr) p.monthly[monthOf(e.date)] = (p.monthly[monthOf(e.date)] || 0) + e.litres;
    });
  });
  Object.entries(stockByKey || {}).forEach(([k, l]) => {
    if (l > 0) P(finalKey(k)).stockL += l;
  });
  Object.entries(stockByKeyContainer || {}).forEach(([k, by]) => {
    const p = P(finalKey(k));
    Object.entries(by).forEach(([c, l]) => { if (l > 0) p.stockByContainer[c] = (p.stockByContainer[c] || 0) + l; });
  });

  const list = Object.values(prods).map((p) => {
    const sorted = [...p.batches].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    const latest = sorted[0] || null;
    const ps = prodSettings[p.key] || {};
    const packagedOnes = sorted.filter((b) => (b.packagedEvents || []).length && b.startDate);
    // Lead time: brew day to first packaging, typical of the last 6.
    const leads = packagedOnes.slice(0, 6).map((b) => {
      const first = [...b.packagedEvents].map((e) => e.date).filter(Boolean).sort()[0];
      return first ? daysBetweenISO(b.startDate, first) : null;
    }).filter((d) => d != null && d > 0 && d < 365);
    const learnedLead = median(leads);
    // Yield: litres packaged per litre into tank.
    const yields = packagedOnes.slice(0, 6).map((b) => {
      const out = b.packagedEvents.reduce((t, e) => t + (e.litres || 0), 0);
      return b.volume > 0 ? out / b.volume : null;
    }).filter((y) => y != null && y > 0.3 && y <= 1.2);
    const yieldF = Math.min(1, median(yields) ?? 0.9);
    // A brew split across several tanks shows up as several batches started
    // the same day, so size a brew by adding up each brew day's batches.
    const byDay = {};
    sorted.forEach((b) => { if (b.startDate && b.startDate <= todayStr && b.volume > 0) byDay[b.startDate] = (byDay[b.startDate] || 0) + b.volume; });
    const sizes = Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5).map(([, v]) => v);
    const learnedBatch = median(sizes) != null ? Math.round(median(sizes)) : null;
    // Cover: base, plus more for products whose monthly sales swing a lot.
    const months = [];
    for (let i = 1; i <= Math.min(12, Math.max(3, Math.round(s.periodMonths))); i++) months.push(monthOf(addDaysISO(todayStr, -30.44 * i)));
    const firstBrew = sorted.length ? sorted[sorted.length - 1].startDate : todayStr;
    const activeMonths = months.filter((m) => m >= monthOf(firstBrew));
    const series = activeMonths.map((m) => p.monthly[m] || 0);
    let cv = 0;
    if (series.length >= 3) {
      const mean = series.reduce((a, b) => a + b, 0) / series.length;
      const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
      cv = mean > 0 ? sd / mean : 0;
    }
    const learnedCover = Math.round(Math.min(s.baseCoverWeeks * 2, s.baseCoverWeeks * (1 + 0.5 * cv)) * 2) / 2;
    const ratePerDay = p.soldInPeriod / periodDays;
    const leadDays = Math.round(ps.leadDays ?? learnedLead ?? latest?.plannedDays ?? 14);
    // One brew size for every beer when set; a beer's own size still wins.
    const batchL = ps.batchL ?? s.defaultBatchL ?? learnedBatch ?? s.kitLitres;
    const coverWeeks = ps.coverWeeks ?? learnedCover;

    // What's coming: in tank now, and already scheduled.
    p.batches.forEach((b) => {
      if (b.startDate > todayStr) {
        p.incoming.push({ date: addDaysISO(b.startDate, b.plannedDays || leadDays), litres: (b.volume || 0) * yieldF, scheduled: true, batchId: b.id });
      } else if (b.stage !== "Packaged" || b.remainingL > 0) {
        const l = b.stage === "Packaged" ? b.remainingL : (b.remainingL ?? b.volume) * yieldF;
        if (l > 0) {
          const due = addDaysISO(b.startDate, leadDays);
          p.incoming.push({ date: due > todayStr ? due : addDaysISO(todayStr, 1), litres: l, scheduled: false, batchId: b.id });
        }
      }
    });
    const inTankL = p.incoming.filter((i) => !i.scheduled).reduce((t, i) => t + i.litres, 0);
    const scheduledL = p.incoming.filter((i) => i.scheduled).reduce((t, i) => t + i.litres, 0);
    const name = latest ? cleanProductName(latest.name) || latest.name : p.key;
    const recentEnough = latest && latest.startDate >= addDaysISO(todayStr, -Math.max(180, s.periodMonths * 30.44 * 2));
    return {
      key: p.key,
      name,
      latestBatch: latest,
      recipeId: latest?.recipeId || null,
      productType: latest?.productType || "Beer",
      ratePerWeek: ratePerDay * 7,
      ratePerDay,
      soldInPeriod: p.soldInPeriod,
      stockL: p.stockL,
      inTankL,
      scheduledL,
      incoming: p.incoming,
      coverNowWeeks: ratePerDay > 0 ? (p.stockL + inTankL + scheduledL) / ratePerDay / 7 : null,
      leadDays,
      learnedLead,
      batchL,
      learnedBatch,
      yieldF,
      coverWeeks,
      learnedCover,
      cv,
      include: ps.include ?? (ratePerDay > 0 && !!recentEnough),
      mergedFrom: p.mergedFrom,
      soldByContainer: p.soldByContainer,
      stockByContainer: p.stockByContainer,
    };
  });

  // ── When each product needs a brew ───────────────────────────────────
  const horizonEnd = addDaysISO(todayStr, s.horizonWeeks * 7);
  const needs = [];
  list.filter((pr) => pr.include && pr.ratePerDay > 0).forEach((pr) => {
    const planned = [];
    const target = pr.ratePerDay * pr.coverWeeks * 7;
    const base = pr.stockL + pr.incoming.reduce((t, i) => t + i.litres, 0);
    for (let d = 0, guard = 0; d <= s.horizonWeeks * 7 && guard < 40; guard++) {
      const position = base + planned.reduce((t, x) => t + x.litres, 0) - pr.ratePerDay * d;
      if (position >= target) {
        // Jump ahead to the day the position drops below target.
        const nextD = Math.ceil((base + planned.reduce((t, x) => t + x.litres, 0) - target) / pr.ratePerDay);
        if (nextD <= d) d += 1; else d = nextD;
        continue;
      }
      const date = addDaysISO(todayStr, d);
      if (date > horizonEnd) break;
      const litres = pr.batchL * pr.yieldF;
      planned.push({ date, litres });
      needs.push({ product: pr, needDate: date, volume: pr.batchL });
    }
  });

  // ── Fit each brew into a brew day and a free fermenter ────────────────
  const fermenters = tanks.filter((t) => t.type === "Fermenter" || t.type === "Brite Tank" || t.type === "Unitank").filter((t) => Number(t.capacity) > 0);
  const busy = {}; // tankId -> [[start, end]]
  const occupy = (id, a, b) => (busy[id] || (busy[id] = [])).push([a, b]);
  batches.forEach((b) => {
    if (!b.tankIds || !b.tankIds.length) return;
    const done = b.stage === "Packaged" && !(b.remainingL > 0);
    if (done) return;
    const days = b.plannedDays || list.find((x) => x.key === finalKey(b.key))?.leadDays || 14;
    let end = addDaysISO(b.startDate, days);
    if (b.startDate <= todayStr && end <= todayStr) end = addDaysISO(todayStr, 2);
    b.tankIds.forEach((id) => occupy(id, b.startDate, end));
  });
  const isFree = (id, a, b) => !(busy[id] || []).some(([x, y]) => a <= y && b >= x);
  const brewLoad = {};
  batches.forEach((b) => {
    if (b.startDate > todayStr) brewLoad[b.startDate] = (brewLoad[b.startDate] || 0) + (b.brewDaysPlanned || 1);
  });
  const weekday = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
  const firstDay = addDaysISO(todayStr, 1);

  const suggestions = [];
  needs.sort((a, b) => a.needDate.localeCompare(b.needDate) || b.product.ratePerDay - a.product.ratePerDay);
  needs.forEach((n) => {
    const pr = n.product;
    const totalCap = fermenters.reduce((m, t) => m + Number(t.capacity), 0);
    let volume = Math.min(n.volume, totalCap || n.volume);
    const brewDays = Math.max(1, Math.ceil(volume / (s.kitLitres || 240) - 0.05));
    let start = n.needDate < firstDay ? firstDay : n.needDate;
    let chosen = null;
    for (let i = 0; i < 60 && !chosen; i++) {
      const day = addDaysISO(start, i);
      if (!s.brewWeekdays.includes(weekday(day))) continue;
      if ((brewLoad[day] || 0) + brewDays > s.brewsPerDay && brewDays <= s.brewsPerDay) continue;
      const end = addDaysISO(day, pr.leadDays);
      const free = fermenters.filter((t) => isFree(t.id, day, end));
      // Smallest single tank that holds it; otherwise split across the
      // fewest free tanks (largest first), the way a 240L brew goes into 2×120L.
      const single = free.filter((t) => Number(t.capacity) >= volume * 0.98).sort((a, b) => Number(a.capacity) - Number(b.capacity))[0];
      if (single) chosen = { day, end, tanks: [{ tank: single, volume }] };
      else {
        const pick = [];
        let left = volume;
        for (const t of [...free].sort((a, b) => Number(b.capacity) - Number(a.capacity))) {
          if (left <= volume * 0.02) break;
          const v = Math.min(Number(t.capacity), left);
          pick.push({ tank: t, volume: v });
          left -= v;
        }
        if (pick.length > 1 && left <= volume * 0.02) {
          // Even the litres out across the chosen tanks.
          const each = pick.map((x) => ({ ...x }));
          chosen = { day, end, tanks: each };
        }
      }
    }
    const ready = chosen ? addDaysISO(chosen.day, pr.leadDays) : null;
    // Does packaged stock run out before this brew is ready?
    let runOut = null;
    if (ready) {
      const mine = suggestions.filter((x) => x.key === pr.key && x.readyDate);
      const earlier = mine.map((x) => ({ date: x.readyDate, litres: x.volume * pr.yieldF }));
      const windowStart = mine.length ? mine[mine.length - 1].readyDate : todayStr;
      const arrivals = [...pr.incoming, ...earlier].sort((a, b) => a.date.localeCompare(b.date));
      let onHand = pr.stockL;
      let last = todayStr;
      for (const a of [...arrivals.filter((x) => x.date <= ready), { date: ready, litres: 0 }]) {
        const used = pr.ratePerDay * daysBetweenISO(last, a.date);
        if (onHand - used < 0 && !runOut) {
          const d = addDaysISO(last, Math.max(0, Math.floor(onHand / pr.ratePerDay)));
          if (d >= windowStart) runOut = d;
        }
        onHand = Math.max(0, onHand - used) + a.litres;
        last = a.date;
      }
    }
    if (chosen) {
      chosen.tanks.forEach((x) => occupy(x.tank.id, chosen.day, chosen.end));
      brewLoad[chosen.day] = (brewLoad[chosen.day] || 0) + brewDays;
    }
    suggestions.push({
      id: `${pr.key}::${n.needDate}`,
      split: packagingSplit(pr, volume * pr.yieldF, containers, pr.coverWeeks * 7, s.packOverrides && s.packOverrides[pr.key]),
      key: pr.key,
      name: pr.name,
      productType: pr.productType,
      recipeId: pr.recipeId,
      needDate: n.needDate,
      startDate: chosen ? chosen.day : null,
      readyDate: ready,
      delayDays: chosen ? Math.max(0, daysBetweenISO(n.needDate < firstDay ? firstDay : n.needDate, chosen.day)) : null,
      tanks: chosen ? chosen.tanks.map((x) => ({ tankId: x.tank.id, tankName: x.tank.name, volume: Math.round(x.volume) })) : [],
      tankName: chosen ? chosen.tanks.map((x) => x.tank.name).join(" + ") : null,
      volume: Math.round(volume),
      brewDays,
      leadDays: pr.leadDays,
      runOut,
      noTank: !chosen,
    });
  });
  suggestions.sort((a, b) => String(a.startDate || "9999").localeCompare(String(b.startDate || "9999")));
  return { products: list.sort((a, b) => b.ratePerDay - a.ratePerDay), suggestions, periodStart, xeroMonths: [...xeroMonths].sort() };
}
