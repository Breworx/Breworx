// Production tasks — keg cleaning, kegging, canning and anything else on the
// brewery's to-do list. Real tasks live in the reminders table (with a kind);
// on top of those Brewpoint suggests the next ones itself from what's in the
// tanks, and learns as it goes:
//  • when each beer is usually ready (learnedTankDays — brew day to packaging),
//  • how each beer is usually packaged (its past keg/can split),
//  • how many days before packaging the kegs usually get cleaned.
// A suggestion becomes a real task the moment someone moves it, ticks it or
// dismisses it (saved with the suggestion's source_key), so it can always be
// shifted around and never comes back once dealt with.
import { CONTAINERS, canonicalBeerName, isScheduledBatch, learnedTankDays, packagingEvents, remainingVolume } from "./production";
import { addDays, daysBetween, today } from "./utils";

export const TASK_KINDS = [
  { key: "keg_clean", label: "Keg cleaning", color: "#3E7CB1" },
  { key: "kegging", label: "Kegging", color: "#5C9A3C" },
  { key: "canning", label: "Canning", color: "#C98A2B" },
  { key: "tank_clean", label: "Tank clean (CIP)", color: "#7A6FB0" },
  { key: "other", label: "Other", color: "#9BA88A" },
];
export const taskKind = (k) => TASK_KINDS.find((x) => x.key === k) || null;

const KEG_KEYS = CONTAINERS.filter((c) => c.key.startsWith("kegs")).map((c) => c.key);
const sizeOfKey = (key) => CONTAINERS.find((c) => c.key === key)?.volumeL || 0;
export const kegKeyForSize = (sizeL) => KEG_KEYS.find((k) => Math.abs(sizeOfKey(k) - Number(sizeL)) < 0.01) || null;
const beerKey = (name) => canonicalBeerName(name || "").trim().toLowerCase();

// How each beer is usually packaged, as a share of litres per container,
// from its last few packaging runs. Falls back to the brewery-wide mix, then
// to all 50L kegs for a brand-new brewery.
export function learnedPackMix(batches) {
  const byBeer = {};
  const all = {};
  const add = (target, e) => CONTAINERS.forEach((c) => (target[c.key] = (target[c.key] || 0) + (Number(e[c.key]) || 0) * c.volumeL));
  const recent = (batches || [])
    .filter((b) => !b.mergedIntoBatchId)
    .flatMap((b) => packagingEvents(b).map((e) => ({ b, e })))
    .sort((x, y) => String(y.e.date || "").localeCompare(String(x.e.date || "")));
  const seen = {};
  recent.forEach(({ b, e }) => {
    const k = beerKey(b.name);
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] <= 6) add((byBeer[k] = byBeer[k] || {}), e);
    add(all, e);
  });
  const toShares = (m) => {
    const total = Object.values(m || {}).reduce((a, v) => a + v, 0);
    if (!total) return null;
    const out = {};
    Object.entries(m).forEach(([k, v]) => v > 0 && (out[k] = v / total));
    return out;
  };
  const overall = toShares(all) || { kegs50: 1 };
  const forName = (name) => toShares(byBeer[beerKey(name)]) || overall;
  return { forName, overall, learnedFor: (name) => !!byBeer[beerKey(name)] };
}

// Roughly what a batch will go into: whole kegs per size, cases of cans.
export function expectedPack(batch, mix) {
  const vol = remainingVolume(batch) || Number(batch.volume) || 0;
  const shares = mix.forName(batch.name);
  const out = {};
  Object.entries(shares).forEach(([key, share]) => {
    const c = CONTAINERS.find((x) => x.key === key);
    if (!c) return;
    const n = Math.round((vol * share) / c.volumeL);
    if (n > 0) out[key] = n;
  });
  return out;
}

// Days between cleaning kegs and the packaging they were for, from the keg
// cleaning log. Default 1 (clean the day before).
export function learnedCleanLead(poolLog, batches) {
  const packDays = (batches || [])
    .flatMap((b) => packagingEvents(b).filter((e) => KEG_KEYS.some((k) => (Number(e[k]) || 0) > 0)).map((e) => e.date))
    .filter(Boolean)
    .sort();
  const leads = (poolLog || [])
    .filter((l) => l.kind === "clean" && l.happenedOn)
    .map((l) => {
      const next = packDays.find((d) => d >= l.happenedOn);
      return next ? daysBetween(l.happenedOn, next) : null;
    })
    .filter((d) => d != null && d <= 7);
  if (leads.length < 2) return { days: 1, learned: false };
  const sorted = [...leads].sort((a, b) => a - b);
  return { days: sorted[Math.floor(sorted.length / 2)], learned: true, count: leads.length };
}

const packLabel = (pack, kinds) =>
  Object.entries(pack)
    .filter(([k]) => kinds.includes(k))
    .map(([k, n]) => {
      if (k !== "cans330") return `${n} × ${sizeOfKey(k)}L`;
      const cases = Math.max(1, Math.round(n / 24));
      return `${cases} case${cases === 1 ? "" : "s"} of cans`;
    })
    .join(", ");

// The suggestions, before merging with saved tasks.
export function suggestTasks({ batches, poolLog, horizonDays = 45 }) {
  const tankDays = learnedTankDays(batches);
  const mix = learnedPackMix(batches);
  const lead = learnedCleanLead(poolLog, batches);
  const t = today();
  const until = addDays(t, horizonDays);
  const out = [];
  (batches || [])
    .filter((b) => !b.mergedIntoBatchId && b.startDate && !["Aging", "Packaged"].includes(b.stage) && remainingVolume(b) > 0)
    .forEach((b) => {
      const days = tankDays.daysFor(b);
      if (!days) return;
      let date = addDays(b.startDate, days);
      if (date < t) date = t; // overdue — it's still waiting, so it's today's job
      if (date > until) return;
      const pack = expectedPack(b, mix);
      const kegKinds = Object.keys(pack).filter((k) => KEG_KEYS.includes(k));
      const hasCans = (pack.cans330 || 0) > 0;
      const who = `${b.name}${b.number ? ` #${b.number}` : ""}`;
      const learned = mix.learnedFor(b.name) ? "based on how you've packaged it before" : "a guess until it's been packaged once";
      const planned = isScheduledBatch(b) ? " (planned brew)" : "";
      if (kegKinds.length) {
        const kegs = {};
        kegKinds.forEach((k) => (kegs[k] = pack[k]));
        out.push({ sourceKey: `kegging:${b.id}`, kind: "kegging", batchId: b.id, dueDate: date, text: `Keg off ${who}${planned}`, detail: `About ${packLabel(pack, kegKinds)} (${learned})`, kegs });
        const cleanDate = addDays(date, -lead.days) < t ? t : addDays(date, -lead.days);
        out.push({
          sourceKey: `keg_clean:${b.id}`, kind: "keg_clean", batchId: b.id, dueDate: cleanDate, leadDays: lead.days,
          text: `Clean kegs for ${who}`, detail: `${packLabel(pack, kegKinds)}${lead.learned ? ` — you usually clean ${lead.days} day${lead.days === 1 ? "" : "s"} ahead` : ""}`, kegs,
        });
      }
      if (hasCans) {
        out.push({ sourceKey: `canning:${b.id}`, kind: "canning", batchId: b.id, dueDate: date, text: `Can ${who}${planned}`, detail: `About ${packLabel(pack, ["cans330"])} (${learned})`, cans: pack.cans330 });
      }
    });
  return out;
}

// Saved tasks plus suggestions nobody has dealt with yet. Saved tasks that
// came from a suggestion keep its detail and keg counts.
export function mergeTasks(saved, suggestions) {
  const byKey = new Map((saved || []).filter((r) => r.sourceKey).map((r) => [r.sourceKey, r]));
  const sugByKey = new Map((suggestions || []).map((s) => [s.sourceKey, s]));
  const t = today();
  const real = (saved || [])
    .filter((r) => !r.dismissed)
    .map((r) => {
      const s = r.sourceKey ? sugByKey.get(r.sourceKey) : null;
      // Not done and its day has passed: it rolls forward to today (and shows
      // on Home) until it's ticked, keeping the day it was meant for.
      const late = !r.done && r.dueDate && r.dueDate < t;
      return { ...r, suggested: false, detail: r.detail || s?.detail || null, kegs: s?.kegs || null, ...(late ? { dueDate: t, carriedFrom: r.dueDate } : {}) };
    });
  // Moving the kegging moves its keg-cleaning (and canning) suggestion with it.
  const fresh = (suggestions || [])
    .filter((s) => !byKey.has(s.sourceKey))
    .map((s) => {
      let dueDate = s.dueDate;
      const kegging = s.kind === "keg_clean" ? byKey.get(`kegging:${s.batchId}`) : null;
      if (kegging && !kegging.dismissed && kegging.dueDate) {
        const d = addDays(kegging.dueDate, -(s.leadDays ?? 1));
        dueDate = d < t ? t : d;
      }
      // Kegging and canning the same batch happen together: move one, the other follows.
      const partner = s.kind === "canning" ? byKey.get(`kegging:${s.batchId}`) : s.kind === "kegging" ? byKey.get(`canning:${s.batchId}`) : null;
      if (partner && !partner.dismissed && partner.dueDate) dueDate = partner.dueDate;
      return { ...s, dueDate, id: `sug:${s.sourceKey}`, suggested: true, done: false };
    });
  return [...real, ...fresh].sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "") || (a.done ? 1 : 0) - (b.done ? 1 : 0));
}

// Clean kegs needed for the kegging coming up, against the clean pile, per size.
export function kegNeedsBySize(tasks, pools, days = 14) {
  const until = addDays(today(), days);
  const need = {};
  (tasks || [])
    .filter((x) => x.kind === "kegging" && !x.done && x.dueDate <= until && x.kegs)
    .forEach((x) => Object.entries(x.kegs).forEach(([k, n]) => (need[k] = (need[k] || 0) + n)));
  return Object.entries(need).map(([key, n]) => {
    const size = sizeOfKey(key);
    const sizePools = (pools || []).filter((p) => Math.abs(Number(p.sizeL) - size) < 0.01);
    const clean = sizePools.reduce((a, p) => a + (p.clean || 0), 0);
    const dirty = sizePools.reduce((a, p) => a + (p.dirty || 0), 0);
    return { key, sizeL: size, needed: n, clean, dirty, short: Math.max(0, n - clean) };
  });
}
