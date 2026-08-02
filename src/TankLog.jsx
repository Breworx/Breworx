import React, { useState, useMemo, useEffect, useRef, Suspense } from "react";
import { Plus, Droplet, ChevronLeft, X, TrendingDown, TrendingUp, Beaker, Package, Minus, AlertTriangle, Truck, CheckCircle2, Trash2, LogOut, Settings, Users, Home, LayoutGrid, FileText, FlaskConical, Warehouse, Box, Layers, Info, Calendar, Search, RotateCcw, Menu, QrCode } from "lucide-react";
// Charts are lazy-loaded — recharts is one of the heaviest dependencies in
// the app and most people never open a screen with a chart on it in a given
// session, so there's no reason to make everyone download it upfront.
const LineChart = React.lazy(() => import("recharts").then((m) => ({ default: m.LineChart })));
const Line = React.lazy(() => import("recharts").then((m) => ({ default: m.Line })));
const BarChart = React.lazy(() => import("recharts").then((m) => ({ default: m.BarChart })));
const Bar = React.lazy(() => import("recharts").then((m) => ({ default: m.Bar })));
const XAxis = React.lazy(() => import("recharts").then((m) => ({ default: m.XAxis })));
const YAxis = React.lazy(() => import("recharts").then((m) => ({ default: m.YAxis })));
const CartesianGrid = React.lazy(() => import("recharts").then((m) => ({ default: m.CartesianGrid })));
const Tooltip = React.lazy(() => import("recharts").then((m) => ({ default: m.Tooltip })));
const ResponsiveContainer = React.lazy(() => import("recharts").then((m) => ({ default: m.ResponsiveContainer })));
import { supabase } from "./supabaseClient";
import {
  rowToBatch,
  batchToRow,
  rowToInventoryItem,
  inventoryItemToRow,
  rowToPO,
  poToRow,
  rowToRecipe,
  recipeToRow,
  rowToProfile,
  rowToTank,
  tankToRow,
  rowToStockTake,
  stockTakeToRow,
  rowToFoodSafetyRecord,
  foodSafetyRecordToRow,
  rowToSupplier,
  supplierToRow,
  rowToCustomer,
  customerToRow,
  rowToSalesOrder,
  salesOrderToRow,
  rowToSupplierDocument,
  supplierDocumentToRow,
  rowToConsumable,
  consumableToRow,
  rowToPackageType,
  packageTypeToRow,
  rowToActivity,
  activityToRow,
} from "./lib/mappers";

// The path a batch follows depends on whether the brewery has any Brite Beer
// Tanks configured — if so, beer moves through one before packaging.
function getStages(hasBriteTanks) {
  return hasBriteTanks
    ? ["Brewing", "Primary", "Cooling", "Brite Tank", "Packaged"]
    : ["Brewing", "Primary", "Cooling", "Packaged"];
}

const STAGE_COLOR = {
  Brewing: "#E08A3C",
  Primary: "#4FB83D",
  Cooling: "#4AA8C9",
  "Brite Tank": "#F0B429",
  // Kept for any batches created before this stage restructure.
  Secondary: "#4AA8C9",
  Conditioning: "#F0B429",
  Packaged: "#9BA88A",
};

// A tank's CIP cycle once it's empty — null/unset is treated as "Needs CIP"
// by default, since assuming a tank is dirty until proven otherwise is the
// safer default for a food-safety-adjacent status. Brite tanks branch after
// "Rinsed" — acid and caustic are alternatives, not both required — so
// stages are advanced via a map rather than a fixed sequence.
const CLEAN_STAGE_COLOR = {
  "Needs CIP": "#B5502F",
  Rinsed: "#D9A441",
  "Acid clean": "#8E6FB5",
  "Caustic clean": "#4AA8C9",
  Sanitised: "#5C9A3C",
};
const NEXT_CLEAN_STAGE = {
  "Needs CIP": "Rinsed",
  Rinsed: "Caustic clean",
  "Caustic clean": "Sanitised",
  "Acid clean": "Sanitised",
  Sanitised: "Needs CIP",
};

const CONTAINERS = [
  { key: "cans330", label: "330ml Can", shortLabel: "Can", volumeL: 0.33 },
  { key: "kegs20", label: "20L Keg", shortLabel: "20L Keg", volumeL: 20 },
  { key: "kegs30", label: "30L Keg", shortLabel: "30L Keg", volumeL: 30 },
  { key: "kegs50", label: "50L Keg", shortLabel: "50L Keg", volumeL: 50 },
];

const packagedVolume = (packaging) =>
  !packaging ? 0 : CONTAINERS.reduce((sum, c) => sum + (packaging[c.key] || 0) * c.volumeL, 0);

// Packaging is stored as { events: [{id,date,cans330,kegs20,...}], discarded: number }.
// Batches packaged before this feature existed have the old shape (container
// counts directly on the packaging object) — read those as a single legacy event.
function packagingEvents(batch) {
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

const packagingDiscarded = (batch) => (batch.packaging && batch.packaging.discarded) || 0;

// Sums every packaging event on a batch into one {cans330: N, kegs20: N, ...}
// total — how much of each container size this batch has ever produced.
function packagedTotalsByContainer(batch) {
  const totals = {};
  CONTAINERS.forEach((c) => (totals[c.key] = 0));
  packagingEvents(batch).forEach((e) => {
    CONTAINERS.forEach((c) => {
      totals[c.key] += e[c.key] || 0;
    });
  });
  return totals;
}

// Sums how much of a batch's stock is already spoken for by sales orders —
// Draft and Cancelled orders don't reserve anything, everything else does.
function soldTotalsByContainer(batchId, salesOrders) {
  const totals = {};
  CONTAINERS.forEach((c) => (totals[c.key] = 0));
  (salesOrders || []).forEach((so) => {
    if (so.status === "Draft" || so.status === "Cancelled") return;
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
function availableStockList(batches, salesOrders) {
  const list = [];
  batches.forEach((b) => {
    if (!b.packaging) return;
    const packaged = packagedTotalsByContainer(b);
    const sold = soldTotalsByContainer(b.id, salesOrders);
    CONTAINERS.forEach((c) => {
      if ((packaged[c.key] || 0) > 0) {
        list.push({
          batchId: b.id,
          batchName: b.name,
          batchNumber: b.number,
          containerKey: c.key,
          containerLabel: c.label,
          packaged: packaged[c.key],
          available: (packaged[c.key] || 0) - (sold[c.key] || 0),
        });
      }
    });
  });
  return list;
}

const totalPackagedVolume = (batch) =>
  packagingEvents(batch).reduce((sum, e) => sum + packagedVolume(e), 0);

const remainingVolume = (batch) => {
  const rem = batch.volume - totalPackagedVolume(batch) - packagingDiscarded(batch);
  return Math.max(0, Math.round(rem * 100) / 100);
};

// NZ Customs alcohol excise duty rates, effective 1 July 2026 (the annual
// CPI-indexed adjustment). Source: customs.govt.nz "New excise duty rates
// for alcohol from 1 July 2026". Two different calculation bases apply
// depending on strength — most craft beer (2.5–6% ABV) is charged per
// litre of pure alcohol, not per litre of beverage.
const NZ_EXCISE_BANDS = [
  { min: 0, max: 1.15, rate: 0, basis: "exempt" },
  { min: 1.15, max: 2.5, rate: 0.58492, basis: "beverage" },
  { min: 2.5, max: 6, rate: 38.999, basis: "alcohol" },
  { min: 6, max: 9, rate: 3.1199, basis: "beverage" },
  { min: 9, max: 14, rate: 3.8999, basis: "beverage" },
  { min: 14, max: 23, rate: 71.034, basis: "alcohol" },
  { min: 23, max: Infinity, rate: 71.034, basis: "alcohol" },
];

function exciseBandForAbv(abv) {
  return NZ_EXCISE_BANDS.find((b) => abv > b.min && abv <= b.max) || NZ_EXCISE_BANDS[0];
}

// One row per packaging event, since excise is calculated on what actually
// left the licensed area on a given date — a batch packaged across several
// sessions can straddle two different reporting periods.
function exciseRowsForBatches(batches) {
  const rows = [];
  batches.forEach((b) => {
    if (!b.og) return;
    const latest = latestReading(b);
    const abv = latest ? calcABV(b.og, latest.gravity) : null;
    if (abv == null || abv <= 0) return;
    const band = exciseBandForAbv(abv);
    packagingEvents(b).forEach((e) => {
      const volumeL = packagedVolume(e);
      if (volumeL <= 0) return;
      const duty = band.basis === "alcohol" ? volumeL * (abv / 100) * band.rate : band.basis === "beverage" ? volumeL * band.rate : 0;
      rows.push({ batchId: b.id, batchName: b.name, batchNumber: b.number, date: e.date, abv, volumeL, band, duty });
    });
  });
  return rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function monthKeyFromDate(dateStr) {
  return dateStr && dateStr.length >= 7 ? dateStr.slice(0, 7) : "unknown";
}

function monthLabelFromKey(key) {
  if (key === "unknown") return "Unknown date";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// Groups every packaging event across every batch by month, with a running
// volume/container total per month and a per-batch breakdown within it.
function packagingByMonth(batches) {
  const groups = {};
  batches.forEach((b) => {
    packagingEvents(b).forEach((e) => {
      const key = monthKeyFromDate(e.date);
      if (!groups[key]) groups[key] = { volume: 0, counts: {}, batches: {} };
      const vol = packagedVolume(e);
      groups[key].volume = Math.round((groups[key].volume + vol) * 100) / 100;
      CONTAINERS.forEach((c) => {
        groups[key].counts[c.key] = (groups[key].counts[c.key] || 0) + (e[c.key] || 0);
      });
      if (!groups[key].batches[b.id]) groups[key].batches[b.id] = { id: b.id, name: b.name, number: b.number, volume: 0 };
      groups[key].batches[b.id].volume = Math.round((groups[key].batches[b.id].volume + vol) * 100) / 100;
    });
  });
  return Object.keys(groups)
    .sort()
    .reverse()
    .map((key) => ({ key, label: monthLabelFromKey(key), ...groups[key], batches: Object.values(groups[key].batches) }));
}

// A tank is occupied if some batch is sitting on it and hasn't been fully
// packaged out yet. excludeBatchId lets a batch ignore its own current
// assignment when checking whether it can stay put.
// A batch can sit on a single tank (tankId) or be split across several
// (splitTanks) — this returns every tank id it currently occupies either way.
// Natural sort: "Tank 2" before "Tank 10", numeric chunks compared as
// numbers rather than character-by-character; falls back to plain
// alphabetical for tanks with non-numbered names.
function compareTankNames(a, b) {
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
const sortedTanks = (tanks) => [...tanks].sort((a, b) => compareTankNames(a.name, b.name));

const COMMON_FAULTS = [
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
const FAULT_SEVERITY_COLOR = { Low: "#D9A441", Medium: "#E08A3C", High: "#B5502F" };
const FAULT_SEVERITY_NEXT = { none: "Low", Low: "Medium", Medium: "High", High: null };

// batch.faults is a log of dated entries (multiple per fault name allowed,
// one per day it was reassessed) so a fault noticed one day and gone the
// next doesn't erase the earlier observation. This collapses it down to
// just the latest entry per fault — i.e. "what's the current read."
function currentFaults(batch) {
  const byName = {};
  (batch.faults || []).forEach((f) => {
    if (!byName[f.fault] || f.date > byName[f.fault].date) byName[f.fault] = f;
  });
  return Object.values(byName);
}

function batchTankIds(batch) {
  if (batch.splitTanks && batch.splitTanks.length > 0) return batch.splitTanks.map((t) => t.tankId);
  if (batch.tankId) return [batch.tankId];
  return [];
}

function batchTankSummary(batch) {
  if (batch.splitTanks && batch.splitTanks.length > 0) {
    return batch.splitTanks.map((t) => `${t.tankName} (${t.volume}L)`).join(" + ");
  }
  return batch.tankName || "";
}

// Shows sub-1kg amounts in grams instead — 0.05kg is much easier to read as 50g.
function formatQty(qty, unit) {
  const n = Number(qty);
  if (unit === "kg" && n > 0 && n < 1) {
    return `${Math.round(n * 1000)}g`;
  }
  const display = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  return `${display} ${unit}`;
}

// Groups recipes by family and picks the one to actually use for each —
// whichever version is explicitly pinned as active, or the latest if none is.
function activeRecipesByFamily(recipes) {
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

function tankIsOccupied(batches, tankId, excludeBatchId) {
  return batches.some((b) => {
    if (!batchTankIds(b).includes(tankId)) return false;
    if (excludeBatchId && b.id === excludeBatchId) return false;
    const fullyDone = b.stage === "Packaged" && remainingVolume(b) === 0;
    return !fullyDone;
  });
}

function occupyingBatch(batches, tankId, excludeBatchId) {
  return batches.find((b) => {
    if (!batchTankIds(b).includes(tankId)) return false;
    if (excludeBatchId && b.id === excludeBatchId) return false;
    const fullyDone = b.stage === "Packaged" && remainingVolume(b) === 0;
    return !fullyDone;
  });
}

function aggregatePackagingCounts(batch) {
  const totals = {};
  CONTAINERS.forEach((c) => (totals[c.key] = 0));
  packagingEvents(batch).forEach((e) => CONTAINERS.forEach((c) => (totals[c.key] += e[c.key] || 0)));
  return totals;
}

const BP_TANK_PATH = "M11 5 Q9 5 9 7 V21.5 L18.3 33.2 Q19 34 19.7 33.2 L29 21.5 V7 Q29 5 27 5 Z";

function BreworxMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="bp-tank-clip">
          <path d={BP_TANK_PATH} />
        </clipPath>
        <linearGradient id="bp-liquid-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7CB854" />
          <stop offset="100%" stopColor="#4A7D2E" />
        </linearGradient>
        <linearGradient id="bp-marker-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8BE63" />
          <stop offset="100%" stopColor="#D4A24C" />
        </linearGradient>
      </defs>
      {/* Fermenter tank outline, softened shoulders */}
      <path d={BP_TANK_PATH} stroke="#5C9A3C" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
      {/* Liquid fill with gradient depth + glass highlight */}
      <g clipPath="url(#bp-tank-clip)">
        <rect x="7" y="15" width="24" height="21" fill="url(#bp-liquid-grad)" opacity="0.85" />
        <rect x="12.5" y="8" width="2.4" height="21" rx="1.2" fill="#FFFFFF" opacity="0.28" />
      </g>
      {/* Reading marker calling out the point on the tank */}
      <line x1="27.5" y1="15" x2="34" y2="9" stroke="url(#bp-marker-grad)" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="34" cy="9" r="2.6" fill="url(#bp-marker-grad)" />
      <circle cx="34" cy="9" r="5.4" stroke="#D4A24C" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function BrewpointLoadingMark({ size = 52, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 14 }}>
      <style>{`
        @keyframes bp-mark-spin { to { transform: rotate(360deg); } }
        @keyframes bp-mark-pulse { 0%, 100% { opacity: 0.22; } 50% { opacity: 0.55; } }
      `}</style>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <defs>
          <clipPath id="bp-loading-clip">
            <path d={BP_TANK_PATH} />
          </clipPath>
          <linearGradient id="bp-loading-liquid-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7CB854" />
            <stop offset="100%" stopColor="#4A7D2E" />
          </linearGradient>
          <linearGradient id="bp-loading-marker-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E8BE63" />
            <stop offset="100%" stopColor="#D4A24C" />
          </linearGradient>
        </defs>
        <path d={BP_TANK_PATH} stroke="#5C9A3C" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
        <g clipPath="url(#bp-loading-clip)">
          <rect x="7" y="15" width="24" height="21" fill="url(#bp-loading-liquid-grad)" style={{ animation: "bp-mark-pulse 1.6s ease-in-out infinite" }} />
        </g>
        <g style={{ transformOrigin: "19px 19px", animation: "bp-mark-spin 1.3s linear infinite" }}>
          <line x1="27.5" y1="15" x2="34" y2="9" stroke="url(#bp-loading-marker-grad)" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="34" cy="9" r="2.6" fill="url(#bp-loading-marker-grad)" />
          <circle cx="34" cy="9" r="5.4" stroke="#D4A24C" strokeWidth="1" opacity="0.4" />
        </g>
      </svg>
      {label && (
        <span style={{ color: "#9BA88A", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>
          {label}
        </span>
      )}
    </div>
  );
}

// Card-shaped placeholders shown while the first data load is in flight —
// gives the screen its real shape immediately instead of a blank spinner.
function SkeletonList({ count = 5 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <style>{`
        @keyframes bp-skeleton-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .bp-skeleton-block { animation: none !important; opacity: 0.7 !important; }
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "#FFFFFF",
            border: "1px solid #DDE0C8",
            borderRadius: 6,
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            className="bp-skeleton-block"
            style={{ width: 44, height: 44, borderRadius: 6, background: "#EBE8D6", flexShrink: 0, animation: "bp-skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              className="bp-skeleton-block"
              style={{ width: "42%", height: 13, borderRadius: 4, background: "#EBE8D6", animation: "bp-skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
            />
            <div
              className="bp-skeleton-block"
              style={{ width: "65%", height: 10, borderRadius: 4, background: "#EBE8D6", animation: "bp-skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const SCHEDULE_USE_PRIORITY = { Mash: 0, Boil: 1, Aroma: 2, "Dry Hop": 3 };
function compareScheduleItems(a, b) {
  const pa = SCHEDULE_USE_PRIORITY[a.use] ?? 4;
  const pb = SCHEDULE_USE_PRIORITY[b.use] ?? 4;
  if (pa !== pb) return pa - pb;
  if (a.use === "Dry Hop") return (a.time ?? 0) - (b.time ?? 0);
  return (b.time ?? 0) - (a.time ?? 0);
}

const uid = () => Math.random().toString(36).slice(2, 9);

const HELP_ARTICLES = [
  {
    category: "Getting started",
    question: "How do I add a recipe?",
    answer: "Go to Recipes → New recipe. Fill in your ingredients and schedule, and it calculates OG/FG/ABV/IBU/SRM live as you go. \"Save & brew this recipe\" saves it and jumps straight into New Batch pre-filled.",
  },
  {
    category: "Getting started",
    question: "How do I brew a batch?",
    answer: "On Batches, tap \"New batch.\" Pick a saved recipe (it pre-fills everything) or enter details manually, choose a tank and brew date, then start it.",
  },
  {
    category: "Getting started",
    question: "How do I add a tank?",
    answer: "Go to Brewery → New tank. Set its name, type (Fermenter or Brite Tank), and capacity.",
  },
  {
    category: "Batches",
    question: "How do I schedule a batch for the future?",
    answer: "Go to Production and tap an empty day on any tank's row — it opens New Batch pre-filled with that tank and date. You can also just type a future date directly into New Batch's \"Brew date\" field.",
  },
  {
    category: "Batches",
    question: "Why can't I pick a certain tank when creating a batch?",
    answer: "A tank is only blocked if it's genuinely occupied right now and you're brewing today or earlier. If you're scheduling for a future date, an occupied tank is still selectable — you'll just get a heads-up reminder to make sure it's free by then.",
  },
  {
    category: "Batches",
    question: "How do I change my batch numbering?",
    answer: "New Batch has an editable \"Batch number\" field, pre-filled with the next number in sequence. Type over it to start counting from wherever you want — future batches keep incrementing from your new number.",
  },
  {
    category: "Batches",
    question: "How do I package a batch?",
    answer: "Open the batch and advance it through its stages (Brewing → Primary → Cooling). Once it's ready, tap \"Package batch,\" enter how many cans/kegs you filled, and optionally pick a Package Type to deduct consumables automatically.",
  },
  {
    category: "Batches",
    question: "I packaged a batch by mistake — can I undo it?",
    answer: "Yes. On the batch page, find the packaging run under Packaging and tap the circular undo icon next to it. It reverts the batch to Cooling and returns any consumables that were deducted back into stock.",
  },
  {
    category: "Batches",
    question: "How do I track quality issues like diacetyl or oxidation?",
    answer: "While a batch is Brewing, Primary, or Cooling, its page shows a Quality checklist of common faults. Tap one to cycle through Low → Medium → High → off. Each day gets its own fresh assessment, so an earlier note is never silently overwritten.",
  },
  {
    category: "Recipes",
    question: "How do I compare batches brewed from the same recipe?",
    answer: "Go to Recipe Analytics, search for the recipe, then tap \"Compare batches\" and select two or more to see target vs. actual OG/FG, attenuation, ABV, mash pH/temp, cost, and faults side by side.",
  },
  {
    category: "Recipes",
    question: "How do I print a recipe or batch sheet?",
    answer: "Both recipe pages and batch pages have a \"Print / Save as PDF\" button near the bottom. On an iPad, the print dialog lets you save straight to Files as a PDF.",
  },
  {
    category: "Stock",
    question: "What's the difference between Inventory and Consumables?",
    answer: "Inventory is your brewing ingredients — grain, hops, yeast. Consumables are packaging materials — cans, lids, boxes, labels. They're tracked separately since they're used at completely different stages.",
  },
  {
    category: "Stock",
    question: "What's a Package Type?",
    answer: "A Package Type defines which consumables (and how many of each) get used per unit packaged — e.g. 1 can + 1 lid + a share of a box. Pick one when logging a packaging run and it deducts the right stock automatically. A label line can also be set to auto-match by beer name, so one package type works across every recipe.",
  },
  {
    category: "Stock",
    question: "How do purchase orders work?",
    answer: "Create a draft PO with supplier and line items, mark it Sent once it's placed, then \"Mark received\" once it arrives — that's what actually adds the stock into Inventory, with proper lot tracking and cost per unit.",
  },
  {
    category: "Stock",
    question: "How do I export my data?",
    answer: "Inventory, Purchase Orders, and Batches each have an \"Export CSV\" link above their list, which respects whatever search filter is active.",
  },
  {
    category: "Compliance",
    question: "How do I log a food safety checklist or staff sickness?",
    answer: "Go to Food Safety. Checklists are at the top; \"Staff training,\" \"Staff sickness,\" calibration, water tests, and mock recalls are all under Other records.",
  },
  {
    category: "Account",
    question: "How do I start completely fresh (delete everything)?",
    answer: "Settings → \"Delete company\" (near the bottom, in red). It wipes every batch, recipe, and record for the whole company, then signs you out to the sign-up screen. Type \"DELETE COMPANY\" to confirm — this can't be undone.",
  },
  {
    category: "Account",
    question: "I made a mistake — can I undo a delete?",
    answer: "Almost everything you can delete (batches, recipes, tanks, suppliers, ingredients, consumables, package types, purchase orders) shows a 5-second \"Undo\" option in the confirmation toast right after you delete it.",
  },
  {
    category: "Finding things",
    question: "How do I quickly find something without digging through menus?",
    answer: "Tap \"Search…\" right under the logo in the sidebar. It searches batches, recipes, purchase orders, and tanks all at once.",
  },
];

// A printable QR code linking straight to a tank — scan it (e.g. stuck on
// the side of the tank) to jump right to whatever's currently in it.
function TankQRModal({ tank, onClose }) {
  const url = `${window.location.origin}${window.location.pathname}?tank=${tank.id}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;
  return (
    <Modal title={`QR code — ${tank.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5, textAlign: "center" }}>
          Print this and stick it on the tank — scanning it opens whatever's currently in {tank.name}.
        </div>
        <img src={qrImg} alt={`QR code for ${tank.name}`} width={220} height={220} style={{ border: "1px solid #DDE0C8", borderRadius: 6, background: "#FFFFFF", padding: 10 }} />
        <button
          onClick={() => window.print()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "none",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 16px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <FileText size={14} /> Print
        </button>
        <div className="bp-print-sheet" style={{ display: "none", textAlign: "center" }}>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, margin: "0 0 16px" }}>{tank.name}</h1>
          <img src={qrImg} alt={`QR code for ${tank.name}`} width={260} height={260} />
        </div>
      </div>
    </Modal>
  );
}

const TOUR_STEPS = [
  {
    title: "Welcome to Brewpoint",
    body: "This is your brewery's home base — tanks, batches, recipes, stock, and compliance, all in one place. Let's take a quick, guided look around.",
    target: null,
  },
  {
    title: "Start in Brewery",
    body: "Set up your fermenters and brite tanks here — plus a mash tun and kettle too, if you want brew day tracked from the very start, right through mashing, boiling, and transferring to a fermenter.",
    target: "nav-brewery",
    needsSidebar: true,
  },
  {
    title: "Then brew a batch",
    body: "On Batches, tap \"New batch.\" Pick a saved recipe and it pre-fills everything, or enter the details yourself. Brew day timers for mash, boil, and whirlpool are right there on the batch page.",
    target: "nav-batches",
    needsSidebar: true,
  },
  {
    title: "Watch it happen on Home",
    body: "Once you're brewing, Home becomes your real-time picture of the brewery — tanks show color-coded stages (bubbling while fermenting, frosty while cooling), and once a tank empties out, it walks through a cleaning cycle right there before it's marked ready again.",
    target: null,
  },
  {
    title: "Production & Recipes",
    body: "Production is for scheduling brews ahead of time across your tanks. Recipes is your library — save one to reuse on brew day, or check Recipe Analytics to compare batches of the same beer over time.",
    target: "nav-groups",
    needsSidebar: true,
  },
  {
    title: "Stock & Compliance",
    body: "Stock covers ingredients, packaging materials, and purchase orders — with low-stock warnings and reorder shortcuts. Compliance covers food safety checklists, staff training, and records.",
    target: "nav-groups",
    needsSidebar: true,
  },
  {
    title: "Find anything instantly",
    body: "Tap Search any time to jump straight to a batch, recipe, order, or tank by name — no digging through menus.",
    target: "search-btn",
    needsSidebar: true,
  },
  {
    title: "If you get stuck",
    body: "The Help guide has quick answers for almost everything in here. And keep an eye on the \"Getting set up\" checklist back on Home — it tracks exactly what's left before you're fully up and running.",
    target: "help-guide-btn",
    needsSidebar: true,
  },
  {
    title: "You're all set",
    body: "That's the tour. Head to Brewery to set up your first tank, then start brewing whenever you're ready.",
    target: null,
  },
];

// Per-page spotlight tours — same mechanism as the welcome tour, but each
// one fires only the first time you land on that specific page. Keyed by
// the same string used for `view`, so it's a straight lookup at render
// time. Kept intentionally short (2-3 steps) — these are quick orientation,
// not a repeat of the welcome tour.
const PAGE_TOURS = {
  brewery: [
    {
      title: "Set up your tanks",
      body: "Add a tank here for every fermenter and Brite Tank you have — and a Mash Tun and Kettle too, if you want brew day tracked from mashing right through to transferring into a fermenter.",
      target: "page-brewery-newbtn",
    },
    {
      title: "Check on any tank",
      body: "The calendar icon shows a tank's full history — every batch that's used it, and every cleaning step logged against it. Handy for spotting a tank with repeat problems.",
      target: "page-brewery-history",
    },
  ],
  batches: [
    {
      title: "Every batch lives here",
      body: "From brew day through to packaging. Tap here to start one — pick a saved recipe and it pre-fills everything, or enter the details yourself.",
      target: "page-batches-newbtn",
    },
    {
      title: "Find any batch fast",
      body: "Search by name, style, or number — this covers every stage, including ones you've already packaged. There's also an Export CSV link once you've got a few batches in.",
      target: "page-batches-search",
    },
  ],
  inventory: [
    {
      title: "Your brewing ingredients",
      body: "Grain, hops, yeast — add stock manually here, or receive it automatically through a Purchase Order with proper lot tracking.",
      target: "page-inventory-newbtn",
    },
    {
      title: "Keep it accurate",
      body: "Walk the brewery and count what's actually on the shelf — any discrepancy gets logged, and the report's saved for later.",
      target: "page-inventory-stocktake",
    },
  ],
  consumables: [
    {
      title: "Packaging supplies",
      body: "Cans, lids, boxes, labels — tracked separately from your brewing ingredients. Add a cost per unit here to get true packaging costs.",
      target: "page-consumables-newbtn",
    },
    {
      title: "Keep it accurate",
      body: "Same idea as ingredients — walk the shelf, count what's there, and any discrepancy gets logged.",
      target: "page-consumables-stocktake",
    },
  ],
  packageTypes: [
    {
      title: "Bundle what a run uses",
      body: "Define what consumables get used per unit packaged — e.g. 1 can + 1 lid + a share of a box. Pick a package type when you log a packaging run and it deducts stock automatically, with the cost worked out for you.",
      target: "page-packageTypes-newbtn",
    },
  ],
  orders: [
    {
      title: "Order from your suppliers",
      body: "Create a purchase order here to bring ingredients or packaging in from a supplier. Receiving one adds the stock straight in, with proper lot tracking and cost per unit.",
      target: "page-orders-newbtn",
    },
  ],
  recipes: [
    {
      title: "Save a recipe to reuse",
      body: "Ingredients pull in automatically on brew day, and OG/FG/ABV/IBU/SRM calculate live as you build one out.",
      target: "page-recipes-newbtn",
    },
    {
      title: "Find one fast",
      body: "Search by name or style — this covers every version you've saved, including older ones you've since updated.",
      target: "page-recipes-search",
    },
  ],
  recipeAnalytics: [
    {
      title: "Compare batches of the same beer",
      body: "Search for a recipe to see every batch ever brewed from it side by side — target vs actual OG/FG, attenuation, ABV, days in tank, and cost — so you can spot drift or confirm consistency over time.",
      target: "page-recipeAnalytics-search",
    },
    {
      title: "Or search by fault instead",
      body: "See if a fault keeps showing up on a particular recipe, or a particular tank, regardless of what's brewed in it.",
      target: "page-recipeAnalytics-faultmode",
    },
  ],
  foodsafety: [
    {
      title: "Stay on top of compliance",
      body: "Log daily, weekly, and monthly checklists, equipment calibration, and staff training here — everything you'd need on hand for an audit.",
      target: null,
    },
  ],
  production: [
    {
      title: "See every tank's schedule at a glance",
      body: "Tap an empty day on a tank's row to schedule a batch ahead of time, or tap an existing bar to open that batch.",
      target: null,
    },
  ],
};

// Highlights a live element on screen by its data-tour attribute — finds
// it, measures its real position, and dims everything else via a single
// box-shadow trick (a huge spread radius on a transparent box acts as a
// full-screen overlay with a "hole" cut exactly where the box is). Opens
// the mobile sidebar drawer itself for steps that need it visible, and
// closes it again once the tour moves past those steps or ends.
function SpotlightTour({ steps, onClose, setSidebarOpen, showLogoOnFirst = false }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const slide = steps[step];
  const isLast = step === steps.length - 1;

  useEffect(() => {
    setSidebarOpen(!!slide.needsSidebar);
  }, [step]);

  useEffect(() => {
    if (!slide.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${slide.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const timeoutId = setTimeout(measure, 280);
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  useEffect(() => () => setSidebarOpen(false), []);

  const pad = 8;
  const narrow = window.innerWidth < 560;
  const cardWidth = 300;
  let cardStyle;
  if (rect && !narrow) {
    const top = Math.max(20, Math.min(rect.top, window.innerHeight - 260));
    const left = Math.min(rect.right + 20, window.innerWidth - cardWidth - 20);
    cardStyle = { position: "fixed", top, left, width: cardWidth };
  } else if (rect && narrow) {
    cardStyle = { position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", width: "calc(100% - 40px)", maxWidth: cardWidth };
  } else {
    cardStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "calc(100% - 40px)", maxWidth: cardWidth + 60 };
  }

  return (
    <>
      {rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 10,
            border: "2px solid #5C9A3C",
            boxShadow: "0 0 0 4px rgba(92,154,60,0.3), 0 0 0 9999px rgba(10,12,11,0.72)",
            pointerEvents: "none",
            zIndex: 99,
            transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
          }}
        />
      )}
      {!rect && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,11,0.65)", zIndex: 98 }} />
      )}
      <div
        style={{
          ...cardStyle,
          zIndex: 100,
          background: "#F8F5EA",
          border: "1px solid #DDE0C8",
          borderRadius: 12,
          padding: "22px 20px 18px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          boxSizing: "border-box",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
        >
          <X size={16} />
        </button>

        {step === 0 && showLogoOnFirst && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <BreworxMark size={38} />
          </div>
        )}

        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 500, color: "#2A3324", margin: "0 0 8px", textAlign: (step === 0 && showLogoOnFirst) || isLast ? "center" : "left" }}>
          {slide.title}
        </h2>
        <p style={{ color: "#5C6B54", fontSize: 13.5, lineHeight: 1.5, margin: "0 0 18px", textAlign: (step === 0 && showLogoOnFirst) || isLast ? "center" : "left" }}>
          {slide.body}
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{ width: i === step ? 16 : 6, height: 6, borderRadius: 3, background: i === step ? "#5C9A3C" : "#DDE0C8", transition: "width 0.2s" }}
            />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{ flex: 1, background: "none", border: "1px solid #C9D1AC", borderRadius: 5, padding: "10px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
            >
              Back
            </button>
          )}
          <button
            onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
            style={{ flex: step > 0 ? 1 : "unset", width: step === 0 ? "100%" : "auto", background: "#5C9A3C", border: "none", borderRadius: 5, padding: "10px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
        {!isLast && (
          <button
            onClick={onClose}
            style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif" }}
          >
            Skip tour
          </button>
        )}
      </div>
    </>
  );
}


function HelpGuideModal({ onClose }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = HELP_ARTICLES.filter(
    (a) => !q || a.question.toLowerCase().includes(q) || a.answer.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
  );
  const categories = [...new Set(filtered.map((a) => a.category))];

  return (
    <Modal title="Help guide" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for how to do something…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        />
        {filtered.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13, padding: "12px 4px" }}>No matches for "{query}".</div>
        )}
        {categories.map((cat) => (
          <div key={cat}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              {cat}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered
                .filter((a) => a.category === cat)
                .map((a, i) => (
                  <details key={i} style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px" }}>
                    <summary style={{ cursor: "pointer", color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif" }}>
                      {a.question}
                    </summary>
                    <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5, marginTop: 8 }}>{a.answer}</div>
                  </details>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const CHANGELOG = [
  {
    id: 1,
    title: "Production Manager & scheduling",
    items: [
      "Visual tank schedule — see every tank's timeline at a glance",
      "Schedule a batch ahead of time, with estimated days in tank",
      "Edit or delete a scheduled brew before it actually starts",
    ],
  },
  {
    id: 2,
    title: "Consumables & Package Types",
    items: [
      "Track cans, lids, boxes, and labels separately from ingredients",
      "Package Types automatically deduct the right consumables when you log packaging",
      "Undo a packaging run — reverts to Cooling and returns consumables to stock",
    ],
  },
  {
    id: 3,
    title: "Recipe Analytics & quality tracking",
    items: [
      "Compare batches of the same recipe side by side",
      "Quality fault checklist (diacetyl, oxidation, and more) with Low/Medium/High severity, tracked day by day",
      "Fault-free rate and trend charts per recipe",
    ],
  },
  {
    id: 4,
    title: "Navigation & mobile",
    items: [
      "Sidebar grouped into Production, Recipes, Stock, and Compliance",
      "Proper slide-out menu on phones and narrow screens",
    ],
  },
  {
    id: 5,
    title: "Export & display",
    items: [
      "CSV export for Inventory, Purchase Orders, and Batches",
      "Adjustable text size in Settings",
      "This changelog, so you don't have to go digging for what's changed",
    ],
  },
];
const LATEST_CHANGELOG_ID = CHANGELOG[CHANGELOG.length - 1].id;

function WhatsNewModal({ onClose, entries }) {
  return (
    <Modal title="What's new" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {entries.map((entry) => (
          <div key={entry.id}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, color: "#2A3324", marginBottom: 8 }}>
              {entry.title}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
              {entry.items.map((item, i) => (
                <li key={i} style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          onClick={onClose}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}

function downloadCSV(filename, headers, rows) {
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);

const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// Scrolls a just-focused field into view after a short delay — long enough
// for the iOS on-screen keyboard to finish sliding up, so the field doesn't
// end up hidden behind it inside a scrollable modal.
const scrollFieldIntoView = (e) => {
  const el = e.target;
  setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 300);
};

// --- Recipe calculation engine ---------------------------------------------
// Formulas adapted to metric units (kg, L, g) from the standard brewing
// references: Tinseth (IBU), Morey (SRM), and the common gravity-points model
// for OG. These are estimates, same as any brewing software — real mash
// efficiency and hop utilization vary batch to batch.

// OG from the grain bill. Each grain ingredient may carry a `potential`
// field — the standard points-per-pound-per-gallon (PPG) figure every
// maltster publishes (roughly 37-38 for a standard base malt, lower for
// specialty/crystal malts). Converted internally to metric.
function calcOG(ingredients, batchVolumeL, efficiencyPct) {
  const grains = (ingredients || []).filter((i) => i.category === "Grain" && i.potential);
  if (grains.length === 0 || !batchVolumeL) return null;
  // `potential` is entered as the standard points-per-pound-per-gallon (PPG)
  // figure every maltster publishes (e.g. ~37-38 for a base malt) — convert
  // grain weight to pounds and batch volume to gallons to use it correctly.
  const kgToLb = 2.20462;
  const lToGal = 0.264172;
  const volumeGal = batchVolumeL * lToGal;
  const totalPointsGal = grains.reduce((sum, g) => sum + (Number(g.qty) || 0) * kgToLb * (Number(g.potential) || 0), 0);
  const eff = (Number(efficiencyPct) || 100) / 100;
  return 1 + (totalPointsGal * eff) / volumeGal / 1000;
}

// SRM (colour) via the Morey equation, converted from kg/L to the
// lb/gallon units the original formula uses.
function calcSRM(ingredients, batchVolumeL) {
  const grains = (ingredients || []).filter((i) => i.category === "Grain" && i.colorLovibond);
  if (grains.length === 0 || !batchVolumeL) return null;
  const kgToLb = 2.20462;
  const lToGal = 0.264172;
  const mcu = grains.reduce((sum, g) => sum + (Number(g.qty) || 0) * kgToLb * (Number(g.colorLovibond) || 0), 0) / (batchVolumeL * lToGal);
  if (mcu <= 0) return null;
  return 1.4922 * Math.pow(mcu, 0.6859);
}

// IBU via Tinseth, using only Boil and First Wort hop additions from the
// schedule (dry hop / whirlpool additions aren't counted here, same as most
// calculators default to for standard bittering IBU).
function calcIBU(schedule, batchVolumeL, og) {
  const hopAdds = (schedule || []).filter((s) => (s.use === "Boil" || s.use === "First Wort") && s.alphaAcid);
  if (hopAdds.length === 0 || !batchVolumeL) return null;
  const gravity = og || 1.05;
  const lToGal = 0.264172;
  const volumeGal = batchVolumeL * lToGal;
  const totalIBU = hopAdds.reduce((sum, h) => {
    const aaDecimal = (Number(h.alphaAcid) || 0) / 100;
    const weightOz = (Number(h.amount) || 0) * (h.unit === "kg" ? 35.274 : h.unit === "g" ? 0.035274 : 1);
    const time = h.use === "First Wort" ? 20 : Number(h.time) || 0; // first wort gets a fixed effective utilization time
    const bignessFactor = 1.65 * Math.pow(0.000125, gravity - 1);
    const boilTimeFactor = (1 - Math.exp(-0.04 * time)) / 4.15;
    const utilization = bignessFactor * boilTimeFactor;
    const ibu = (aaDecimal * weightOz * 7490 * utilization) / volumeGal;
    return sum + ibu;
  }, 0);
  return totalIBU;
}

function calcFG(og, attenuationPct) {
  if (!og || !attenuationPct) return null;
  return og - (og - 1) * (Number(attenuationPct) / 100);
}

function calcABV(og, fg) {
  if (!og || !fg) return null;
  return (og - fg) * 131.25;
}

// --- Water chemistry ---------------------------------------------------
// ppm contributed per gram of salt dissolved per litre of water, derived
// from each salt's molecular weight and ion content.
const SALT_CONTRIBUTIONS = {
  gypsum: { label: "Gypsum (CaSO4)", ca: 232.8, so4: 558.0 },
  calciumChloride: { label: "Calcium Chloride (CaCl2)", ca: 272.6, cl: 482.3 },
  epsomSalt: { label: "Epsom Salt (MgSO4)", mg: 98.6, so4: 389.8 },
  tableSalt: { label: "Table Salt (NaCl)", na: 393.4, cl: 606.7 },
  bakingSoda: { label: "Baking Soda (NaHCO3)", na: 273.7, hco3: 726.4 },
  chalk: { label: "Chalk (CaCO3)", ca: 400.5, hco3: 733.3 }, // reported as HCO3-equivalent alkalinity; dissolves poorly outside the mash
};

const WATER_PROFILE_PRESETS = {
  "RO / Distilled": { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 },
  "Balanced / Pale Ale": { ca: 75, mg: 5, na: 10, cl: 75, so4: 100, hco3: 50 },
  "Hoppy / IPA": { ca: 100, mg: 5, na: 10, cl: 50, so4: 200, hco3: 25 },
  "Malty / Stout": { ca: 100, mg: 10, na: 15, cl: 100, so4: 50, hco3: 150 },
  "Pilsner": { ca: 40, mg: 5, na: 5, cl: 15, so4: 15, hco3: 25 },
};

function calcResultingWaterProfile(sourceWater, saltGrams, batchVolumeL) {
  const result = { ...(sourceWater || { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 }) };
  if (!batchVolumeL) return result;
  Object.entries(saltGrams || {}).forEach(([saltKey, grams]) => {
    const contrib = SALT_CONTRIBUTIONS[saltKey];
    if (!contrib || !grams) return;
    Object.entries(contrib).forEach(([ion, ppmPerGramPerLitre]) => {
      if (ion === "label") return;
      result[ion] = (result[ion] || 0) + (Number(grams) * ppmPerGramPerLitre) / batchVolumeL;
    });
  });
  return result;
}

// Residual alkalinity — a standard, well-established metric for whether the
// water will push mash pH up (higher RA) or down (lower RA), as CaCO3
// equivalent. This is NOT a mash pH prediction — that also depends on grain
// colour/acidity, which varies too much to estimate reliably here.
function calcResidualAlkalinity(waterProfile) {
  const hco3 = waterProfile.hco3 || 0;
  const ca = waterProfile.ca || 0;
  const mg = waterProfile.mg || 0;
  const alkalinityAsCaCO3 = hco3 * 0.8202; // HCO3 to CaCO3-equivalent
  return alkalinityAsCaCO3 - (ca / 1.4 + mg / 1.7);
}


function formatHistoryStamp(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const hasTime = typeof dateStr === "string" && dateStr.includes("T");
  if (!hasTime) return datePart;
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

// The seed* functions below are no longer used now that data loads from
// Supabase — kept only as a reference for the shape each table's rows take.
function seedBatches() {
  const d0 = new Date();
  const mk = (offset) => {
    const d = new Date(d0);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  return [
    {
      id: uid(),
      number: "24",
      name: "Foghorn Amber",
      style: "American Amber Ale",
      volume: 20,
      og: 1.058,
      fg: 1.012,
      mashPh: 5.3,
      preBoilGravity: 1.041,
      topUpWater: 1.5,
      stage: "Primary",
      startDate: mk(6),
      readings: [
        { id: uid(), date: mk(6), gravity: 1.058, temp: 19, note: "Pitched, brew day" },
        { id: uid(), date: mk(5), gravity: 1.054, temp: 20, note: "" },
        { id: uid(), date: mk(3), gravity: 1.031, temp: 21, note: "Krausen dropping" },
        { id: uid(), date: mk(1), gravity: 1.019, temp: 20, note: "" },
      ],
    },
    {
      id: uid(),
      number: "23",
      name: "Low Tide Saison",
      style: "Farmhouse Saison",
      volume: 18,
      og: 1.052,
      fg: 1.004,
      mashPh: 5.4,
      preBoilGravity: 1.038,
      topUpWater: 2,
      stage: "Conditioning",
      startDate: mk(24),
      readings: [
        { id: uid(), date: mk(24), gravity: 1.052, temp: 22 },
        { id: uid(), date: mk(20), gravity: 1.02, temp: 24 },
        { id: uid(), date: mk(15), gravity: 1.006, temp: 23 },
        { id: uid(), date: mk(10), gravity: 1.004, temp: 20 },
      ],
    },
    {
      id: uid(),
      number: "22",
      name: "Rivet Stout",
      style: "Dry Irish Stout",
      volume: 20,
      og: 1.045,
      fg: 1.011,
      mashPh: 5.5,
      preBoilGravity: null,
      topUpWater: null,
      stage: "Brewing",
      startDate: mk(0),
      readings: [{ id: uid(), date: mk(0), gravity: 1.045, temp: 18, note: "Brew day, pitched yeast" }],
    },
  ];
}
// BJCP 2021 Beer Style Guidelines (current edition) — full style list,
// grouped by category as published at bjcp.org.
const BJCP_STYLES = [
  { category: "1. Standard American Beer", styles: ["1A. American Light Lager", "1B. American Lager", "1C. Cream Ale", "1D. American Wheat Beer"] },
  { category: "2. International Lager", styles: ["2A. International Pale Lager", "2B. International Amber Lager", "2C. International Dark Lager"] },
  { category: "3. Czech Lager", styles: ["3A. Czech Pale Lager", "3B. Czech Premium Pale Lager", "3C. Czech Amber Lager", "3D. Czech Dark Lager"] },
  { category: "4. Pale Malty European Lager", styles: ["4A. Munich Helles", "4B. Festbier", "4C. Helles Bock"] },
  { category: "5. Pale Bitter European Beer", styles: ["5A. German Leichtbier", "5B. Kölsch", "5C. German Helles Exportbier", "5D. German Pils"] },
  { category: "6. Amber Malty European Lager", styles: ["6A. Märzen", "6B. Rauchbier", "6C. Dunkles Bock"] },
  { category: "7. Amber Bitter European Beer", styles: ["7A. Vienna Lager", "7B. Altbier"] },
  { category: "8. Dark European Lager", styles: ["8A. Munich Dunkel", "8B. Schwarzbier"] },
  { category: "9. Strong European Beer", styles: ["9A. Doppelbock", "9B. Eisbock", "9C. Baltic Porter"] },
  { category: "10. German Wheat Beer", styles: ["10A. Weissbier", "10B. Dunkles Weissbier", "10C. Weizenbock"] },
  { category: "11. British Bitter", styles: ["11A. Ordinary Bitter", "11B. Best Bitter", "11C. Strong Bitter"] },
  { category: "12. Pale Commonwealth Beer", styles: ["12A. British Golden Ale", "12B. Australian Sparkling Ale", "12C. English IPA"] },
  { category: "13. Brown British Beer", styles: ["13A. Dark Mild", "13B. British Brown Ale", "13C. English Porter"] },
  { category: "14. Scottish Ale", styles: ["14A. Scottish Light", "14B. Scottish Heavy", "14C. Scottish Export"] },
  { category: "15. Irish Beer", styles: ["15A. Irish Red Ale", "15B. Irish Stout", "15C. Irish Extra Stout"] },
  { category: "16. Dark British Beer", styles: ["16A. Sweet Stout", "16B. Oatmeal Stout", "16C. Tropical Stout", "16D. Foreign Extra Stout"] },
  { category: "17. Strong British Ale", styles: ["17A. British Strong Ale", "17B. Old Ale", "17C. Wee Heavy", "17D. English Barleywine"] },
  { category: "18. Pale American Ale", styles: ["18A. Blonde Ale", "18B. American Pale Ale"] },
  { category: "19. Amber and Brown American Beer", styles: ["19A. American Amber Ale", "19B. California Common", "19C. American Brown Ale"] },
  { category: "20. American Porter and Stout", styles: ["20A. American Porter", "20B. American Stout", "20C. Imperial Stout"] },
  { category: "21. IPA", styles: ["21A. American IPA", "21B. Specialty IPA", "21C. Hazy IPA"] },
  { category: "22. Strong American Ale", styles: ["22A. Double IPA", "22B. American Strong Ale", "22C. American Barleywine", "22D. Wheatwine"] },
  { category: "23. European Sour Ale", styles: ["23A. Berliner Weisse", "23B. Flanders Red Ale", "23C. Oud Bruin", "23D. Lambic", "23E. Gueuze", "23F. Fruit Lambic", "23G. Gose"] },
  { category: "24. Belgian Ale", styles: ["24A. Witbier", "24B. Belgian Pale Ale", "24C. Bière de Garde"] },
  { category: "25. Strong Belgian Ale", styles: ["25A. Belgian Blond Ale", "25B. Saison", "25C. Belgian Golden Strong Ale"] },
  { category: "26. Monastic Ale", styles: ["26A. Belgian Single", "26B. Belgian Dubbel", "26C. Belgian Tripel", "26D. Belgian Dark Strong Ale"] },
  { category: "27. Historical Beer", styles: ["Kellerbier", "Kentucky Common", "Lichtenhainer", "London Brown Ale", "Piwo Grodziskie", "Pre-Prohibition Lager", "Pre-Prohibition Porter", "Roggenbier", "Sahti"] },
  { category: "28. American Wild Ale", styles: ["28A. Brett Beer", "28B. Mixed-Fermentation Sour Beer", "28C. Wild Specialty Beer", "28D. Straight Sour Beer"] },
  { category: "29. Fruit Beer", styles: ["29A. Fruit Beer", "29B. Fruit and Spice Beer", "29C. Specialty Fruit Beer", "29D. Grape Ale"] },
  { category: "30. Spiced Beer", styles: ["30A. Spice, Herb, or Vegetable Beer", "30B. Autumn Seasonal Beer", "30C. Winter Seasonal Beer", "30D. Specialty Spice Beer"] },
  { category: "31. Alternative Fermentables Beer", styles: ["31A. Alternative Grain Beer", "31B. Alternative Sugar Beer"] },
  { category: "32. Smoked Beer", styles: ["32A. Classic Style Smoked Beer", "32B. Specialty Smoked Beer"] },
  { category: "33. Wood Beer", styles: ["33A. Wood-Aged Beer", "33B. Specialty Wood-Aged Beer"] },
  { category: "34. Specialty Beer", styles: ["34A. Commercial Specialty Beer", "34B. Mixed-Style Beer", "34C. Experimental Beer"] },
  { category: "Local Styles", styles: ["X1. Dorada Pampeana", "X2. IPA Argenta", "X3. Italian Grape Ale", "X4. Catharina Sour", "X5. New Zealand Pilsner"] },
];

// Brewers Association 2026 Beer Style Guidelines (current edition,
// updated 12/31/2025) — full style list, grouped as published.
const BA_STYLES = [
  { category: "British Origin Ale Styles", styles: ["Ordinary Bitter", "Special Bitter or Best Bitter", "Extra Special Bitter", "Scottish-Style Light Ale", "Scottish-Style Heavy Ale", "Scottish-Style Export Ale", "English-Style Summer Ale", "Classic English-Style Pale Ale", "British-Style India Pale Ale", "Strong Ale", "Old Ale", "English-Style Pale Mild Ale", "English-Style Dark Mild Ale", "English-Style Brown Ale", "Brown Porter", "Robust Porter", "Sweet Stout or Cream Stout", "Oatmeal Stout", "Scotch Ale or Wee Heavy", "British-Style Imperial Stout", "British-Style Barley Wine Ale"] },
  { category: "Irish Origin Ale Styles", styles: ["Irish-Style Red Ale", "Classic Irish-Style Dry Stout", "Export-Style Stout"] },
  { category: "North American Origin Ale Styles", styles: ["Golden or Blonde Ale", "Session India Pale Ale", "American-Style Amber/Red Ale", "American-Style Pale Ale", "Juicy or Hazy Pale Ale", "American-Style Strong Pale Ale", "Juicy or Hazy Strong Pale Ale", "American-Style India Pale Ale", "West Coast-Style India Pale Ale", "Juicy or Hazy India Pale Ale", "American-Belgo-Style Ale", "American-Style Brown Ale", "American-Style Black Ale", "American-Style Stout", "American-Style Imperial Porter", "American-Style Imperial Stout", "Double Hoppy Red Ale", "Imperial Red Ale", "American-Style Imperial or Double India Pale Ale", "Juicy or Hazy Imperial or Double India Pale Ale", "American-Style Barley Wine Ale", "American-Style Wheat Wine Ale", "Smoke Porter", "American-Style Sour Ale", "American-Style Fruited Sour Ale"] },
  { category: "German Origin Ale Styles", styles: ["German-Style Koelsch", "German-Style Altbier", "Berliner-Style Weisse", "Leipzig-Style Gose", "Contemporary-Style Gose", "South German-Style Hefeweizen", "South German-Style Kristal Weizen", "German-Style Leichtes Weizen", "South German-Style Bernsteinfarbenes Weizen", "South German-Style Dunkel Weizen", "South German-Style Weizenbock", "German-Style Rye Ale", "Bamberg-Style Weiss Rauchbier"] },
  { category: "Belgian and French Origin Ale Styles", styles: ["Belgian-Style Table Beer", "Belgian-Style Session Ale", "Belgian-Style Speciale Belge", "Belgian-Style Blonde Ale", "Belgian-Style Strong Blonde Ale", "Belgian-Style Strong Dark Ale", "Belgian-Style Dubbel", "Belgian-Style Tripel", "Belgian-Style Quadrupel", "Belgian-Style Witbier", "Classic French & Belgian-Style Saison", "Specialty Saison", "French-Style Bière de Garde", "Belgian-Style Flanders Oud Bruin or Oud Red Ale", "Belgian-Style Lambic", "Traditional Belgian-Style Gueuze", "Contemporary Belgian-Style Spontaneous Fermented Ale", "Belgian-Style Fruit Lambic", "Other Belgian-Style Ale"] },
  { category: "Other Origin Ale Styles", styles: ["Grodziskie", "Adambier", "Dutch-Style Kuit, Kuyt or Koyt", "International-Style Pale Ale", "Classic Australian-Style Pale Ale", "Australian-Style Pale Ale", "New Zealand-Style Pale Ale", "New Zealand-Style India Pale Ale", "Finnish-Style Sahti", "Swedish-Style Gotlandsdricke", "Breslau-Style Schoeps"] },
  { category: "European Origin Lager Styles", styles: ["Baltic-Style Porter", "Czech-Style Pale Lager", "Czech-Style Amber Lager", "Czech-Style Dark Lager", "Italian-Style Pilsener", "Vienna-Style Lager", "German-Style Leichtbier", "German-Style Pilsener", "Munich-Style Helles", "Dortmunder/European-Style Export", "Franconian-Style Rotbier", "German-Style Maerzen", "German-Style Oktoberfest/Festbier", "Munich-Style Dunkel", "European-Style Dark Lager", "German-Style Schwarzbier", "Bamberg-Style Helles Rauchbier", "Bamberg-Style Maerzen Rauchbier", "Bamberg-Style Bock Rauchbier", "German-Style Heller Bock/Maibock", "Traditional German-Style Bock", "German-Style Doppelbock", "German-Style Eisbock"] },
  { category: "North American Origin Lager Styles", styles: ["American-Style Lager", "Contemporary American-Style Lager", "American-Style Light Lager", "Contemporary American-Style Light Lager", "American-Style Pilsener", "Contemporary American-Style Pilsener", "American-Style India Pale Lager", "American-Style Malt Liquor", "American-Style Amber Lager", "American-Style Maerzen/Oktoberfest", "American-Style Dark Lager", "Mexican-Style Light Lager", "Mexican-Style Pale Lager", "Mexican-Style Amber Lager", "Mexican-Style Dark Lager"] },
  { category: "Other Origin Lager Styles", styles: ["International Light Lager", "International-Style Pilsener", "Rice Lager"] },
  { category: "Hybrid/Mixed Lagers or Ales", styles: ["Session Beer", "American-Style Cream Ale", "California Common Beer", "Kentucky Common Beer", "American-Style Wheat Beer", "Kellerbier or Zwickelbier", "American-Style Fruit Beer", "Fruit Wheat Beer", "Belgian-Style Fruit Beer", "Field Beer", "Pumpkin Spice Beer", "Pumpkin/Squash Beer", "Chocolate or Cocoa Beer", "Dessert Stout or Pastry Beer", "Coffee Beer", "Chili Pepper Beer", "Herb and Spice Beer", "Specialty Beer", "Specialty Honey Beer", "Rye Beer", "Brett Beer", "Mixed-Culture Brett Beer", "Ginjo Beer or Sake-Yeast Beer", "Fresh Hop Beer", "Wood- and Barrel-Aged Beer", "Wood- and Barrel-Aged Sour Beer", "Aged Beer", "Experimental Beer", "Experimental India Pale Ale", "Historical Beer", "Wild Beer", "Smoke Beer", "Other Strong Ale or Lager", "Gluten-Free Beer", "Non-Alcohol Malt Beverage"] },
];

// Flattened, searchable version of both guides for the style search field.
const ALL_STYLES = [
  ...BJCP_STYLES.flatMap((g) => g.styles.map((s) => ({ name: s, source: "BJCP" }))),
  ...BA_STYLES.flatMap((g) => g.styles.map((s) => ({ name: s, source: "BA" }))),
];

// Reference libraries of common malts, hops, and yeast strains from major
// suppliers worldwide, used to auto-fill the brewing-science fields (potential,
// colour, alpha acid, attenuation) when building a recipe. Figures are typical
// published values for each product — treat them as a solid starting point,
// not an exact spec sheet; edit them if you have the maltster's own numbers.
const MALT_LIBRARY = {
  "Gladfield (NZ)": [
    { name: "Gladfield Pale Malt", potential: 38, colorLovibond: 3 },
    { name: "Gladfield American Ale Malt", potential: 38, colorLovibond: 3 },
    { name: "Gladfield Pilsner Malt", potential: 38, colorLovibond: 1.5 },
    { name: "Gladfield Munich Malt", potential: 37, colorLovibond: 12 },
    { name: "Gladfield Vienna Malt", potential: 37, colorLovibond: 4 },
    { name: "Gladfield Wheat Malt", potential: 38, colorLovibond: 2.5 },
    { name: "Gladfield Rye Malt", potential: 36, colorLovibond: 4 },
    { name: "Gladfield Light Crystal", potential: 36, colorLovibond: 25 },
    { name: "Gladfield Medium Crystal", potential: 35, colorLovibond: 60 },
    { name: "Gladfield Dark Crystal", potential: 34, colorLovibond: 130 },
    { name: "Gladfield Chocolate Malt", potential: 33, colorLovibond: 280 },
    { name: "Gladfield Roasted Barley", potential: 32, colorLovibond: 500 },
    { name: "Gladfield Manuka Smoked Malt", potential: 37, colorLovibond: 3.5 },
    { name: "Gladfield Toffee Malt", potential: 36, colorLovibond: 30 },
    { name: "Gladfield Biscuit Malt", potential: 36, colorLovibond: 25 },
  ],
  "Weyermann (Germany)": [
    { name: "Weyermann Pilsner", potential: 38, colorLovibond: 1.7 },
    { name: "Weyermann Vienna", potential: 37.5, colorLovibond: 3.5 },
    { name: "Weyermann Munich I", potential: 37, colorLovibond: 8 },
    { name: "Weyermann Munich II", potential: 36.5, colorLovibond: 15 },
    { name: "Weyermann Wheat Malt", potential: 38.5, colorLovibond: 2.6 },
    { name: "Weyermann Melanoidin", potential: 36, colorLovibond: 27 },
    { name: "Weyermann CaraHell", potential: 35, colorLovibond: 10 },
    { name: "Weyermann CaraRed", potential: 35, colorLovibond: 20 },
    { name: "Weyermann CaraMunich I", potential: 34, colorLovibond: 45 },
    { name: "Weyermann CaraMunich III", potential: 34, colorLovibond: 65 },
    { name: "Weyermann CaraAroma", potential: 33, colorLovibond: 130 },
    { name: "Weyermann Carafa I", potential: 32, colorLovibond: 320 },
    { name: "Weyermann Carafa II", potential: 32, colorLovibond: 415 },
    { name: "Weyermann Carafa III", potential: 32, colorLovibond: 525 },
    { name: "Weyermann Acidulated Malt", potential: 27, colorLovibond: 3.6 },
  ],
  "Simpsons (UK)": [
    { name: "Simpsons Golden Promise", potential: 38, colorLovibond: 3 },
    { name: "Simpsons Maris Otter Pale Ale", potential: 38, colorLovibond: 3 },
    { name: "Simpsons Best Malt", potential: 37.5, colorLovibond: 2.5 },
    { name: "Simpsons Aromatic Malt", potential: 36, colorLovibond: 20 },
    { name: "Simpsons Golden Naked Oats", potential: 33, colorLovibond: 26 },
    { name: "Simpsons Crystal Medium", potential: 34, colorLovibond: 55 },
    { name: "Simpsons Crystal Dark", potential: 33, colorLovibond: 120 },
    { name: "Simpsons Extra Dark Crystal", potential: 33, colorLovibond: 150 },
    { name: "Simpsons Chocolate Malt", potential: 32, colorLovibond: 450 },
  ],
  "Crisp (UK)": [
    { name: "Crisp Maris Otter", potential: 38, colorLovibond: 3 },
    { name: "Crisp Best Ale Malt", potential: 38, colorLovibond: 3 },
    { name: "Crisp Pale Ale Malt", potential: 38, colorLovibond: 2.5 },
    { name: "Crisp Munich Malt", potential: 37, colorLovibond: 10 },
    { name: "Crisp Wheat Malt", potential: 38, colorLovibond: 2.5 },
    { name: "Crisp Crystal Malt (Medium)", potential: 34, colorLovibond: 60 },
    { name: "Crisp Crystal Rye", potential: 33, colorLovibond: 60 },
    { name: "Crisp Chocolate Malt", potential: 32, colorLovibond: 450 },
    { name: "Crisp Black Malt", potential: 30, colorLovibond: 500 },
  ],
  "Bairds (UK)": [
    { name: "Bairds Pale Ale Malt", potential: 38, colorLovibond: 3 },
    { name: "Bairds Munich Malt", potential: 37, colorLovibond: 10 },
    { name: "Bairds Crystal Malt", potential: 34, colorLovibond: 60 },
    { name: "Bairds Chocolate Malt", potential: 32, colorLovibond: 450 },
    { name: "Bairds Roasted Barley", potential: 32, colorLovibond: 550 },
  ],
  "Briess (USA)": [
    { name: "Briess 2-Row Brewers Malt", potential: 37, colorLovibond: 1.8 },
    { name: "Briess Pale Ale Malt", potential: 37, colorLovibond: 3 },
    { name: "Briess Munich Malt 10L", potential: 37, colorLovibond: 10 },
    { name: "Briess Munich Malt 20L", potential: 36, colorLovibond: 20 },
    { name: "Briess Wheat Malt", potential: 38, colorLovibond: 2.2 },
    { name: "Briess Victory Malt", potential: 35, colorLovibond: 28 },
    { name: "Briess Caramel Malt 10L", potential: 35, colorLovibond: 10 },
    { name: "Briess Caramel Malt 40L", potential: 35, colorLovibond: 40 },
    { name: "Briess Caramel Malt 60L", potential: 34, colorLovibond: 60 },
    { name: "Briess Caramel Malt 90L", potential: 34, colorLovibond: 90 },
    { name: "Briess Caramel Malt 120L", potential: 33, colorLovibond: 120 },
    { name: "Briess Chocolate Malt", potential: 34, colorLovibond: 350 },
    { name: "Briess Black Malt", potential: 32, colorLovibond: 500 },
  ],
  "Rahr (USA)": [
    { name: "Rahr 2-Row Pale", potential: 37, colorLovibond: 1.8 },
    { name: "Rahr Pale Ale Malt", potential: 37, colorLovibond: 3.5 },
    { name: "Rahr Munich 10L", potential: 36, colorLovibond: 10 },
    { name: "Rahr Munich 20L", potential: 36, colorLovibond: 20 },
    { name: "Rahr Crystal 15L", potential: 35, colorLovibond: 15 },
    { name: "Rahr Crystal 40L", potential: 35, colorLovibond: 40 },
    { name: "Rahr Crystal 60L", potential: 34, colorLovibond: 60 },
    { name: "Rahr Chocolate Malt", potential: 34, colorLovibond: 350 },
  ],
  "Dingemans (Belgium)": [
    { name: "Dingemans Pilsner", potential: 38, colorLovibond: 1.8 },
    { name: "Dingemans Pale Ale", potential: 38, colorLovibond: 3.5 },
    { name: "Dingemans Munich", potential: 37, colorLovibond: 10 },
    { name: "Dingemans Biscuit", potential: 36, colorLovibond: 23 },
    { name: "Dingemans Aromatic", potential: 36, colorLovibond: 20 },
    { name: "Dingemans CaraMunich", potential: 34, colorLovibond: 60 },
    { name: "Dingemans Special B", potential: 33, colorLovibond: 150 },
    { name: "Dingemans Chocolate", potential: 32, colorLovibond: 350 },
  ],
  "Castle Malting (Belgium)": [
    { name: "Castle Pilsen", potential: 38, colorLovibond: 1.8 },
    { name: "Castle Munich", potential: 37, colorLovibond: 10 },
    { name: "Castle CaraMunich", potential: 34, colorLovibond: 60 },
    { name: "Castle Special B", potential: 33, colorLovibond: 150 },
    { name: "Castle Chocolate", potential: 32, colorLovibond: 350 },
  ],
  "Viking Malt (Nordic)": [
    { name: "Viking Pilsner Malt", potential: 38, colorLovibond: 1.8 },
    { name: "Viking Pale Ale Malt", potential: 37.5, colorLovibond: 3 },
    { name: "Viking Munich Malt", potential: 37, colorLovibond: 10 },
    { name: "Viking Caramel 60", potential: 34, colorLovibond: 60 },
  ],
  "Joe White Maltings (Australia)": [
    { name: "JW Traditional Ale Malt", potential: 38, colorLovibond: 3 },
    { name: "JW Pilsner Malt", potential: 38, colorLovibond: 1.8 },
    { name: "JW Munich Malt", potential: 37, colorLovibond: 10 },
    { name: "JW Wheat Malt", potential: 38, colorLovibond: 2.3 },
    { name: "JW Caramalt", potential: 35, colorLovibond: 25 },
    { name: "JW Chocolate Malt", potential: 33, colorLovibond: 300 },
  ],
};

const HOP_LIBRARY = {
  "USA": [
    { name: "Cascade", alphaAcid: 6 },
    { name: "Centennial", alphaAcid: 10 },
    { name: "Citra", alphaAcid: 12.5 },
    { name: "Simcoe", alphaAcid: 13 },
    { name: "Mosaic", alphaAcid: 11.5 },
    { name: "Amarillo", alphaAcid: 9 },
    { name: "Chinook", alphaAcid: 13 },
    { name: "Columbus / CTZ", alphaAcid: 15 },
    { name: "Willamette", alphaAcid: 5 },
    { name: "Nugget", alphaAcid: 13 },
    { name: "Cluster", alphaAcid: 7 },
    { name: "Magnum (US)", alphaAcid: 13.5 },
    { name: "Idaho 7", alphaAcid: 12 },
    { name: "El Dorado", alphaAcid: 15 },
    { name: "Azacca", alphaAcid: 14 },
    { name: "Cashmere", alphaAcid: 9 },
  ],
  "New Zealand": [
    { name: "Nelson Sauvin", alphaAcid: 12 },
    { name: "Motueka", alphaAcid: 7 },
    { name: "Riwaka", alphaAcid: 6.5 },
    { name: "Wakatu", alphaAcid: 7 },
    { name: "Rakau", alphaAcid: 10.5 },
    { name: "Waimea", alphaAcid: 16 },
    { name: "Kohatu", alphaAcid: 6.5 },
    { name: "Taiheke", alphaAcid: 6.5 },
    { name: "Dr Rudi", alphaAcid: 11 },
  ],
  "Germany": [
    { name: "Hallertau Mittelfrüh", alphaAcid: 4 },
    { name: "Hallertau Blanc", alphaAcid: 9.5 },
    { name: "Tettnang", alphaAcid: 4.5 },
    { name: "Perle (German)", alphaAcid: 7.5 },
    { name: "Magnum (German)", alphaAcid: 13 },
    { name: "Saphir", alphaAcid: 4 },
    { name: "Mandarina Bavaria", alphaAcid: 8 },
    { name: "Herkules", alphaAcid: 15 },
    { name: "Huell Melon", alphaAcid: 7 },
  ],
  "UK": [
    { name: "East Kent Goldings", alphaAcid: 5 },
    { name: "Fuggle", alphaAcid: 4.5 },
    { name: "Target", alphaAcid: 10.5 },
    { name: "Challenger", alphaAcid: 7.5 },
    { name: "First Gold", alphaAcid: 8 },
    { name: "Bramling Cross", alphaAcid: 5.5 },
    { name: "Pilgrim", alphaAcid: 9.5 },
  ],
  "Australia": [
    { name: "Galaxy", alphaAcid: 14 },
    { name: "Vic Secret", alphaAcid: 15.5 },
    { name: "Ella (Stella)", alphaAcid: 14.5 },
    { name: "Enigma", alphaAcid: 14 },
    { name: "Topaz", alphaAcid: 16 },
  ],
  "Czech Republic": [{ name: "Saaz", alphaAcid: 3.5 }],
  "Slovenia": [
    { name: "Styrian Goldings", alphaAcid: 5.5 },
    { name: "Celeia", alphaAcid: 4.5 },
  ],
};

const YEAST_LIBRARY = {
  "Fermentis (Belgium, dry)": [
    { name: "Fermentis SafAle US-05", attenuation: 78 },
    { name: "Fermentis SafAle S-04", attenuation: 75 },
    { name: "Fermentis SafAle K-97", attenuation: 78 },
    { name: "Fermentis SafAle T-58", attenuation: 78 },
    { name: "Fermentis SafAle WB-06", attenuation: 82 },
    { name: "Fermentis SafAle BE-134", attenuation: 86 },
    { name: "Fermentis SafLager W-34/70", attenuation: 82 },
    { name: "Fermentis SafLager S-23", attenuation: 82 },
  ],
  "Lallemand (Canada, dry)": [
    { name: "Lallemand Verdant IPA", attenuation: 80 },
    { name: "Lallemand London ESB", attenuation: 73 },
    { name: "Lallemand Nottingham", attenuation: 80 },
    { name: "Lallemand Windsor", attenuation: 70 },
    { name: "Lallemand BRY-97", attenuation: 78 },
    { name: "Lallemand Diamond Lager", attenuation: 82 },
    { name: "Lallemand New England", attenuation: 78 },
    { name: "Lallemand Munich Classic", attenuation: 75 },
    { name: "Lallemand Farmhouse", attenuation: 82 },
    { name: "Lallemand Belle Saison", attenuation: 85 },
  ],
  "Mangrove Jack's (NZ, dry)": [
    { name: "Mangrove Jack's M02 California Lager", attenuation: 78 },
    { name: "Mangrove Jack's M15 Empire Ale", attenuation: 75 },
    { name: "Mangrove Jack's M20 Bavarian Wheat", attenuation: 78 },
    { name: "Mangrove Jack's M21 Belgian Wit", attenuation: 78 },
    { name: "Mangrove Jack's M27 Belgian Ale", attenuation: 78 },
    { name: "Mangrove Jack's M29 French Saison", attenuation: 85 },
    { name: "Mangrove Jack's M31 Belgian Tripel", attenuation: 82 },
    { name: "Mangrove Jack's M36 Liberty Bell Ale", attenuation: 78 },
    { name: "Mangrove Jack's M42 New World Strong Ale", attenuation: 78 },
    { name: "Mangrove Jack's M44 US West Coast", attenuation: 78 },
    { name: "Mangrove Jack's M54 Californian Lager", attenuation: 78 },
  ],
  "Wyeast (USA, liquid)": [
    { name: "Wyeast 1056 American Ale", attenuation: 75 },
    { name: "Wyeast 1084 Irish Ale", attenuation: 73 },
    { name: "Wyeast 1098 British Ale", attenuation: 75 },
    { name: "Wyeast 1187 Ringwood Ale", attenuation: 78 },
    { name: "Wyeast 1214 Belgian Abbey", attenuation: 78 },
    { name: "Wyeast 1272 American Ale II", attenuation: 74 },
    { name: "Wyeast 1318 London Ale III", attenuation: 71 },
    { name: "Wyeast 1332 Northwest Ale", attenuation: 72 },
    { name: "Wyeast 1450 Denny's Favorite", attenuation: 74 },
    { name: "Wyeast 1469 West Yorkshire", attenuation: 70 },
    { name: "Wyeast 1728 Scottish Ale", attenuation: 71 },
    { name: "Wyeast 1762 Belgian Abbey II", attenuation: 76 },
    { name: "Wyeast 2007 Pilsen Lager", attenuation: 74 },
    { name: "Wyeast 2124 Bohemian Lager", attenuation: 73 },
    { name: "Wyeast 2206 Bavarian Lager", attenuation: 74 },
    { name: "Wyeast 3068 Weihenstephan Wheat", attenuation: 75 },
    { name: "Wyeast 3711 French Saison", attenuation: 85 },
    { name: "Wyeast 3724 Belgian Saison", attenuation: 80 },
    { name: "Wyeast 3787 Trappist High Gravity", attenuation: 78 },
  ],
  "White Labs (USA, liquid)": [
    { name: "WLP001 California Ale", attenuation: 76 },
    { name: "WLP002 English Ale", attenuation: 68 },
    { name: "WLP004 Irish Ale", attenuation: 71 },
    { name: "WLP007 Dry English Ale", attenuation: 78 },
    { name: "WLP008 East Coast Ale", attenuation: 75 },
    { name: "WLP029 German Ale / Kölsch", attenuation: 74 },
    { name: "WLP036 Dusseldorf Alt", attenuation: 73 },
    { name: "WLP300 Hefeweizen Ale", attenuation: 74 },
    { name: "WLP500 Trappist Ale", attenuation: 80 },
    { name: "WLP530 Abbey Ale", attenuation: 76 },
    { name: "WLP565 Belgian Saison I", attenuation: 76 },
    { name: "WLP775 English Fuller's", attenuation: 73 },
    { name: "WLP800 Pilsner Lager", attenuation: 74 },
    { name: "WLP830 German Lager", attenuation: 74 },
    { name: "WLP833 German Bock Lager", attenuation: 73 },
  ],
  "Imperial Yeast (USA, liquid)": [
    { name: "Imperial A07 Flagship", attenuation: 74 },
    { name: "Imperial A38 Juice", attenuation: 75 },
    { name: "Imperial B32 Dry Hop", attenuation: 78 },
    { name: "Imperial L17 Harvest", attenuation: 82 },
  ],
};

const MALT_LIBRARY_FLAT = Object.entries(MALT_LIBRARY).flatMap(([company, items]) => items.map((i) => ({ ...i, company })));
const HOP_LIBRARY_FLAT = Object.entries(HOP_LIBRARY).flatMap(([region, items]) => items.map((i) => ({ ...i, company: region })));
const YEAST_LIBRARY_FLAT = Object.entries(YEAST_LIBRARY).flatMap(([company, items]) => items.map((i) => ({ ...i, company })));

// Parses a BeerXML file (the open interchange format exported by Brewfather,
// BeerSmith, and most other brewing software) into the shape this app's
// recipe form expects. Returns null if the file doesn't look like BeerXML.
// BeerXML amounts for fermentables/hops/misc are always in kilograms.
function buildScheduleLabel(use, time, name) {
  if (use === "Dry Hop") return `Dry hop — day ${time ?? "?"}: add ${name}`;
  if (use === "Boil") return `Boil, ${time ?? "?"} min remaining: add ${name}`;
  if (use === "Mash") return time != null && time !== "" ? `Mash, ${time} min: add ${name}` : `Mash: add ${name}`;
  if (use === "First Wort") return `First wort: add ${name}`;
  return `${use || "Add"}${time != null && time !== "" ? `, ${time} min` : ""}: add ${name}`;
}

function parseBeerXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const recipeEl = doc.getElementsByTagName("RECIPE")[0];
  if (!recipeEl) return null;

  const text = (parent, tag) => {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : "";
  };
  const num = (parent, tag) => {
    const t = text(parent, tag);
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };

  const name = text(recipeEl, "NAME") || "Imported recipe";
  const styleEl = recipeEl.getElementsByTagName("STYLE")[0];
  const style = styleEl ? text(styleEl, "NAME") : "";
  const volume = num(recipeEl, "BATCH_SIZE") ?? 20;
  const og = num(recipeEl, "OG") ?? 1.05;
  const fg = num(recipeEl, "FG") ?? 1.01;

  const ingredients = [];
  const collect = (containerTag, itemTag, category, unit, qtyFn) => {
    const container = recipeEl.getElementsByTagName(containerTag)[0];
    if (!container) return;
    Array.from(container.getElementsByTagName(itemTag)).forEach((el) => {
      ingredients.push({
        id: uid(),
        name: text(el, "NAME") || itemTag,
        category,
        qty: qtyFn(el),
        unit,
      });
    });
  };

  collect("FERMENTABLES", "FERMENTABLE", "Grain", "kg", (el) => num(el, "AMOUNT") ?? 0);
  collect("HOPS", "HOP", "Hops", "kg", (el) => num(el, "AMOUNT") ?? 0);
  collect("YEASTS", "YEAST", "Yeast", "ea", () => 1);
  collect("MISCS", "MISC", "Other", "kg", (el) => num(el, "AMOUNT") ?? 0);

  // Build a brew-day addition schedule from anything with USE/TIME info
  // (mainly hops, sometimes misc items like Irish Moss). BeerXML gives TIME
  // in minutes for Boil/Mash/First Wort/Aroma, and in days for Dry Hop.
  const schedule = [];
  const collectSchedule = (containerTag, itemTag, unit, qtyFn) => {
    const container = recipeEl.getElementsByTagName(containerTag)[0];
    if (!container) return;
    Array.from(container.getElementsByTagName(itemTag)).forEach((el) => {
      const use = text(el, "USE");
      const time = num(el, "TIME");
      if (!use && time == null) return;
      const itemName = text(el, "NAME") || itemTag;
      const amount = qtyFn(el);
      const label = buildScheduleLabel(use, time, itemName);
      schedule.push({
        id: uid(),
        label,
        name: itemName,
        amount,
        unit,
        use: use || "",
        time,
        sortKey: use === "Dry Hop" ? 10000 + (time ?? 0) : 1000 - (time ?? 0),
      });
    });
  };
  collectSchedule("HOPS", "HOP", "kg", (el) => num(el, "AMOUNT") ?? 0);
  collectSchedule("MISCS", "MISC", "kg", (el) => num(el, "AMOUNT") ?? 0);
  schedule.sort((a, b) => a.sortKey - b.sortKey);
  schedule.forEach((s) => delete s.sortKey);

  return { name, style, volume, og, fg, ingredients, schedule };
}

// Checklist items drawn from the actual MPI National Programme 3 (Dec 2025)
// guidance — the "Do" requirements for the cards relevant to a brewery.
const FOOD_SAFETY_CHECKLISTS = {
  daily: {
    label: "Daily — cleaning & hygiene",
    frequency: "daily",
    items: [
      "Food contact surfaces and equipment cleaned",
      "Equipment sanitised after cleaning",
      "Cleaning equipment (brooms, mops, cloths) clean and in good condition",
      "Rubbish removed and bins/rubbish areas clean",
      "Handwashing station stocked (soap, paper towels/dryer)",
      "All staff wearing clean clothing/aprons before handling ingredients or product",
      "No staff working while sick (vomiting, diarrhoea, jaundice in last 48 hrs)",
      "Any cuts or sores fully covered",
    ],
  },
  weekly: {
    label: "Weekly — pests & storage",
    frequency: "weekly",
    items: [
      "Checked for signs of pests (droppings, dead insects, damage, full traps)",
      "Pest traps checked and reset if needed",
      "Any pest activity found has been actioned (cleaned, affected stock disposed of)",
      "Storage areas clean and tidy",
      "Cleaning chemicals and maintenance compounds stored away from ingredients/product",
      "Stock rotation checked — nothing past its use-by/best-before date",
    ],
  },
  monthly: {
    label: "Monthly — maintenance & self-check",
    frequency: "monthly",
    items: [
      "Premises checked for deterioration (cracks, holes, leaks) and fixed as needed",
      "Equipment serviced and in good working order",
      "pH meters and thermometers calibrated and up to date",
      "Staff training records reviewed and up to date",
      "Reviewed that procedures are being followed and are effective",
      "Reviewed any incidents ('something went wrong') and confirmed corrective action taken",
    ],
  },
};

// Xero OAuth — Client ID is safe to expose in the browser (it's public by
// design in OAuth2), the Client Secret never leaves the Edge Function.
const XERO_CLIENT_ID = "83E79CF2CB94484C97FD75D0E103C070";
const XERO_REDIRECT_URI = "https://breworx.vercel.app/xero-callback";
const XERO_SCOPES = "offline_access accounting.invoices accounting.contacts accounting.settings.read";

function buildXeroAuthUrl(companyId) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state: companyId,
  });
  return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
}

const TRAINING_TOPICS = [
  "Hand washing & personal hygiene",
  "Cleaning and sanitising",
  "Sourcing, receiving and tracing food",
  "Fermentation / pH monitoring to keep product safe",
  "Allergen awareness",
  "Taking action when something goes wrong",
  "Recall procedure",
  "Other",
];

const CATEGORIES = ["Grain", "Hops", "Yeast", "Other"];

const CATEGORY_COLOR = {
  Grain: "#5C9A3C",
  Hops: "#D9A441",
  Yeast: "#B8925A",
  Other: "#9BA88A",
  Can: "#5C9A3C",
  Bottle: "#D9A441",
  Lid: "#B8925A",
  Label: "#D4A24C",
  Box: "#8A6A3D",
  Carton: "#9BA88A",
};

const CONSUMABLE_CATEGORIES = ["Can", "Bottle", "Lid", "Label", "Box", "Carton", "Other"];

const STEP_FOR_UNIT = { kg: 0.5, g: 50, L: 1, ea: 1 };

function seedInventory() {
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

function seedPurchaseOrders() {
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

function seedRecipes() {
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

function attenuation(og, fg, current) {
  if (og === fg) return 0;
  const pct = ((og - current) / (og - fg)) * 100;
  return Math.min(100, Math.max(0, pct));
}

function latestReading(batch) {
  return batch.readings[batch.readings.length - 1];
}

function Tank({ batch }) {
  const latest = latestReading(batch);
  const pct = attenuation(batch.og, batch.fg, latest.gravity);
  const color = STAGE_COLOR[batch.stage];
  return (
    <div style={{ width: 46, height: 88, position: "relative", flexShrink: 0 }}>
      <svg width="46" height="88" viewBox="0 0 46 88">
        <defs>
          <clipPath id={`clip-${batch.id}`}>
            <path d="M6 6 H40 V52 L23 84 L6 52 Z" />
          </clipPath>
        </defs>
        <path
          d="M6 6 H40 V52 L23 84 L6 52 Z"
          fill="none"
          stroke="#C9D1AC"
          strokeWidth="2"
        />
        <g clipPath={`url(#clip-${batch.id})`}>
          <rect
            x="0"
            y={84 - (78 * pct) / 100}
            width="46"
            height="88"
            fill={color}
            opacity="0.85"
          />
        </g>
      </svg>
    </div>
  );
}

function StagePill({ stage }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: STAGE_COLOR[stage],
        border: `1px solid ${STAGE_COLOR[stage]}`,
        borderRadius: 3,
        padding: "3px 7px",
        display: "inline-block",
      }}
    >
      {stage}
    </span>
  );
}

function BatchCard({ batch, onOpen }) {
  const latest = latestReading(batch);
  const pct = attenuation(batch.og, batch.fg, latest.gravity);
  const days = daysBetween(batch.startDate, today());
  return (
    <button
      onClick={() => onOpen(batch.id)}
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "16px 18px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <Tank batch={batch} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                color: "#9BA88A",
                fontSize: 13,
              }}
            >
              #{batch.number}
            </span>
            <h3
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 18,
                color: "#2A3324",
                margin: 0,
                textOverflow: "ellipsis",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {batch.name}
            </h3>
          </div>
          <StagePill stage={batch.stage} />
        </div>
        <div style={{ color: "#5C6B54", fontSize: 13, marginTop: 2 }}>
          {batch.style}{batchTankSummary(batch) ? ` · ${batchTankSummary(batch)}` : ""}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#5C6B54" }}>
          <span>SG {latest.gravity.toFixed(3)}</span>
          <span>{latest.temp}°C</span>
          <span>{days}d</span>
          <span style={{ color: STAGE_COLOR[batch.stage] }}>{pct.toFixed(0)}% attn</span>
        </div>
        {batch.packaging && (() => {
          const totals = aggregatePackagingCounts(batch);
          const rem = remainingVolume(batch);
          const pctPackaged = Math.min(100, Math.round((totalPackagedVolume(batch) / batch.volume) * 100));
          const parts = CONTAINERS.filter((c) => totals[c.key] > 0).map((c) => `${totals[c.key]}× ${c.shortLabel}`);
          if (rem > 0) parts.push(`${rem}L in tank`);
          return (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 5, background: "#DDE0C8", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pctPackaged}%`,
                    background: rem > 0 ? "#D4A24C" : "#D9A441",
                    borderRadius: 3,
                  }}
                />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#9BA88A", marginTop: 5 }}>
                {pctPackaged}% packaged{parts.length > 0 ? " · " : ""}
                {parts.join(" · ")}
              </div>
            </div>
          );
        })()}
      </div>
    </button>
  );
}

function InventoryItemCard({ item, onAdjust, onOpen, suppliers }) {
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
  const supplierName = item.supplierId ? suppliers.find((s) => s.id === item.supplierId)?.name : null;
    return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "#FFFFFF",
        border: `1px solid ${low ? "#E3D3A0" : "#DDE0C8"}`,
        borderRadius: 6,
        padding: "13px 16px",
      }}
    >
      <button
        onClick={() => onOpen(item.id)}
        style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 16,
              color: "#2A3324",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.name}
          </h3>
          {low && <AlertTriangle size={13} color="#5C9A3C" />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: CATEGORY_COLOR[item.category],
            }}
          >
            {item.category}
          </span>
          {item.lots && item.lots.length > 0 && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A" }}>
              · lot {item.lots[item.lots.length - 1].lotNumber}
              {item.lots.length > 1 ? ` (+${item.lots.length - 1})` : ""}
            </span>
          )}
          {supplierName && (
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A" }}>
              · {supplierName}
            </span>
          )}
        </div>
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => onAdjust(item.id, -step)}
          aria-label={`Remove ${step} ${item.unit} of ${item.name}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: "#EBE8D6",
            border: "1px solid #C9D1AC",
            color: "#2A3324",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Minus size={14} />
        </button>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
            color: low ? "#5C9A3C" : "#2A3324",
            width: 68,
            textAlign: "center",
          }}
        >
          {formatQty(item.qty, item.unit)}
        </span>
        <button
          onClick={() => onAdjust(item.id, step)}
          aria-label={`Add ${step} ${item.unit} of ${item.name}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: "#EBE8D6",
            border: "1px solid #C9D1AC",
            color: "#2A3324",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function FoodSafetyChecklistModal({ template, onClose, onSave }) {
  const [checked, setChecked] = useState(() => template.items.map(() => false));
  const [notes, setNotes] = useState("");

  const toggle = (i) => setChecked((prev) => prev.map((c, idx) => (idx === i ? !c : c)));
  const allChecked = checked.every(Boolean);

  const submit = () => {
    onSave({
      category: "checklist",
      frequency: template.frequency,
      date: today(),
      items: template.items.map((label, i) => ({ label, checked: checked[i] })),
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <Modal title={template.label} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {template.items.map((label, i) => (
            <button
              key={i}
              onClick={() => toggle(i)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: `1.5px solid ${checked[i] ? "#D9A441" : "#C9D1AC"}`,
                  background: checked[i] ? "#D9A441" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {checked[i] && <CheckCircle2 size={13} color="#16191A" />}
              </div>
              <span style={{ color: "#2A3324" }}>{label}</span>
            </button>
          ))}
        </div>
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          style={{
            background: allChecked ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: allChecked ? "#16191A" : "#5C9A3C",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          {allChecked ? "Complete checklist" : "Save (some items unchecked)"}
        </button>
      </div>
    </Modal>
  );
}

function CalibrationModal({ onClose, onSave }) {
  const [equipmentName, setEquipmentName] = useState("");
  const [date, setDate] = useState(today());
  const [result, setResult] = useState("");
  const [dueDate, setDueDate] = useState("");

  const submit = () => {
    if (!equipmentName.trim()) return;
    onSave({
      category: "calibration",
      date,
      equipmentName: equipmentName.trim(),
      result: result.trim(),
      dueDate: dueDate || null,
    });
    onClose();
  };

  return (
    <Modal title="Log calibration" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Equipment (e.g. pH meter, probe thermometer)" value={equipmentName} onChange={setEquipmentName} />
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <TextField label="Result (e.g. Pass — reads 7.01 in pH7 buffer)" value={result} onChange={setResult} />
        <TextField label="Next calibration due (optional)" type="date" value={dueDate} onChange={setDueDate} />
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save calibration record
        </button>
      </div>
    </Modal>
  );
}

function TrainingModal({ onClose, onSave, existingRecords }) {
  const [staffName, setStaffName] = useState("");
  const [staffFocused, setStaffFocused] = useState(false);
  const [trainedBy, setTrainedBy] = useState("");
  const [date, setDate] = useState(today());
  const [checkedTopics, setCheckedTopics] = useState(() => new Set());
  const [staffConfirmed, setStaffConfirmed] = useState(false);

  const knownStaff = [...new Set(existingRecords.filter((r) => r.category === "training" && r.staffName).map((r) => r.staffName))];
  const staffMatches = staffName.trim().length === 0 ? knownStaff : knownStaff.filter((n) => n.toLowerCase().includes(staffName.trim().toLowerCase()));

  const alreadyDoneTopics = new Set(
    existingRecords.filter((r) => r.category === "training" && r.staffName === staffName.trim()).map((r) => r.topic)
  );

  const toggleTopic = (topic) =>
    setCheckedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });

  const submit = async () => {
    if (!staffName.trim() || checkedTopics.size === 0 || !staffConfirmed) return;
    for (const topic of checkedTopics) {
      await onSave({ category: "training", date, staffName: staffName.trim(), topic, trainedBy: trainedBy.trim(), staffConfirmed });
    }
    onClose();
  };

  return (
    <Modal title="Log staff training" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ position: "relative" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Staff member</span>
            <input
              type="text"
              value={staffName}
              onChange={(e) => {
                setStaffName(e.target.value);
                setCheckedTopics(new Set());
              }}
              onFocus={() => setStaffFocused(true)}
              onBlur={() => setTimeout(() => setStaffFocused(false), 150)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            />
          </label>
          {staffFocused && staffMatches.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: 4,
                maxHeight: 160,
                overflowY: "auto",
                background: "#F8F5EA",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                zIndex: 20,
              }}
            >
              {staffMatches.map((n) => (
                <button
                  key={n}
                  onMouseDown={() => {
                    setStaffName(n);
                    setStaffFocused(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
        <TextField label="Trained by" value={trainedBy} onChange={setTrainedBy} />
        <TextField label="Date" type="date" value={date} onChange={setDate} />

        <div>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
            Tick every topic completed today
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TRAINING_TOPICS.map((topic) => {
              const done = alreadyDoneTopics.has(topic);
              const checked = checkedTopics.has(topic);
              return (
                <button
                  key={topic}
                  onClick={() => toggleTopic(topic)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: "#F8F5EA",
                    border: "1px solid #EBE8D6",
                    borderRadius: 5,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `1.5px solid ${checked ? "#D9A441" : "#C9D1AC"}`,
                      background: checked ? "#D9A441" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {checked && <CheckCircle2 size={13} color="#16191A" />}
                  </div>
                  <span style={{ color: "#2A3324", flex: 1 }}>{topic}</span>
                  {done && !checked && (
                    <span style={{ color: "#9BA88A", fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" }}>done before</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={() => setStaffConfirmed(!staffConfirmed)}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 6,
            padding: "12px",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: `1.5px solid ${staffConfirmed ? "#D9A441" : "#C9D1AC"}`,
              background: staffConfirmed ? "#D9A441" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            {staffConfirmed && <CheckCircle2 size={14} color="#16191A" />}
          </div>
          <span style={{ color: "#2A3324", fontSize: 13, lineHeight: 1.5 }}>
            {staffName.trim() || "The staff member"} confirms they understand and completed this training — ticked
            in place of a signature.
          </span>
        </button>

        <button
          onClick={submit}
          disabled={!staffName.trim() || checkedTopics.size === 0 || !staffConfirmed}
          style={{
            background: staffName.trim() && checkedTopics.size > 0 && staffConfirmed ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: staffName.trim() && checkedTopics.size > 0 && staffConfirmed ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: staffName.trim() && checkedTopics.size > 0 && staffConfirmed ? "pointer" : "default",
          }}
        >
          Save {checkedTopics.size > 0 ? `${checkedTopics.size} training record${checkedTopics.size !== 1 ? "s" : ""}` : "training record"}
        </button>
      </div>
    </Modal>
  );
}

const ILLNESS_SYMPTOMS = [
  "Vomiting",
  "Diarrhoea",
  "Jaundice (yellowing of skin/eyes)",
  "Fever",
  "Sore throat with fever",
  "Infected wound, boil, or cut with pus",
];
const ILLNESS_STATUS_OPTIONS = ["Excluded from food handling", "Restricted duties", "Monitoring", "Cleared to return"];

function StaffIllnessModal({ onClose, onSave, existingRecords }) {
  const [staffName, setStaffName] = useState("");
  const [staffFocused, setStaffFocused] = useState(false);
  const [date, setDate] = useState(today());
  const [checkedSymptoms, setCheckedSymptoms] = useState(() => new Set());
  const [status, setStatus] = useState(ILLNESS_STATUS_OPTIONS[0]);
  const [returnDate, setReturnDate] = useState("");
  const [notes, setNotes] = useState("");

  const knownStaff = [...new Set(existingRecords.filter((r) => r.staffName).map((r) => r.staffName))];
  const staffMatches = staffName.trim().length === 0 ? knownStaff : knownStaff.filter((n) => n.toLowerCase().includes(staffName.trim().toLowerCase()));

  const toggleSymptom = (symptom) =>
    setCheckedSymptoms((prev) => {
      const next = new Set(prev);
      if (next.has(symptom)) next.delete(symptom);
      else next.add(symptom);
      return next;
    });

  const submit = () => {
    if (!staffName.trim() || checkedSymptoms.size === 0) return;
    onSave({
      category: "illness",
      date,
      staffName: staffName.trim(),
      items: ILLNESS_SYMPTOMS.map((label) => ({ label, checked: checkedSymptoms.has(label) })),
      result: status,
      dueDate: returnDate || null,
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <Modal title="Log staff sickness" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px", lineHeight: 1.5 }}>
          Standard food-safety exclusion symptoms are vomiting, diarrhoea, jaundice, fever, sore throat with fever, and infected wounds. General guidance is to keep staff off food handling duties for at least 48 hours symptom-free, or until a medical clearance is given — check current MPI/NP3 guidance for specifics.
        </div>

        <div style={{ position: "relative" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Staff member</span>
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              onFocus={() => setStaffFocused(true)}
              onBlur={() => setTimeout(() => setStaffFocused(false), 150)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            />
          </label>
          {staffFocused && staffMatches.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "#FFFFFF",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                marginTop: 2,
                zIndex: 5,
                maxHeight: 140,
                overflowY: "auto",
              }}
            >
              {staffMatches.map((n) => (
                <button
                  key={n}
                  onClick={() => setStaffName(n)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 10px", fontSize: 13, color: "#2A3324", cursor: "pointer" }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Date symptoms started / reported</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
        </label>

        <div>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", display: "block", marginBottom: 8 }}>Symptoms</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ILLNESS_SYMPTOMS.map((symptom) => {
              const checked = checkedSymptoms.has(symptom);
              return (
                <button
                  key={symptom}
                  onClick={() => toggleSymptom(symptom)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: checked ? "#FBE5DC" : "#F8F5EA",
                    border: `1px solid ${checked ? "#E3B3A0" : "#EBE8D6"}`,
                    borderRadius: 5,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `1.5px solid ${checked ? "#B5502F" : "#C9D1AC"}`,
                      background: checked ? "#B5502F" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {checked && <CheckCircle2 size={13} color="#FFFFFF" />}
                  </div>
                  <span style={{ color: "#2A3324" }}>{symptom}</span>
                </button>
              );
            })}
          </div>
        </div>

        <SelectField label="Status / action taken" value={status} onChange={setStatus} options={ILLNESS_STATUS_OPTIONS} />

        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Cleared to return (optional)</span>
          <input
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
        </label>

        <TextField label="Notes (e.g. medical clearance details)" value={notes} onChange={setNotes} />

        <button
          onClick={submit}
          disabled={!staffName.trim() || checkedSymptoms.size === 0}
          style={{
            background: staffName.trim() && checkedSymptoms.size > 0 ? "#B5502F" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: staffName.trim() && checkedSymptoms.size > 0 ? "#FFFFFF" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: staffName.trim() && checkedSymptoms.size > 0 ? "pointer" : "default",
          }}
        >
          Save sickness record
        </button>
      </div>
    </Modal>
  );
}

function FoodSafetyNoteModal({ category, title, onClose, onSave }) {
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");

  const submit = () => {
    onSave({ category, date, notes: notes.trim() });
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <TextField label="Notes" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save record
        </button>
      </div>
    </Modal>
  );
}

function SupplierFormModal({ supplier, onClose, onSave }) {
  const [name, setName] = useState(supplier ? supplier.name : "");
  const [contactName, setContactName] = useState(supplier ? supplier.contactName || "" : "");
  const [phone, setPhone] = useState(supplier ? supplier.phone || "" : "");
  const [email, setEmail] = useState(supplier ? supplier.email || "" : "");
  const [address, setAddress] = useState(supplier ? supplier.address || "" : "");
  const [leadTimeDays, setLeadTimeDays] = useState(supplier?.leadTimeDays ?? "");
  const [notes, setNotes] = useState(supplier ? supplier.notes || "" : "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      contactName: contactName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      leadTimeDays: leadTimeDays === "" ? null : Number(leadTimeDays),
      notes: notes.trim(),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={supplier ? "Edit supplier" : "New supplier"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Supplier name" value={name} onChange={setName} />
        <TextField label="Contact name (optional)" value={contactName} onChange={setContactName} />
        <TextField label="Phone (optional)" value={phone} onChange={setPhone} />
        <TextField label="Email (optional)" value={email} onChange={setEmail} />
        <TextField label="Address (optional)" value={address} onChange={setAddress} />
        <NumberField label="Usual lead time (days, optional)" value={leadTimeDays} onChange={setLeadTimeDays} step="1" suffix="days" />
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={saving}
          style={{
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
        </button>
      </div>
    </Modal>
  );
}

const CUSTOMER_TYPES = ["Wholesale", "Taproom", "Direct-to-consumer"];

function CustomerFormModal({ customer, onClose, onSave }) {
  const [name, setName] = useState(customer ? customer.name : "");
  const [type, setType] = useState(customer ? customer.type || "Wholesale" : "Wholesale");
  const [contactName, setContactName] = useState(customer ? customer.contactName || "" : "");
  const [phone, setPhone] = useState(customer ? customer.phone || "" : "");
  const [email, setEmail] = useState(customer ? customer.email || "" : "");
  const [address, setAddress] = useState(customer ? customer.address || "" : "");
  const [paymentTerms, setPaymentTerms] = useState(customer ? customer.paymentTerms || "" : "");
  const [notes, setNotes] = useState(customer ? customer.notes || "" : "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      type,
      contactName: contactName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      paymentTerms: paymentTerms.trim(),
      notes: notes.trim(),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={customer ? "Edit customer" : "New customer"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Customer / business name" value={name} onChange={setName} />
        <SelectField label="Type" value={type} onChange={setType} options={CUSTOMER_TYPES} />
        <TextField label="Contact name (optional)" value={contactName} onChange={setContactName} />
        <TextField label="Phone (optional)" value={phone} onChange={setPhone} />
        <TextField label="Email (optional)" value={email} onChange={setEmail} />
        <TextField label="Address (optional)" value={address} onChange={setAddress} />
        <TextField label="Payment terms (optional)" value={paymentTerms} onChange={setPaymentTerms} placeholder="e.g. Net 30" />
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={saving}
          style={{
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : customer ? "Save changes" : "Add customer"}
        </button>
      </div>
    </Modal>
  );
}

const CUSTOMER_TYPE_COLOR = {
  Wholesale: "#5C9A3C",
  Taproom: "#D9A441",
  "Direct-to-consumer": "#4AA8C9",
};

function CustomerCard({ customer, onOpen }) {
  const color = CUSTOMER_TYPE_COLOR[customer.type] || "#9BA88A";
  return (
    <button
      onClick={() => onOpen(customer.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: "0 0 3px" }}>
          {customer.name}
        </h3>
        <span style={{ color: "#9BA88A", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
          {customer.contactName || customer.email || customer.phone || "No contact details yet"}
        </span>
      </div>
      <span
        style={{
          flexShrink: 0,
          background: `${color}1A`,
          border: `1px solid ${color}`,
          borderRadius: 20,
          padding: "3px 10px",
          color,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        {customer.type}
      </span>
    </button>
  );
}

function CustomersView({ customers, onOpen }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.contactName || "").toLowerCase().includes(q))
    : customers;

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search customers by name or contact…"
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F5F1E4",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "10px 12px",
          color: "#2A3324",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          marginBottom: 16,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((c) => (
          <CustomerCard key={c.id} customer={c} onOpen={onOpen} />
        ))}
      </div>
      {customers.length === 0 && (
        <EmptyState
          icon={Users}
          title="No customers yet"
          subtitle="Add the businesses you sell to — wholesale accounts, bars, bottle shops — so you can start tracking orders against them."
        />
      )}
      {customers.length > 0 && filtered.length === 0 && (
        <div style={{ color: "#9BA88A", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No customers match "{query}".</div>
      )}
    </div>
  );
}

// Picks (or creates) the Xero contact this customer maps to. Kept
// deliberately simple — search the list Xero already has, or push this
// customer's details into Xero as a brand-new contact.
function XeroContactLinkModal({ customer, contacts, onClose, onLink, onCreate }) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const filtered = q ? contacts.filter((c) => c.name.toLowerCase().includes(q)) : contacts;

  return (
    <Modal title={`Link ${customer.name} to Xero`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={async () => {
            setCreating(true);
            await onCreate(customer);
            setCreating(false);
          }}
          disabled={creating}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "11px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13.5,
            cursor: creating ? "default" : "pointer",
          }}
        >
          <Plus size={15} /> {creating ? "Creating…" : `Create "${customer.name}" as a new Xero contact`}
        </button>

        <div style={{ color: "#9BA88A", fontSize: 12, textAlign: "center" }}>— or link to an existing one —</div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Xero contacts…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        />

        {contacts.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Loading Xero contacts…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {filtered.map((c) => (
              <button
                key={c.contactId}
                onClick={() => onLink(customer.id, c.contactId, c.name)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13.5,
                  color: "#2A3324",
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                {c.name}
              </button>
            ))}
            {filtered.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No contacts match "{query}".</div>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function CustomerDetail({ customer, onBack, onEdit, onDelete, xeroConnected, onLinkXero, onUnlinkXero }) {
  const color = CUSTOMER_TYPE_COLOR[customer.type] || "#9BA88A";
  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All customers
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0 }}>{customer.name}</h1>
      </div>
      <span
        style={{
          display: "inline-block",
          background: `${color}1A`,
          border: `1px solid ${color}`,
          borderRadius: 20,
          padding: "3px 10px",
          color,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          fontWeight: 500,
          marginBottom: 20,
        }}
      >
        {customer.type}
      </span>

      <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {customer.contactName && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Contact: </span>{customer.contactName}</div>
        )}
        {customer.phone && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Phone: </span>{customer.phone}</div>
        )}
        {customer.email && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Email: </span>{customer.email}</div>
        )}
        {customer.address && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Address: </span>{customer.address}</div>
        )}
        {customer.paymentTerms && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Payment terms: </span>{customer.paymentTerms}</div>
        )}
        {customer.notes && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Notes: </span>{customer.notes}</div>
        )}
        {!customer.contactName && !customer.phone && !customer.email && !customer.address && !customer.paymentTerms && !customer.notes && (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No contact details added yet.</div>
        )}
      </div>

      {xeroConnected && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 3 }}>Xero</div>
            {customer.xeroContactId ? (
              <div style={{ fontSize: 13.5, color: "#2A3324" }}>Linked to <strong>{customer.xeroContactName}</strong></div>
            ) : (
              <div style={{ fontSize: 13.5, color: "#9BA88A" }}>Not linked — invoices won't send automatically until this is set up.</div>
            )}
          </div>
          {customer.xeroContactId ? (
            <button
              onClick={() => onUnlinkXero(customer.id)}
              style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "8px 12px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}
            >
              Unlink
            </button>
          ) : (
            <button
              onClick={() => onLinkXero(customer)}
              style={{ background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}
            >
              Link to Xero
            </button>
          )}
        </div>
      )}

      <div style={{ color: "#9BA88A", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px", marginBottom: 20 }}>
        Order history will show up here once Sales Orders are set up.
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onEdit}
          style={{
            flex: 1,
            background: "#EBE8D6",
            border: "1px solid #C9D1AC",
            borderRadius: 5,
            padding: "11px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          Edit customer
        </button>
        <button
          onClick={onDelete}
          style={{
            background: "none",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "11px 16px",
            color: "#B5502F",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function SuppliersModal({ suppliers, onClose, onAddNew, onEdit, onDelete }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = suppliers.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || (s.contactName || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q)
  );
  return (
    <Modal title="Suppliers" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button
          onClick={onAddNew}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "none",
            border: "1px dashed #C9D1AC",
            borderRadius: 5,
            padding: "10px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add supplier
        </button>
        {suppliers.length > 3 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suppliers…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "10px 12px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.length === 0 && q && (
            <div style={{ color: "#9BA88A", fontSize: 13, padding: "12px 4px" }}>No suppliers match "{query}".</div>
          )}
          {filtered.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>{s.name}</div>
                  {(s.contactName || s.phone || s.email) && (
                    <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                      {[s.contactName, s.phone, s.email].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                  <button onClick={() => onEdit(s)} style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                    Edit
                  </button>
                  <button onClick={() => onDelete(s)} style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {suppliers.length === 0 && (
            <EmptyState icon={Users} title="No suppliers added yet" subtitle="Add one to track contact details, and to attach documents like food safety certificates." />
          )}
        </div>
      </div>
    </Modal>
  );
}

function StockTakeModal({ inventory, onClose, onComplete, itemLabel = "ingredient" }) {
  const [counts, setCounts] = useState(() => {
    const init = {};
    inventory.forEach((it) => (init[it.id] = String(it.qty)));
    return init;
  });

  const updateCount = (id, val) => setCounts((prev) => ({ ...prev, [id]: val }));

  const discrepancyCount = inventory.filter((it) => {
    const counted = counts[it.id];
    return counted !== "" && Math.round((Number(counted) - it.qty) * 100) / 100 !== 0;
  }).length;

  const submit = () => {
    const lines = inventory.map((it) => {
      const counted = counts[it.id] === "" ? it.qty : Number(counts[it.id]);
      return {
        itemId: it.id,
        itemName: it.name,
        unit: it.unit,
        systemQty: it.qty,
        countedQty: counted,
        discrepancy: Math.round((counted - it.qty) * 100) / 100,
      };
    });
    onComplete(lines);
    onClose();
  };

  return (
    <Modal title="Stock take" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
          Walk the brewery and enter what you actually count for each {itemLabel}. Anything left unchanged is
          assumed correct as-is.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {inventory.map((it) => {
            const counted = counts[it.id];
            const diff = counted === "" ? 0 : Math.round((Number(counted) - it.qty) * 100) / 100;
            return (
              <div key={it.id} style={{ background: "#F5F1E4", border: `1px solid ${diff !== 0 ? "#E3D3A0" : "#DDE0C8"}`, borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ color: "#2A3324", fontSize: 13.5 }}>{it.name}</span>
                  <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>
                    system: {formatQty(it.qty, it.unit)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="number"
                    step="0.01"
                    value={counted}
                    onChange={(e) => updateCount(it.id, e.target.value)}
                    style={{
                      flex: 1,
                      boxSizing: "border-box",
                      background: "#FFFFFF",
                      border: "1px solid #DDE0C8",
                      borderRadius: 4,
                      padding: "8px 9px",
                      color: "#2A3324",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                    }}
                  />
                  <span style={{ color: "#5C6B54", fontSize: 12, width: 30, flexShrink: 0 }}>{it.unit}</span>
                  {diff !== 0 && (
                    <span style={{ color: diff > 0 ? "#D9A441" : "#5C9A3C", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, flexShrink: 0 }}>
                      {diff > 0 ? "+" : ""}
                      {diff}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {inventory.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No {itemLabel}s to count yet.</div>}
        </div>
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Complete stock take{discrepancyCount > 0 ? ` (${discrepancyCount} discrepanc${discrepancyCount !== 1 ? "ies" : "y"})` : ""}
        </button>
      </div>
    </Modal>
  );
}

function StockTakeHistoryModal({ stockTakes, onClose, onOpenReport }) {
  return (
    <Modal title="Stock take reports" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {stockTakes.map((st) => {
          const discrepancies = st.lines.filter((l) => l.discrepancy !== 0).length;
          return (
            <button
              key={st.id}
              onClick={() => onOpenReport(st)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                background: "#FFFFFF",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <div style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>{st.date}</div>
                <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                  {st.userName || "Unknown"} · {st.lines.length} item{st.lines.length !== 1 ? "s" : ""} checked
                </div>
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: discrepancies > 0 ? "#5C9A3C" : "#D9A441" }}>
                {discrepancies > 0 ? `${discrepancies} off` : "all matched"}
              </span>
            </button>
          );
        })}
        {stockTakes.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
            No stock takes recorded yet.
          </div>
        )}
      </div>
    </Modal>
  );
}

function StockTakeReportModal({ stockTake, onClose }) {
  return (
    <Modal title={`Stock take — ${stockTake.date}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5 }}>Done by {stockTake.userName || "Unknown"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stockTake.lines.map((l) => (
            <div
              key={l.itemId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "9px 12px",
                background: "#F8F5EA",
                border: `1px solid ${l.discrepancy !== 0 ? "#E3D3A0" : "#EBE8D6"}`,
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <span style={{ color: "#2A3324" }}>{l.itemName}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>
                {formatQty(l.systemQty, l.unit)} → {formatQty(l.countedQty, l.unit)}
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 12,
                  color: l.discrepancy === 0 ? "#9BA88A" : l.discrepancy > 0 ? "#D9A441" : "#5C9A3C",
                  width: 50,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {l.discrepancy === 0 ? "match" : `${l.discrepancy > 0 ? "+" : ""}${l.discrepancy}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function AdjustInventoryModal({ item, onClose, onSave }) {
  const [delta, setDelta] = useState("");
  const [batchRef, setBatchRef] = useState("");

  const submit = () => {
    const d = Number(delta);
    if (!d) return;
    onSave(item.id, d, batchRef.trim());
    onClose();
  };

  return (
    <Modal title={`Log adjustment — ${item.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NumberField label={`Change (${item.unit} — use a minus sign to subtract)`} value={delta} onChange={setDelta} step="0.01" />
        <TextField label="Batch ID (optional)" value={batchRef} onChange={setBatchRef} />
        <div style={{ color: "#9BA88A", fontSize: 12 }}>
          Add a batch number here if this adjustment relates to a specific batch — it'll show in the history entry.
        </div>
        <button
          onClick={submit}
          style={{
            marginTop: 4,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Log adjustment
        </button>
      </div>
    </Modal>
  );
}

function InventoryItemDetail({ item, onBack, onAdjust, onLogAdjustment, suppliers, onChangeSupplier, backLabel = "All inventory", showCost = false, onChangeCost, onDelete }) {
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
    const history = [...(item.history || [])].reverse();
  const [costDraft, setCostDraft] = useState(item.costPerUnit ?? "");

  const typeLabel = { batch: "Used in batch", manual: "Manual adjustment", received: "Stock received", restored: "Restored (batch deleted)", stocktake: "Stock take correction" };
  const typeColor = { batch: "#5C9A3C", manual: "#5C6B54", received: "#D9A441", restored: "#D9A441", stocktake: "#D4A24C" };

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> {backLabel}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0, fontWeight: 500 }}>
          {item.name}
        </h1>
        {low && <AlertTriangle size={16} color="#5C9A3C" />}
      </div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: CATEGORY_COLOR[item.category],
          marginBottom: 20,
        }}
      >
        {item.category}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px", marginBottom: 22 }}>
        <button
          onClick={() => onAdjust(item.id, -step)}
          aria-label={`Remove ${step} ${item.unit}`}
          style={{ width: 36, height: 36, borderRadius: 6, background: "#EBE8D6", border: "1px solid #C9D1AC", color: "#2A3324", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <Minus size={16} />
        </button>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, color: low ? "#5C9A3C" : "#2A3324" }}>
            {formatQty(item.qty, item.unit)}
          </div>
          <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 2 }}>low-stock alert at {formatQty(item.threshold, item.unit)}</div>
        </div>
        <button
          onClick={() => onAdjust(item.id, step)}
          aria-label={`Add ${step} ${item.unit}`}
          style={{ width: 36, height: 36, borderRadius: 6, background: "#EBE8D6", border: "1px solid #C9D1AC", color: "#2A3324", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <Plus size={16} />
        </button>
      </div>

      <button
        onClick={() => onLogAdjustment(item)}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "10px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginBottom: 22,
        }}
      >
        Log adjustment with a batch ID
      </button>

      {showCost && (
        <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 22 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
            Cost per unit
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              step="0.01"
              value={costDraft}
              onChange={(e) => setCostDraft(e.target.value)}
              placeholder="0.00"
              style={{
                flex: 1,
                boxSizing: "border-box",
                background: "#FFFFFF",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            />
            <button
              onClick={() => onChangeCost(item.id, costDraft === "" ? null : Number(costDraft))}
              style={{
                background: "#EBE8D6",
                border: "1px solid #C9D1AC",
                borderRadius: 4,
                padding: "0 14px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Save
            </button>
          </div>
        </label>
      )}

      <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 22 }}>
        <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
          Supplier
        </span>
        <select
          value={item.supplierId || ""}
          onChange={(e) => onChangeSupplier(item.id, e.target.value || null)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#FFFFFF",
            border: "1px solid #DDE0C8",
            borderRadius: 4,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        >
          <option value="">No supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        History
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {history.map((h) => (
          <div
            key={h.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: "#F8F5EA",
              border: "1px solid #EBE8D6",
              borderRadius: 5,
              fontSize: 13,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ color: typeColor[h.type] || "#5C6B54", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {typeLabel[h.type] || "Change"}
              </div>
              <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.note}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", color: h.delta >= 0 ? "#D9A441" : "#5C9A3C", fontSize: 13.5 }}>
                {h.delta >= 0 ? "+" : ""}
                {h.delta} {item.unit}
              </div>
              <div style={{ color: "#9BA88A", fontSize: 10.5, marginTop: 2 }}>{formatHistoryStamp(h.date)}</div>
              {h.user && <div style={{ color: "#9BA88A", fontSize: 10.5, marginTop: 1 }}>{h.user}</div>}
            </div>
          </div>
        ))}
        {history.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
            No changes logged yet — adjustments, batch usage, and received stock will show up here.
          </div>
        )}
      </div>

      {onDelete && (
        <button
          onClick={() => onDelete(item)}
          style={{
            width: "100%",
            background: "none",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "11px",
            color: "#5C9A3C",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
            marginTop: 26,
          }}
        >
          Delete {item.name}
        </button>
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F5F1E4",
          border: "1px solid #DDE0C8",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#2A3324",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddTankModal({ onClose, onAdd }) {
  const [countInput, setCountInput] = useState("1");
  const [rows, setRows] = useState([{ id: uid(), name: "Tank 1", capacity: 20, type: "Fermenter" }]);
  const [saving, setSaving] = useState(false);

  const applyCount = (raw) => {
    setCountInput(raw);
    const num = parseInt(raw, 10);
    if (!num || num < 1) return;
    const clamped = Math.min(50, num);
    setRows((prev) => {
      if (clamped === prev.length) return prev;
      if (clamped < prev.length) return prev.slice(0, clamped);
      const next = [...prev];
      const lastCapacity = prev[prev.length - 1]?.capacity ?? 20;
      while (next.length < clamped) {
        next.push({ id: uid(), name: `Tank ${next.length + 1}`, capacity: lastCapacity, type: "Fermenter" });
      }
      return next;
    });
  };

  const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const submit = async () => {
    const clean = rows.filter((r) => r.name.trim());
    if (clean.length === 0) return;
    setSaving(true);
    await Promise.all(clean.map((r) => onAdd({ id: uid(), name: r.name.trim(), capacity: Number(r.capacity) || 0, type: r.type || "Fermenter" })));
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="Set up your tanks" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NumberField
          label="How many tanks do you have?"
          value={countInput}
          onChange={applyCount}
          step="1"
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row, i) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                padding: "10px 10px",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8 }}>
                <TextField label={`Tank ${i + 1} ID`} value={row.name} onChange={(v) => updateRow(row.id, { name: v })} />
                <NumberField label="Litres" value={row.capacity} onChange={(v) => updateRow(row.id, { capacity: v })} step="1" />
              </div>
              <SelectField
                label="Type"
                value={row.type || "Fermenter"}
                onChange={(v) => updateRow(row.id, { type: v })}
                options={["Mash Tun", "Kettle", "Fermenter", "Brite Tank"]}
              />
            </div>
          ))}
        </div>

        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 8,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : `Add ${rows.length} tank${rows.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    </Modal>
  );
}

function EditTankModal({ tank, onClose, onSave }) {
  const [name, setName] = useState(tank.name);
  const [capacity, setCapacity] = useState(tank.capacity);
  const [type, setType] = useState(tank.type || "Fermenter");

  const submit = () => {
    if (!name.trim()) return;
    onSave(tank.id, { name: name.trim(), capacity: Number(capacity) || 0, type });
    onClose();
  };

  return (
    <Modal title="Edit tank" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Tank ID" value={name} onChange={setName} />
        <NumberField label="Capacity" value={capacity} onChange={setCapacity} step="1" suffix="L" />
        <SelectField label="Type" value={type} onChange={setType} options={["Mash Tun", "Kettle", "Fermenter", "Brite Tank"]} />
        <div style={{ color: "#9BA88A", fontSize: 12 }}>
          Renaming won't retroactively update batches already assigned to this tank — reassign them from the batch's page if needed.
        </div>
        <button
          onClick={submit}
          style={{
            marginTop: 4,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save changes
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDeleteBatchModal({ batch, onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <Modal title={`Delete ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            color: "#5C9A3C",
            fontSize: 13,
            background: "#FCF1DC",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "10px 12px",
            lineHeight: 1.5,
          }}
        >
          This permanently removes batch #{batch.number} and all its readings, packaging history, and schedule.
          Any ingredients this batch used will be added back to inventory automatically, restoring the specific
          lots they were drawn from. This can't be undone.
        </div>
        <TextField label='Type "DELETE" to confirm' value={confirmText} onChange={setConfirmText} />
        <button
          onClick={() => {
            if (!canDelete) return;
            onConfirm(batch.id);
            onClose();
          }}
          disabled={!canDelete}
          style={{
            background: canDelete ? "#B5502F" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canDelete ? "#2A3324" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: canDelete ? "pointer" : "default",
          }}
        >
          Delete batch
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDeleteRecipeModal({ recipe, onClose, onConfirm }) {
  return (
    <Modal title={`Delete ${recipe.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          This removes the recipe from your list. Batches already brewed from it keep their own copy of the
          ingredients and details, so nothing on past batches is affected. This can't be undone.
        </div>
        <button
          onClick={() => {
            onConfirm(recipe.id);
            onClose();
          }}
          style={{
            background: "#B5502F",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#2A3324",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Delete recipe
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDeleteSupplierModal({ supplier, onClose, onConfirm }) {
  return (
    <Modal title={`Delete ${supplier.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          This removes the supplier and any documents (certificates, etc.) attached to them. This can't be undone.
        </div>
        <button
          onClick={() => {
            onConfirm(supplier.id);
            onClose();
          }}
          style={{
            background: "#B5502F",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#2A3324",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Delete supplier
        </button>
      </div>
    </Modal>
  );
}

function ConfirmDeleteTankModal({ tank, onClose, onConfirm }) {
  return (
    <Modal title={`Delete ${tank.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          This removes the tank from your brewery list. It's not currently assigned to any batches, so nothing else is affected.
        </div>
        <button
          onClick={() => {
            onConfirm(tank.id);
            onClose();
          }}
          style={{
            background: "#B5502F",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#2A3324",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Delete tank
        </button>
      </div>
    </Modal>
  );
}

function AssignTankModal({ batch, tanks, batches, onClose, onSave }) {
  const [tankId, setTankId] = useState(batch.tankId || "");
  const [brewStage, setBrewStage] = useState(batch.brewStage || "");
  const selectedTank = tanks.find((t) => t.id === tankId) || null;

  const submit = () => {
    if (selectedTank && tankIsOccupied(batches, selectedTank.id, batch.id)) return;
    const finalBrewStage = selectedTank?.type === "Mash Tun" ? brewStage || "Mashing" : selectedTank?.type === "Kettle" ? "Kettle" : null;
    onSave(batch.id, selectedTank, finalBrewStage);
    onClose();
  };

  return (
    <Modal title={`Assign tank — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Tank</span>
          <select
            value={tankId}
            onChange={(e) => {
              setTankId(e.target.value);
              const t = tanks.find((tk) => tk.id === e.target.value);
              if (t?.type === "Mash Tun") setBrewStage("Mashing");
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          >
            <option value="">Unassigned</option>
            {sortedTanks(tanks).map((t) => {
              const occupied = tankIsOccupied(batches, t.id, batch.id);
              const occupant = occupied ? occupyingBatch(batches, t.id, batch.id) : null;
              return (
                <option key={t.id} value={t.id} disabled={occupied}>
                  {t.name} ({t.type}, {t.capacity}L){occupied ? ` — occupied by ${occupant?.name || "another batch"}` : ""}
                </option>
              );
            })}
          </select>
        </label>
        {selectedTank?.type === "Mash Tun" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Brew stage</span>
            <select
              value={brewStage || "Mashing"}
              onChange={(e) => setBrewStage(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            >
              <option value="Mashing">Mashing in</option>
              <option value="Recirculating">Recirculating</option>
            </select>
          </label>
        )}
        {selectedTank?.type === "Kettle" && (
          <div style={{ color: "#9BA88A", fontSize: 12 }}>Will be marked "In the kettle."</div>
        )}
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

// The split-batch equivalent of AssignTankModal — a batch spread across
// several tanks doesn't fit a single tankId, so it gets its own editor for
// changing which tanks (and volumes) it's actually sitting in.
function EditSplitTanksModal({ batch, tanks, batches, onClose, onSave }) {
  const [rows, setRows] = useState(
    (batch.splitTanks || []).map((t) => ({ id: uid(), tankId: t.tankId, volume: t.volume }))
  );

  const addRow = () => setRows((prev) => [...prev, { id: uid(), tankId: "", volume: "" }]);
  const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const submit = () => {
    const final = rows
      .filter((r) => r.tankId && Number(r.volume) > 0)
      .map((r) => {
        const t = tanks.find((tk) => tk.id === r.tankId);
        return { tankId: r.tankId, tankName: t ? t.name : "", volume: Number(r.volume) || 0 };
      });
    onSave(batch.id, final);
    onClose();
  };

  return (
    <Modal title={`Change tanks — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => (
          <div key={row.id} style={{ display: "flex", gap: 6 }}>
            <select
              value={row.tankId}
              onChange={(e) => updateRow(row.id, { tankId: e.target.value })}
              style={{
                flex: 1,
                minWidth: 0,
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "8px 8px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
              }}
            >
              <option value="">Choose tank</option>
              {sortedTanks(tanks).map((t) => {
                const usedAbove = rows.some((r) => r.id !== row.id && r.tankId === t.id);
                const occupied = tankIsOccupied(batches, t.id, batch.id) || usedAbove;
                const occupant = occupyingBatch(batches, t.id, batch.id);
                return (
                  <option key={t.id} value={t.id} disabled={occupied}>
                    {t.name} ({t.type}, {t.capacity}L)
                    {usedAbove ? " — already used above" : occupant ? ` — occupied by ${occupant.name}` : ""}
                  </option>
                );
              })}
            </select>
            <input
              type="number"
              step="0.1"
              value={row.volume}
              onChange={(e) => updateRow(row.id, { volume: e.target.value })}
              placeholder="Litres"
              style={{
                width: 84,
                flexShrink: 0,
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "8px 8px",
                color: "#2A3324",
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                textAlign: "right",
              }}
            />
            <button
              onClick={() => removeRow(row.id)}
              aria-label="Remove tank"
              style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8, flexShrink: 0 }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={addRow}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "none",
            border: "1px dashed #C9D1AC",
            borderRadius: 5,
            padding: "8px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 12.5,
            cursor: "pointer",
          }}
        >
          <Plus size={13} /> Add another tank
        </button>
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

// The kettle always empties into a single shared vessel — but from there
// it's very common to split into more than one fermenter, so this step
// gets its own multi-row picker instead of the plain single-tank one.
function TransferToFermenterModal({ batch, tanks, batches, onClose, onSave }) {
  const fermenters = tanks.filter((t) => t.type === "Fermenter");
  const target = remainingVolume(batch);
  const [rows, setRows] = useState([{ id: uid(), tankId: "", volume: target }]);

  const addRow = () =>
    setRows((prev) => {
      const allocated = prev.reduce((sum, r) => sum + (Number(r.volume) || 0), 0);
      const remainder = Math.round((target - allocated) * 10) / 10;
      return [...prev, { id: uid(), tankId: "", volume: remainder > 0 ? remainder : "" }];
    });
  const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
  const total = rows.reduce((sum, r) => sum + (Number(r.volume) || 0), 0);
  const overCapacityRows = rows.filter((r) => {
    const t = fermenters.find((tk) => tk.id === r.tankId);
    return t && Number(r.volume) > t.capacity;
  });
  const shortBy = Math.round((target - total) * 10) / 10;
  const underAllocated = shortBy > 0.05;
  const canSubmit = rows.some((r) => r.tankId && Number(r.volume) > 0) && overCapacityRows.length === 0;

  const submit = () => {
    if (!canSubmit) return;
    const final = rows
      .filter((r) => r.tankId && Number(r.volume) > 0)
      .map((r) => {
        const t = fermenters.find((tk) => tk.id === r.tankId);
        return { tankId: r.tankId, tankName: t ? t.name : "", volume: Number(r.volume) || 0 };
      });
    if (final.length === 0) return;
    onSave(final);
    onClose();
  };

  return (
    <Modal title={`Transfer to fermenter — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {fermenters.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No fermenters set up yet — add one in Brewery first.</div>
        ) : (
          <>
            <div style={{ color: "#9BA88A", fontSize: 12 }}>Splitting across more than one fermenter? Add another row.</div>
            {rows.filter((r) => r.tankId).length > 1 && (
              <div style={{ color: "#5C6B54", fontSize: 12, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 12px" }}>
                Splitting creates separate batches — one per fermenter, named "— A", "— B", etc. Each one tracks its own stage and readings from here on.
              </div>
            )}
            {rows.map((row) => {
              const rowTank = fermenters.find((t) => t.id === row.tankId);
              const rowOverCapacity = rowTank && Number(row.volume) > rowTank.capacity;
              return (
                <div key={row.id}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={row.tankId}
                      onChange={(e) => updateRow(row.id, { tankId: e.target.value })}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        boxSizing: "border-box",
                        background: "#F5F1E4",
                        border: "1px solid #DDE0C8",
                        borderRadius: 4,
                        padding: "8px 8px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 13,
                      }}
                    >
                      <option value="">Choose fermenter</option>
                      {sortedTanks(fermenters).map((t) => {
                        const usedAbove = rows.some((r) => r.id !== row.id && r.tankId === t.id);
                        const occupied = tankIsOccupied(batches, t.id, batch.id) || usedAbove;
                        const occupant = occupyingBatch(batches, t.id, batch.id);
                        return (
                          <option key={t.id} value={t.id} disabled={occupied}>
                            {t.name} ({t.capacity}L)
                            {usedAbove ? " — already used above" : occupant ? ` — occupied by ${occupant.name}` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <input
                      type="number"
                      step="0.1"
                      value={row.volume}
                      onChange={(e) => updateRow(row.id, { volume: e.target.value })}
                      placeholder="Litres"
                      style={{
                        width: 84,
                        flexShrink: 0,
                        boxSizing: "border-box",
                        background: "#F5F1E4",
                        border: `1px solid ${rowOverCapacity ? "#E3B37A" : "#DDE0C8"}`,
                        borderRadius: 4,
                        padding: "8px 8px",
                        color: rowOverCapacity ? "#B5502F" : "#2A3324",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 13,
                        textAlign: "right",
                      }}
                    />
                    {rows.length > 1 && (
                      <button
                        onClick={() => removeRow(row.id)}
                        aria-label="Remove fermenter"
                        style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8, flexShrink: 0 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {rowOverCapacity && (
                    <div style={{ color: "#B5502F", fontSize: 11, marginTop: 3 }}>
                      Exceeds {rowTank.name}'s {rowTank.capacity}L capacity.
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={addRow}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                background: "none",
                border: "1px dashed #C9D1AC",
                borderRadius: 5,
                padding: "8px",
                color: "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <Plus size={13} /> Split into another fermenter
            </button>
            {rows.length > 1 && (
              <div style={{ fontSize: 12, color: total > target + 0.05 ? "#B5502F" : "#9BA88A" }}>
                {total}L of {target}L allocated
              </div>
            )}
            {underAllocated && (() => {
              const lastRow = rows[rows.length - 1];
              const lastTank = fermenters.find((t) => t.id === lastRow?.tankId);
              const topUpValue = Math.round(((Number(lastRow?.volume) || 0) + shortBy) * 10) / 10;
              const canTopUp = lastRow && lastTank && topUpValue <= lastTank.capacity;
              return (
                <div style={{ color: "#5C6B54", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span>{shortBy}L not going into a fermenter — normal if that's kettle trub, hop debris, or chiller loss.</span>
                  {canTopUp && (
                    <button
                      onClick={() => updateRow(lastRow.id, { volume: topUpValue })}
                      style={{ alignSelf: "flex-start", background: "none", border: "1px solid #C9D1AC", borderRadius: 4, padding: "6px 12px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: "pointer" }}
                    >
                      Capture the extra {shortBy}L in {lastTank.name} instead
                    </button>
                  )}
                </div>
              );
            })()}
          </>
        )}
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canSubmit ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          Transfer to fermenter — starts Primary
        </button>
      </div>
    </Modal>
  );
}

// Used for "transfer to kettle" — the kettle is always a single shared
// vessel, so a plain one-tank picker is all that's needed there.
function VesselTransferModal({ batch, tanks, batches, toType, actionLabel, onClose, onSave }) {
  const available = tanks.filter((t) => t.type === toType);
  const [tankId, setTankId] = useState("");

  const submit = () => {
    const tank = available.find((t) => t.id === tankId);
    if (!tank || tankIsOccupied(batches, tank.id, batch.id)) return;
    onSave(tank);
    onClose();
  };

  return (
    <Modal title={`Transfer to ${toType.toLowerCase()} — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {available.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>
            No {toType.toLowerCase()} set up yet — add one in Brewery first.
          </div>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{toType}</span>
            <select
              value={tankId}
              onChange={(e) => setTankId(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            >
              <option value="">Choose one…</option>
              {sortedTanks(available).map((t) => {
                const occupied = tankIsOccupied(batches, t.id, batch.id);
                const occupant = occupied ? occupyingBatch(batches, t.id, batch.id) : null;
                return (
                  <option key={t.id} value={t.id} disabled={occupied}>
                    {t.name} ({t.capacity}L){occupied ? ` — occupied by ${occupant?.name || "another batch"}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        )}
        <button
          onClick={submit}
          disabled={!tankId}
          style={{
            background: tankId ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: tankId ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: tankId ? "pointer" : "default",
          }}
        >
          {actionLabel}
        </button>
      </div>
    </Modal>
  );
}

function AddInventoryModal({ onClose, onAdd, suppliers, categories = CATEGORIES, unitOptions = ["kg", "g", "L", "ea"], title = "New inventory item", submitLabel = "Add to inventory", showCost = false, storageKey = "brewpoint-last-category" }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(() => {
    try {
      const last = localStorage.getItem(storageKey);
      return last && categories.includes(last) ? last : categories[0];
    } catch {
      return categories[0];
    }
  });
  const [qty, setQty] = useState(10);
  const [unit, setUnit] = useState(unitOptions[0]);
  const [threshold, setThreshold] = useState(5);
  const [supplierId, setSupplierId] = useState("");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    try {
      localStorage.setItem(storageKey, category);
    } catch {}
    setSaving(true);
    await onAdd({
      id: uid(),
      name: name.trim(),
      category,
      qty: Number(qty) || 0,
      unit,
      threshold: Number(threshold) || 0,
      supplierId: supplierId || null,
      ...(showCost ? { costPerUnit: costPerUnit === "" ? null : Number(costPerUnit) } : {}),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SelectField label="Category" value={category} onChange={setCategory} options={categories} />
          <SelectField label="Unit" value={unit} onChange={setUnit} options={unitOptions} />
          <NumberField label="Quantity on hand" value={qty} onChange={setQty} step="0.1" suffix={unit} />
          <NumberField label="Low-stock alert at" value={threshold} onChange={setThreshold} step="0.1" suffix={unit} />
          {showCost && <NumberField label="Cost per unit (optional)" value={costPerUnit} onChange={setCostPerUnit} step="0.01" />}
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
            Supplier (optional)
          </span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          >
            <option value="">No supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 8,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </Modal>
  );
}

function PackageTypeCard({ packageType, onOpen }) {
  return (
    <button
      onClick={() => onOpen(packageType.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <div style={{ minWidth: 0 }}>
        <h3
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 16,
            color: "#2A3324",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {packageType.name}
        </h3>
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
          {packageType.items.length} consumable{packageType.items.length !== 1 ? "s" : ""} per unit
        </div>
      </div>
    </button>
  );
}

function AddPackageTypeModal({ onClose, onAdd, consumables }) {
  const [name, setName] = useState("");
  const [items, setItems] = useState([{ id: uid(), consumableId: consumables[0]?.id || "", qtyPerUnit: 1, matchLabelByRecipeName: false }]);
  const [saving, setSaving] = useState(false);

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const addItemRow = () =>
    setItems((prev) => [...prev, { id: uid(), consumableId: consumables[0]?.id || "", qtyPerUnit: 1, matchLabelByRecipeName: false }]);

  const removeItemRow = (id) => setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));

  const submit = async () => {
    const cleanItems = items
      .filter((it) => it.matchLabelByRecipeName || it.consumableId)
      .map((it) => {
        if (it.matchLabelByRecipeName) {
          return { consumableId: null, consumableName: null, matchLabelByRecipeName: true, qtyPerUnit: Number(it.qtyPerUnit) || 0 };
        }
        const consumable = consumables.find((c) => c.id === it.consumableId);
        return { consumableId: it.consumableId, consumableName: consumable ? consumable.name : "", matchLabelByRecipeName: false, qtyPerUnit: Number(it.qtyPerUnit) || 0 };
      });
    if (!name.trim() || cleanItems.length === 0) return;
    setSaving(true);
    await onAdd({ id: uid(), name: name.trim(), items: cleanItems });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="New package type" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginTop: 4 }}>
          Consumables used per unit packaged
        </div>

        {consumables.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 12.5 }}>
            You don't have any consumables yet — add some in the Consumables screen first (cans, lids, boxes, etc.), then come back here.
          </div>
        )}

        {consumables.length > 0 &&
          items.map((line, i) => (
            <div
              key={line.id}
              style={{
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                padding: "12px",
                position: "relative",
              }}
            >
              {items.length > 1 && (
                <button
                  onClick={() => removeItemRow(line.id)}
                  aria-label="Remove consumable"
                  style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8 }}
                >
                  <Trash2 size={14} />
                </button>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={line.matchLabelByRecipeName}
                  onChange={(e) => updateItem(line.id, { matchLabelByRecipeName: e.target.checked, consumableId: e.target.checked ? null : consumables[0]?.id || "" })}
                />
                <span style={{ fontSize: 12.5, color: "#5C6B54", fontFamily: "'Inter', sans-serif" }}>
                  Auto-match label by beer name (skip picking a specific label)
                </span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: line.matchLabelByRecipeName ? "1fr" : "1fr 100px", gap: 10, alignItems: "end" }}>
                {!line.matchLabelByRecipeName && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                      Consumable
                    </span>
                    <select
                      value={line.consumableId}
                      onChange={(e) => updateItem(line.id, { consumableId: e.target.value })}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: "#FFFFFF",
                        border: "1px solid #DDE0C8",
                        borderRadius: 4,
                        padding: "9px 10px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 14,
                      }}
                    >
                      {consumables.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <NumberField label="Qty each" value={line.qtyPerUnit} onChange={(v) => updateItem(line.id, { qtyPerUnit: v })} step="1" />
              </div>
              {line.matchLabelByRecipeName && (
                <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 8 }}>
                  At packaging time, this'll look for a Label consumable with the same name as the beer being packaged.
                </div>
              )}
            </div>
          ))}

        {consumables.length > 0 && (
          <button
            onClick={addItemRow}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              background: "none",
              border: "1px dashed #C9D1AC",
              borderRadius: 5,
              padding: "9px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            <Plus size={14} /> Add another consumable
          </button>
        )}

        <button
          onClick={submit}
          disabled={saving || consumables.length === 0}
          style={{
            marginTop: 8,
            background: saving || consumables.length === 0 ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving || consumables.length === 0 ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving || consumables.length === 0 ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Create package type"}
        </button>
      </div>
    </Modal>
  );
}

function PackageTypeDetail({ packageType, consumables, onBack, onDelete }) {
  const costableItems = packageType.items.filter((it) => !it.matchLabelByRecipeName);
  const hasVariableLabel = packageType.items.some((it) => it.matchLabelByRecipeName);
  const allCosted = costableItems.length > 0 && costableItems.every((it) => {
    const c = consumables.find((c) => c.id === it.consumableId);
    return c && c.costPerUnit != null;
  });
  const totalCost = costableItems.reduce((sum, it) => {
    const c = consumables.find((c) => c.id === it.consumableId);
    return sum + (c?.costPerUnit || 0) * (Number(it.qtyPerUnit) || 0);
  }, 0);

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All package types
      </button>

      <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: "0 0 20px" }}>
        {packageType.name}
      </h1>

      {costableItems.length > 0 && (
        <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px", marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
            Cost per unit
          </div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>
            {allCosted ? `$${totalCost.toFixed(2)}` : `~$${totalCost.toFixed(2)}`}
          </div>
          {(!allCosted || hasVariableLabel) && (
            <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 3 }}>
              {!allCosted && "Some consumables here don't have a cost set yet, so this is a partial total. "}
              {hasVariableLabel && "Doesn't include the auto-matched label, since its cost varies by recipe."}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Consumables used per unit packaged
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {packageType.items.map((it, i) => {
          const c = it.consumableId ? consumables.find((c) => c.id === it.consumableId) : null;
          const lineCost = c?.costPerUnit != null ? c.costPerUnit * (Number(it.qtyPerUnit) || 0) : null;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13.5,
                color: "#2A3324",
              }}
            >
              <span>{it.matchLabelByRecipeName ? "Label (auto-matched by beer name)" : it.consumableName}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>× {it.qtyPerUnit}</span>
                {lineCost != null && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 12 }}>${lineCost.toFixed(2)}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => onDelete(packageType.id)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "9px 12px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 12.5,
          cursor: "pointer",
        }}
      >
        <Trash2 size={14} /> Delete package type
      </button>
    </div>
  );
}

function POStatusPill({ status }) {
  const color = status === "Received" ? "#D9A441" : status === "Sent" ? "#5C9A3C" : "#5C6B54";
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "3px 7px",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {status === "Received" && <CheckCircle2 size={11} />}
      {status}
    </span>
  );
}

function POCard({ po, onOpen }) {
  return (
    <button
      onClick={() => onOpen(po.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>{po.poNumber}</span>
          <h3
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 16,
              color: "#2A3324",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {po.supplier}
          </h3>
        </div>
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
          {po.lines.length} item{po.lines.length !== 1 ? "s" : ""} · ordered {po.orderDate.slice(5)}
        </div>
      </div>
      <POStatusPill status={po.status} />
    </button>
  );
}

function AddSalesOrderModal({ onClose, onAdd, customers, availableStock, nextOrderNumber }) {
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ id: uid(), batchId: "", containerKey: "", qty: "", unitPrice: "" }]);
  const [saving, setSaving] = useState(false);

  const stockOptions = availableStock.filter((s) => s.available > 0);

  const updateLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { id: uid(), batchId: "", containerKey: "", qty: "", unitPrice: "" }]);
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const submit = async () => {
    const cleanLines = lines.filter((l) => l.batchId && l.containerKey && Number(l.qty) > 0);
    if (!customerId || cleanLines.length === 0) return;
    setSaving(true);
    const customer = customers.find((c) => c.id === customerId);
    await onAdd({
      id: uid(),
      customerId,
      orderNumber: nextOrderNumber,
      status: "Draft",
      orderDate,
      notes: notes.trim(),
      lines: cleanLines.map((l) => {
        const stock = availableStock.find((s) => s.batchId === l.batchId && s.containerKey === l.containerKey);
        return {
          id: l.id,
          batchId: l.batchId,
          batchName: stock ? stock.batchName : "",
          containerKey: l.containerKey,
          containerLabel: stock ? stock.containerLabel : "",
          qty: Number(l.qty),
          unitPrice: l.unitPrice === "" ? 0 : Number(l.unitPrice),
        };
      }),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="New order" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {customers.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Add a customer first, then come back here to create an order for them.</div>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Customer</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
            >
              <option value="">Choose a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Order date</span>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            style={{ boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
        </label>

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Order lines</div>
        {stockOptions.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>Nothing packaged and available to sell yet — package a batch first.</div>
        )}
        {stockOptions.length > 0 &&
          lines.map((line) => {
            const chosen = availableStock.find((s) => s.batchId === line.batchId && s.containerKey === line.containerKey);
            return (
              <div key={line.id} style={{ display: "flex", flexDirection: "column", gap: 6, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: 10 }}>
                <select
                  value={line.batchId && line.containerKey ? `${line.batchId}::${line.containerKey}` : ""}
                  onChange={(e) => {
                    const [batchId, containerKey] = e.target.value.split("::");
                    updateLine(line.id, { batchId: batchId || "", containerKey: containerKey || "" });
                  }}
                  style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                >
                  <option value="">Choose stock…</option>
                  {stockOptions.map((s) => (
                    <option key={`${s.batchId}::${s.containerKey}`} value={`${s.batchId}::${s.containerKey}`}>
                      {s.batchName} — {s.containerLabel} ({s.available} available)
                    </option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max={chosen ? chosen.available : undefined}
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                    placeholder="Qty"
                    style={{ flex: 1, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(line.id, { unitPrice: e.target.value })}
                    placeholder="Price each ($)"
                    style={{ flex: 1, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
                  />
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(line.id)} aria-label="Remove line" style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8 }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        {stockOptions.length > 0 && (
          <button
            onClick={addLine}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            <Plus size={13} /> Add another line
          </button>
        )}
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={saving || customers.length === 0}
          style={{
            background: saving || customers.length === 0 ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving || customers.length === 0 ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving || customers.length === 0 ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Create order"}
        </button>
      </div>
    </Modal>
  );
}

function SalesOrderStatusPill({ status }) {
  const color = status === "Fulfilled" ? "#5C9A3C" : status === "Confirmed" ? "#D9A441" : status === "Cancelled" ? "#B5502F" : "#5C6B54";
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "3px 7px",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {status === "Fulfilled" && <CheckCircle2 size={11} />}
      {status}
    </span>
  );
}

const salesOrderTotal = (order) => (order.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

function SalesOrderCard({ order, customerName, onOpen }) {
  return (
    <button
      onClick={() => onOpen(order.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>{order.orderNumber}</span>
          <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {customerName}
          </h3>
        </div>
        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
          {(order.lines || []).length} line{(order.lines || []).length !== 1 ? "s" : ""} · ${salesOrderTotal(order).toFixed(2)} · {order.orderDate ? order.orderDate.slice(5) : ""}
          {order.paid && <span style={{ color: "#5C9A3C" }}> · Paid</span>}
        </div>
      </div>
      <SalesOrderStatusPill status={order.status} />
    </button>
  );
}

function SalesOrdersView({ salesOrders, customers, onOpen }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const customerName = (id) => customers.find((c) => c.id === id)?.name || "Unknown customer";
  const matches = (o) => !q || customerName(o.customerId).toLowerCase().includes(q) || (o.orderNumber || "").toLowerCase().includes(q);

  const draft = salesOrders.filter((o) => o.status === "Draft" && matches(o));
  const confirmed = salesOrders.filter((o) => o.status === "Confirmed" && matches(o));
  const fulfilled = salesOrders.filter((o) => o.status === "Fulfilled" && matches(o));
  const cancelled = salesOrders.filter((o) => o.status === "Cancelled" && matches(o));

  const section = (title, list) =>
    list.length > 0 && (
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
          {title} ({list.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((o) => (
            <SalesOrderCard key={o.id} order={o} customerName={customerName(o.customerId)} onOpen={onOpen} />
          ))}
        </div>
      </div>
    );

  return (
    <div>
      {salesOrders.length > 0 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search orders by number or customer…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            marginBottom: 16,
          }}
        />
      )}
      {section("Draft", draft)}
      {section("Confirmed", confirmed)}
      {section("Fulfilled", fulfilled)}
      {section("Cancelled", cancelled)}
      {salesOrders.length === 0 && (
        <EmptyState icon={Truck} title="No orders yet" subtitle="Create an order against a customer once you've got stock packaged and ready to sell." />
      )}
      {salesOrders.length > 0 && draft.length === 0 && confirmed.length === 0 && fulfilled.length === 0 && cancelled.length === 0 && (
        <div style={{ color: "#9BA88A", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No orders match "{query}".</div>
      )}
    </div>
  );
}

function SalesOrderDetail({ order, customer, onBack, onAdvance, onCancel, onTogglePaid, onDelete }) {
  const total = salesOrderTotal(order);
  const nextStatus = order.status === "Draft" ? "Confirmed" : order.status === "Confirmed" ? "Fulfilled" : null;

  return (
    <div>
      <button
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: 0, marginBottom: 18 }}
      >
        <ChevronLeft size={16} /> All orders
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 14 }}>{order.orderNumber}</span>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: 0 }}>{customer ? customer.name : "Unknown customer"}</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <SalesOrderStatusPill status={order.status} />
        <span style={{ color: "#9BA88A", fontSize: 12.5 }}>{order.orderDate}</span>
        {order.paid && <span style={{ color: "#5C9A3C", fontSize: 12.5, fontWeight: 500 }}>Paid</span>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
        {(order.lines || []).map((l) => (
          <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13.5, color: "#2A3324" }}>
            <span>{l.batchName} — {l.containerLabel}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>
              {l.qty} × ${Number(l.unitPrice).toFixed(2)} = ${(l.qty * l.unitPrice).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontFamily: "'Oswald', sans-serif", fontWeight: 500, color: "#2A3324", marginBottom: 20, padding: "0 4px" }}>
        <span>Total</span>
        <span>${total.toFixed(2)}</span>
      </div>

      {order.notes && (
        <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 20, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px" }}>
          {order.notes}
        </div>
      )}

      {order.status !== "Cancelled" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          {nextStatus && (
            <button
              onClick={() => onAdvance(order.id, nextStatus)}
              style={{ flex: 1, background: "#5C9A3C", border: "none", borderRadius: 5, padding: "11px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
            >
              {nextStatus === "Confirmed" ? "Confirm order" : "Mark fulfilled"}
            </button>
          )}
          <button
            onClick={() => onTogglePaid(order.id, !order.paid)}
            style={{ flex: 1, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "11px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            {order.paid ? "Mark unpaid" : "Mark paid"}
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        {order.status !== "Cancelled" && order.status !== "Fulfilled" && (
          <button
            onClick={() => onCancel(order.id)}
            style={{ flex: 1, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px", color: "#B5502F", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
          >
            Cancel order
          </button>
        )}
        <button
          onClick={() => onDelete(order)}
          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "11px 16px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13.5, cursor: "pointer" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function AddPOModal({ onClose, onAdd, nextPONumber }) {
  const [supplier, setSupplier] = useState("");
  const [deliveryCost, setDeliveryCost] = useState("");
  const [lines, setLines] = useState([{ id: uid(), name: "", category: "Grain", qty: 1, unit: "kg", costMode: "perUnit", costInput: "" }]);

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () =>
    setLines((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 1, unit: "kg", costMode: "perUnit", costInput: "" }]);

  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const cleanLines = lines.filter((l) => l.name.trim());
    if (!supplier.trim() || cleanLines.length === 0) return;
    setSaving(true);
    await onAdd({
      id: uid(),
      poNumber: nextPONumber,
      supplier: supplier.trim(),
      orderDate: today(),
      receivedDate: null,
      status: "Draft",
      lines: cleanLines.map((l) => {
        const qty = Number(l.qty) || 0;
        const raw = l.costInput === "" ? null : Number(l.costInput);
        const costPerUnit = raw == null ? null : l.costMode === "total" ? (qty > 0 ? raw / qty : null) : raw;
        return { id: l.id, name: l.name.trim(), category: l.category, qty, unit: l.unit, costPerUnit };
      }),
      deliveryCost: deliveryCost === "" ? null : Number(deliveryCost),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title="New purchase order" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Supplier" value={supplier} onChange={setSupplier} />
        <NumberField label="Delivery cost (optional)" value={deliveryCost} onChange={setDeliveryCost} step="0.01" />

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginTop: 4 }}>
          Line items
        </div>
        {lines.map((line, i) => (
          <div
            key={line.id}
            style={{
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: "12px 12px 4px",
              position: "relative",
            }}
          >
            {lines.length > 1 && (
              <button
                onClick={() => removeLine(line.id)}
                aria-label="Remove line item"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "none",
                  border: "none",
                  color: "#5C6B54",
                  cursor: "pointer",
                  padding: 8,
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <div style={{ marginBottom: 10 }}>
              <TextField label={`Item ${i + 1}`} value={line.name} onChange={(v) => updateLine(line.id, { name: v })} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
              <SelectField
                label="Category"
                value={line.category}
                onChange={(v) => updateLine(line.id, { category: v })}
                options={CATEGORIES}
              />
              <SelectField label="Unit" value={line.unit} onChange={(v) => updateLine(line.id, { unit: v })} options={["kg", "g", "L", "ea"]} />
              <NumberField label="Quantity" value={line.qty} onChange={(v) => updateLine(line.id, { qty: v })} step="0.1" suffix={line.unit} />
              <NumberField
                label={line.costMode === "total" ? "Total cost for this line" : "Cost per unit (optional)"}
                value={line.costInput}
                onChange={(v) => updateLine(line.id, { costInput: v })}
                step="0.01"
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button
                onClick={() => updateLine(line.id, { costMode: line.costMode === "total" ? "perUnit" : "total" })}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                {line.costMode === "total" ? "Switch to cost per unit instead" : "Know the total cost instead? Tap here"}
              </button>
              {line.costInput !== "" && Number(line.qty) > 0 && (
                <span style={{ fontSize: 12, color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>
                  {line.costMode === "total"
                    ? `= $${(Number(line.costInput) / Number(line.qty)).toFixed(2)}/${line.unit}`
                    : `= $${(Number(line.costInput) * Number(line.qty)).toFixed(2)} total`}
                </span>
              )}
            </div>
          </div>
        ))}
        <button
          onClick={addLine}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "none",
            border: "1px dashed #C9D1AC",
            borderRadius: 5,
            padding: "9px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add line item
        </button>

        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 4,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : `Create ${nextPONumber}`}
        </button>
      </div>
    </Modal>
  );
}

function ReceivePOModal({ po, onClose, onConfirm }) {
  const [lotNumbers, setLotNumbers] = useState(() => {
    const init = {};
    po.lines.forEach((l) => (init[l.id] = ""));
    return init;
  });

  const submit = () => {
    onConfirm(lotNumbers);
    onClose();
  };

  return (
    <Modal title={`Receive ${po.poNumber}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Enter the lot or batch number printed on each item as it arrives — this is what ties inventory back to this
          specific delivery.
        </div>
        {po.lines.map((l) => (
          <div
            key={l.id}
            style={{
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: "12px 12px",
            }}
          >
            <div style={{ color: "#2A3324", fontSize: 13.5, marginBottom: 8 }}>
              {l.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>({formatQty(l.qty, l.unit)})</span>
            </div>
            <TextField
              label="Lot / batch #"
              value={lotNumbers[l.id]}
              onChange={(v) => setLotNumbers((prev) => ({ ...prev, [l.id]: v }))}
            />
          </div>
        ))}
        <button
          onClick={submit}
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          <Truck size={16} /> Confirm receipt & add to inventory
        </button>
      </div>
    </Modal>
  );
}

function PODetail({ po, onBack, onMarkSent, onReceive, inventory, onDelete }) {
  const [showReceive, setShowReceive] = useState(false);
  const batchesForLine = (lineName, lotNumber) => {
    const item = inventory.find((it) => it.name.toLowerCase() === lineName.toLowerCase());
    if (!item || !item.history) return [];
    const targetLot = lotNumber || "no lot #";
    const notes = item.history
      .filter((h) => h.type === "batch" && Array.isArray(h.lots) && h.lots.some((l) => l.lotNumber === targetLot))
      .map((h) => h.note);
    return [...new Set(notes)];
  };

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All purchase orders
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>{po.poNumber}</div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: "2px 0 6px", fontWeight: 500 }}>
            {po.supplier}
          </h1>
        </div>
        <POStatusPill status={po.status} />
      </div>
      <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 22 }}>
        Created {po.orderDate}
        {po.receivedDate ? ` · Received ${po.receivedDate}` : ""}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Line items
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {po.lines.map((l) => {
          const usedIn = po.status === "Received" ? batchesForLine(l.name, l.lotNumber) : [];
          return (
            <div
              key={l.id}
              style={{
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ flex: 1, color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>{l.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[l.category], fontSize: 11 }}>
                  {l.category}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", width: 64, textAlign: "right", flexShrink: 0 }}>
                  {formatQty(l.qty, l.unit)}
                </span>
                {po.status === "Received" && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", width: 90, flexShrink: 0, textAlign: "right" }}>
                    {l.lotNumber || "no lot #"}
                  </span>
                )}
              </div>
              {po.status === "Received" && (
                <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 6 }}>
                  {usedIn.length > 0 ? `Used in: ${usedIn.join(", ")}` : "Not used in any batch yet"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {po.status === "Draft" && (
        <button
          onClick={() => onMarkSent(po.id)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Mark as sent
        </button>
      )}

      {po.status === "Sent" && (
        <button
          onClick={() => setShowReceive(true)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <Truck size={16} /> Mark received & add to inventory
        </button>
      )}

      {showReceive && (
        <ReceivePOModal
          po={po}
          onClose={() => setShowReceive(false)}
          onConfirm={(lotNumbers) => onReceive(po.id, lotNumbers)}
        />
      )}

      {po.status !== "Received" && onDelete && (
        <button
          onClick={() => onDelete(po)}
          style={{
            width: "100%",
            background: "none",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "11px",
            color: "#5C9A3C",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
            marginTop: 16,
          }}
        >
          Delete order
        </button>
      )}
    </div>
  );
}

// Standard SRM-to-color reference chart (1-40), the same approximation used
// across most homebrew calculators — purely decorative, not scientific.
const SRM_COLORS = [
  "#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123", "#F8A600", "#F39C00", "#EA8F00",
  "#E58500", "#DE7C00", "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100", "#B54C00",
  "#B04500", "#A63E00", "#A13700", "#9B3200", "#952D00", "#8E2900", "#882300", "#821E00",
  "#7B1A00", "#771900", "#6C1400", "#661100", "#600F00", "#5A0E00", "#550C00", "#4F0B00",
  "#4A0900", "#450800", "#400706", "#3B0607", "#360607", "#310505", "#2C0403", "#270403",
];
function srmToHex(srm) {
  if (srm == null || isNaN(srm)) return null;
  const idx = Math.max(1, Math.min(40, Math.round(srm))) - 1;
  return SRM_COLORS[idx];
}

function RecipeCard({ recipe, onOpen }) {
  const srm = calcSRM(recipe.ingredients, recipe.volume);
  const srmColor = srmToHex(srm);
  return (
    <button
      onClick={() => onOpen(recipe.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#C9D1AC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#DDE0C8")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {srmColor && (
          <div
            title={`~${srm.toFixed(0)} SRM`}
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: srmColor,
              border: "1px solid rgba(0,0,0,0.12)",
              flexShrink: 0,
              boxShadow: "inset 0 -3px 5px rgba(0,0,0,0.15), inset 0 2px 3px rgba(255,255,255,0.25)",
            }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 17,
              color: "#2A3324",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {recipe.name}
          </h3>
          <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
            {recipe.style} · {recipe.volume}L · {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 12.5, flexShrink: 0 }}>
        OG {recipe.og.toFixed(3)}
      </span>
    </button>
  );
}

function AddRecipeModal({ onClose, onAdd, inventory, onAddInventoryItem, editingRecipe, standalone = false, onSaveAndBrew }) {
  const [name, setName] = useState(editingRecipe ? editingRecipe.name : "");
  const [style, setStyle] = useState(editingRecipe ? editingRecipe.style : "");
  const [styleFocused, setStyleFocused] = useState(false);
  const [volume, setVolume] = useState(editingRecipe ? editingRecipe.volume : 20);
  const [og, setOg] = useState(editingRecipe ? editingRecipe.og : 1.05);
  const [fg, setFg] = useState(editingRecipe ? editingRecipe.fg : 1.01);
  const [ingredients, setIngredients] = useState(
    editingRecipe ? editingRecipe.ingredients.map((i) => ({ ...i })) : [{ id: uid(), name: "", category: "Grain", qty: 1, unit: "kg" }]
  );
  const [focusedIngredientId, setFocusedIngredientId] = useState(null);
  const [focusedScheduleId, setFocusedScheduleId] = useState(null);
  const [importError, setImportError] = useState("");
  const [schedule, setSchedule] = useState(editingRecipe ? (editingRecipe.schedule || []).map((s) => ({ ...s })) : []);
  const [efficiency, setEfficiency] = useState(editingRecipe ? editingRecipe.efficiency ?? 72 : 72);
  const [boilTime, setBoilTime] = useState(editingRecipe ? editingRecipe.boilTime ?? 60 : 60);
  const [sourceWaterPreset, setSourceWaterPreset] = useState("RO / Distilled");
  const [sourceWater, setSourceWater] = useState(
    editingRecipe?.waterChemistry?.sourceWater || WATER_PROFILE_PRESETS["RO / Distilled"]
  );
  const [targetWaterPreset, setTargetWaterPreset] = useState(editingRecipe?.waterChemistry?.targetPreset || "Balanced / Pale Ale");
  const [saltGrams, setSaltGrams] = useState(
    editingRecipe?.waterChemistry?.saltGrams || { gypsum: "", calciumChloride: "", epsomSalt: "", tableSalt: "", bakingSoda: "", chalk: "" }
  );
  const [showWaterChemistry, setShowWaterChemistry] = useState(!!editingRecipe?.waterChemistry);
  const [saving, setSaving] = useState(null);

  const addScheduleStep = () =>
    setSchedule((prev) => [...prev, { id: uid(), use: "Boil", time: 60, name: "", amount: 0, unit: "g" }]);

  const updateScheduleStep = (id, patch) =>
    setSchedule((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const removeScheduleStep = (id) => setSchedule((prev) => prev.filter((s) => s.id !== id));


  const handleImportFile = (file) => {
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseBeerXML(String(reader.result));
      if (!parsed) {
        setImportError("Couldn't read that as a BeerXML file — check it's the .xml export, not .bsmx or a zipped file.");
        return;
      }
      setName(parsed.name);
      setStyle(parsed.style);
      setVolume(parsed.volume);
      setOg(parsed.og);
      setFg(parsed.fg);
      setIngredients(parsed.ingredients.length > 0 ? parsed.ingredients : ingredients);
      setSchedule(parsed.schedule || []);
    };
    reader.onerror = () => setImportError("Couldn't read that file — try exporting it again.");
    reader.readAsText(file);
  };

  const updateLine = (id, patch) =>
    setIngredients((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () =>
    setIngredients((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 1, unit: "kg" }]);

  const removeLine = (id) => setIngredients((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const ingredientMatches = (query) =>
    query.trim().length === 0
      ? inventory
      : inventory.filter((it) => it.name.toLowerCase().includes(query.trim().toLowerCase()));

  const libraryMatches = (query) => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const maltMatches = MALT_LIBRARY_FLAT.filter((it) => it.name.toLowerCase().includes(q)).map((it) => ({ ...it, matchCategory: "Grain" }));
    const yeastMatches = YEAST_LIBRARY_FLAT.filter((it) => it.name.toLowerCase().includes(q)).map((it) => ({ ...it, matchCategory: "Yeast" }));
    return [...maltMatches, ...yeastMatches].slice(0, 8);
  };

  const styleMatches =
    style.trim().length === 0
      ? []
      : ALL_STYLES.filter((s) => s.name.toLowerCase().includes(style.trim().toLowerCase())).slice(0, 30);

  const calcEst = {
    og: calcOG(ingredients, Number(volume), Number(efficiency)),
  };
  calcEst.fg = calcFG(calcEst.og, ingredients.find((i) => i.category === "Yeast")?.attenuation);
  calcEst.abv = calcABV(calcEst.og, calcEst.fg);
  calcEst.ibu = calcIBU(schedule, Number(volume), calcEst.og);
  calcEst.srm = calcSRM(ingredients, Number(volume));

  const resultingWater = calcResultingWaterProfile(sourceWater, saltGrams, Number(volume));
  const residualAlkalinity = calcResidualAlkalinity(resultingWater);
  const targetProfile = WATER_PROFILE_PRESETS[targetWaterPreset];
  const sulfateChlorideRatio = resultingWater.cl > 0 ? (resultingWater.so4 / resultingWater.cl).toFixed(1) : "—";

  const submit = async () => {
    const clean = ingredients.filter((l) => l.name.trim());
    if (!name.trim() || clean.length === 0) return;
    const cleanSchedule = schedule
      .filter((s) => s.name.trim())
      .map((s) => ({ ...s, name: s.name.trim(), amount: Number(s.amount) || 0, label: buildScheduleLabel(s.use, s.time, s.name.trim()) }));
    setSaving("save");
    await onAdd({
      id: uid(),
      name: name.trim(),
      style: style.trim() || "Unspecified",
      volume: Number(volume) || 0,
      og: Number(og),
      fg: Number(fg),
      ingredients: clean.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
      schedule: cleanSchedule,
      familyId: editingRecipe ? editingRecipe.familyId : null,
      efficiency: Number(efficiency) || 72,
      boilTime: Number(boilTime) || 60,
      waterChemistry: showWaterChemistry ? { sourceWater, targetPreset: targetWaterPreset, saltGrams } : null,
    });
    setSaving(null);
    onClose();
  };

  const content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "none",
            border: "1px dashed #C9D1AC",
            borderRadius: 5,
            padding: "10px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <input
            type="file"
            accept=".xml"
            onChange={(e) => handleImportFile(e.target.files && e.target.files[0])}
            style={{ display: "none" }}
          />
          Import from BeerXML (Brewfather, BeerSmith, etc.)
        </label>
        {importError && (
          <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
            {importError}
          </div>
        )}
        <div style={{ color: "#9BA88A", fontSize: 11.5, textAlign: "center", margin: "-6px 0 2px" }}>— or fill in manually —</div>
        <TextField label="Recipe name" value={name} onChange={setName} />
        <div style={{ position: "relative" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
              Style — search BJCP & BA guides, or type your own
            </span>
            <input
              type="text"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              onFocus={() => setStyleFocused(true)}
              onBlur={() => setTimeout(() => setStyleFocused(false), 150)}
              placeholder="e.g. American IPA"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            />
          </label>
          {styleFocused && styleMatches.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: 4,
                maxHeight: 220,
                overflowY: "auto",
                background: "#F8F5EA",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                zIndex: 20,
              }}
            >
              {styleMatches.map((s) => (
                <button
                  key={`${s.source}-${s.name}`}
                  onMouseDown={() => {
                    setStyle(s.name);
                    setStyleFocused(false);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid #EBE8D6",
                    padding: "9px 10px",
                    color: "#2A3324",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <span>{s.name}</span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: "#9BA88A",
                      marginLeft: 8,
                      flexShrink: 0,
                    }}
                  >
                    {s.source}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Batch volume" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          <NumberField label="Target OG" value={og} onChange={setOg} step="0.001" />
          <NumberField label="Target FG" value={fg} onChange={setFg} step="0.001" />
          <NumberField label="Boil time" value={boilTime} onChange={setBoilTime} step="5" suffix="min" />
          <NumberField label="Mash efficiency" value={efficiency} onChange={setEfficiency} step="1" suffix="%" />
        </div>

        <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
            Estimated from your ingredient list
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {[
              ["OG", calcEst.og ? calcEst.og.toFixed(3) : "—"],
              ["FG", calcEst.fg ? calcEst.fg.toFixed(3) : "—"],
              ["ABV", calcEst.abv ? `${calcEst.abv.toFixed(1)}%` : "—"],
              ["IBU", calcEst.ibu ? Math.round(calcEst.ibu) : "—"],
              ["SRM", calcEst.srm ? calcEst.srm.toFixed(1) : "—"],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: "#9BA88A" }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#2A3324" }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#9BA88A", marginTop: 8, lineHeight: 1.4 }}>
            Fill in potential/color on grains, alpha acid on boil hops, and attenuation on yeast to see these — same as any brewing calculator, treat them as estimates.
          </div>
        </div>

        <button
          onClick={() => setShowWaterChemistry((v) => !v)}
          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
        >
          {showWaterChemistry ? "Hide water chemistry" : "Add water chemistry (optional)"}
        </button>

        {showWaterChemistry && (
          <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              Source water
            </div>
            <div style={{ marginBottom: 10 }}>
              <SelectField
                label="Start from a preset"
                value={sourceWaterPreset}
                onChange={(v) => {
                  setSourceWaterPreset(v);
                  setSourceWater(WATER_PROFILE_PRESETS[v]);
                }}
                options={Object.keys(WATER_PROFILE_PRESETS)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
              {["ca", "mg", "na", "cl", "so4", "hco3"].map((ion) => (
                <NumberField
                  key={ion}
                  label={`${ion.toUpperCase()} (ppm)`}
                  value={sourceWater[ion] ?? 0}
                  onChange={(v) => setSourceWater((prev) => ({ ...prev, [ion]: Number(v) || 0 }))}
                  step="1"
                />
              ))}
            </div>

            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              Salt additions (grams, for this whole batch)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {Object.entries(SALT_CONTRIBUTIONS).map(([key, salt]) => (
                <NumberField
                  key={key}
                  label={salt.label}
                  value={saltGrams[key] ?? ""}
                  onChange={(v) => setSaltGrams((prev) => ({ ...prev, [key]: v }))}
                  step="0.1"
                  suffix="g"
                />
              ))}
            </div>

            <div style={{ marginBottom: 10 }}>
              <SelectField
                label="Target profile (for reference)"
                value={targetWaterPreset}
                onChange={setTargetWaterPreset}
                options={Object.keys(WATER_PROFILE_PRESETS).filter((k) => k !== "RO / Distilled")}
              />
            </div>

            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                Resulting profile vs. target
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
                {["ca", "mg", "na", "cl", "so4", "hco3"].map((ion) => (
                  <div key={ion}>
                    <div style={{ fontSize: 10, color: "#9BA88A" }}>{ion.toUpperCase()}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: "#2A3324" }}>
                      {Math.round(resultingWater[ion] || 0)}
                      <span style={{ color: "#9BA88A", fontSize: 11 }}> / {targetProfile[ion]}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "#5C6B54" }}>
                Sulfate : Chloride ratio — <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{sulfateChlorideRatio}</span>
              </div>
              <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 4 }}>
                Residual alkalinity — <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{Math.round(residualAlkalinity)}</span> ppm as CaCO3
              </div>
              <div style={{ fontSize: 11, color: "#9BA88A", marginTop: 6, lineHeight: 1.4 }}>
                Lower residual alkalinity gives more room for pale/acidic grists; higher suits darker beers. This isn't a mash pH prediction — measure with a pH meter or strips on brew day.
              </div>
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginTop: 4 }}>
          Ingredients
        </div>
        {ingredients.map((line, i) => (
          <div
            key={line.id}
            style={{
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: "12px 12px 4px",
              position: "relative",
            }}
          >
            {ingredients.length > 1 && (
              <button
                onClick={() => removeLine(line.id)}
                aria-label="Remove ingredient"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "none",
                  border: "none",
                  color: "#5C6B54",
                  cursor: "pointer",
                  padding: 8,
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <div style={{ marginBottom: 10, position: "relative" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                  Ingredient {i + 1}
                </span>
                <input
                  type="text"
                  value={line.name}
                  onChange={(e) => updateLine(line.id, { name: e.target.value })}
                  onFocus={() => setFocusedIngredientId(line.id)}
                  onBlur={() => setTimeout(() => setFocusedIngredientId((cur) => (cur === line.id ? null : cur)), 150)}
                  placeholder="e.g. Maris Otter"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "#F5F1E4",
                    border: "1px solid #DDE0C8",
                    borderRadius: 4,
                    padding: "9px 10px",
                    color: "#2A3324",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 14,
                  }}
                />
              </label>
              {focusedIngredientId === line.id && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    maxHeight: 220,
                    overflowY: "auto",
                    background: "#F8F5EA",
                    border: "1px solid #DDE0C8",
                    borderRadius: 6,
                    zIndex: 20,
                  }}
                >
                  {libraryMatches(line.name).length > 0 && (
                    <>
                      <div style={{ padding: "6px 10px", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", background: "#F5F1E4" }}>
                        Reference library
                      </div>
                      {libraryMatches(line.name).map((it) => (
                        <button
                          key={`lib-${it.matchCategory}-${it.company}-${it.name}`}
                          onMouseDown={() => {
                            const extra =
                              it.matchCategory === "Grain"
                                ? { potential: it.potential, colorLovibond: it.colorLovibond }
                                : { attenuation: it.attenuation };
                            updateLine(line.id, { name: it.name, category: it.matchCategory, ...extra, libSourced: true });
                            setFocusedIngredientId(null);
                          }}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            width: "100%",
                            textAlign: "left",
                            background: "none",
                            border: "none",
                            borderBottom: "1px solid #EBE8D6",
                            padding: "9px 10px",
                            color: "#2A3324",
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          <span>{it.name}</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A", marginLeft: 8, flexShrink: 0 }}>
                            {it.company}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                  {ingredientMatches(line.name).map((it) => (
                    <button
                      key={it.id}
                      onMouseDown={() => {
                        updateLine(line.id, { name: it.name, category: it.category, unit: it.unit });
                        setFocusedIngredientId(null);
                      }}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        width: "100%",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        borderBottom: "1px solid #EBE8D6",
                        padding: "9px 10px",
                        color: "#2A3324",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      <span>{it.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9BA88A", marginLeft: 8, flexShrink: 0 }}>
                        {it.qty} {it.unit}
                      </span>
                    </button>
                  ))}
                  {line.name.trim().length > 0 &&
                    !inventory.some((it) => it.name.toLowerCase() === line.name.trim().toLowerCase()) && (
                      <button
                        onMouseDown={() => {
                          const newName = line.name.trim();
                          onAddInventoryItem({
                            id: uid(),
                            name: newName,
                            category: line.category,
                            qty: 0,
                            unit: line.unit,
                            threshold: 0,
                          });
                          setFocusedIngredientId(null);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          padding: "9px 10px",
                          color: "#5C9A3C",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        <Plus size={13} /> Add "{line.name.trim()}" to inventory
                      </button>
                    )}
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <SelectField label="Category" value={line.category} onChange={(v) => updateLine(line.id, { category: v })} options={CATEGORIES} />
              <SelectField label="Unit" value={line.unit} onChange={(v) => updateLine(line.id, { unit: v })} options={["kg", "g", "L", "ea"]} />
              <NumberField label="Quantity" value={line.qty} onChange={(v) => updateLine(line.id, { qty: v })} step="0.01" suffix={line.unit} />
              {line.category === "Grain" && (
                <>
                  {line.libSourced ? (
                    <>
                      <LockedField label="Potential (PPG)" value={line.potential} />
                      <LockedField label="Color" value={line.colorLovibond} suffix="°L" />
                    </>
                  ) : (
                    <>
                      <NumberField
                        label="Potential (PPG, optional)"
                        value={line.potential ?? ""}
                        onChange={(v) => updateLine(line.id, { potential: v })}
                        step="1"
                      />
                      <NumberField
                        label="Color (°L, optional)"
                        value={line.colorLovibond ?? ""}
                        onChange={(v) => updateLine(line.id, { colorLovibond: v })}
                        step="1"
                      />
                    </>
                  )}
                </>
              )}
              {line.category === "Yeast" && (
                <>
                  {line.libSourced ? (
                    <LockedField label="Attenuation" value={line.attenuation} suffix="%" />
                  ) : (
                    <NumberField
                      label="Attenuation % (optional)"
                      value={line.attenuation ?? ""}
                      onChange={(v) => updateLine(line.id, { attenuation: v })}
                      step="1"
                    />
                  )}
                </>
              )}
            </div>
            {line.libSourced && (
              <button
                onClick={() => updateLine(line.id, { libSourced: false })}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter', sans-serif", padding: "0 0 10px", display: "block" }}
              >
                From reference library — tap to edit manually
              </button>
            )}
          </div>
        ))}
        <button
          onClick={addLine}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "none",
            border: "1px dashed #C9D1AC",
            borderRadius: 5,
            padding: "9px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add ingredient
        </button>

        <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
            Brew day schedule — timed additions like hops or finings
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {schedule.map((s) => (
              <div key={s.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "8px 8px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <SelectField
                    label="When"
                    value={s.use}
                    onChange={(v) => updateScheduleStep(s.id, { use: v })}
                    options={["Boil", "Dry Hop", "Mash", "First Wort", "Other"]}
                  />
                  <NumberField
                    label={s.use === "Dry Hop" ? "Day" : "Minutes"}
                    value={s.time}
                    onChange={(v) => updateScheduleStep(s.id, { time: v })}
                    step="1"
                  />
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: (s.use === "Boil" || s.use === "First Wort") ? 8 : 0 }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                        What to add
                      </span>
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => updateScheduleStep(s.id, { name: e.target.value })}
                        onFocus={() => setFocusedScheduleId(s.id)}
                        onBlur={() => setTimeout(() => setFocusedScheduleId((cur) => (cur === s.id ? null : cur)), 150)}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: "#F5F1E4",
                          border: "1px solid #DDE0C8",
                          borderRadius: 4,
                          padding: "9px 10px",
                          color: "#2A3324",
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 14,
                        }}
                      />
                    </label>
                    {focusedScheduleId === s.id &&
                      HOP_LIBRARY_FLAT.filter((h) => h.name.toLowerCase().includes(s.name.trim().toLowerCase())).length > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            marginTop: 4,
                            maxHeight: 200,
                            overflowY: "auto",
                            background: "#F8F5EA",
                            border: "1px solid #DDE0C8",
                            borderRadius: 6,
                            zIndex: 20,
                          }}
                        >
                          {HOP_LIBRARY_FLAT.filter((h) => h.name.toLowerCase().includes(s.name.trim().toLowerCase()))
                            .slice(0, 8)
                            .map((h) => (
                              <button
                                key={`${h.company}-${h.name}`}
                                onMouseDown={() => {
                                  updateScheduleStep(s.id, { name: h.name, alphaAcid: h.alphaAcid, alphaSourced: true });
                                  setFocusedScheduleId(null);
                                }}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  width: "100%",
                                  textAlign: "left",
                                  background: "none",
                                  border: "none",
                                  borderBottom: "1px solid #EBE8D6",
                                  padding: "8px 10px",
                                  color: "#2A3324",
                                  fontSize: 13,
                                  cursor: "pointer",
                                }}
                              >
                                <span>{h.name}</span>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A", marginLeft: 8, flexShrink: 0 }}>
                                  {h.company} · {h.alphaAcid}% AA
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                  </div>
                  <div style={{ width: 64, flexShrink: 0 }}>
                    <NumberField label="Amt" value={s.amount} onChange={(v) => updateScheduleStep(s.id, { amount: v })} step="0.01" />
                  </div>
                  <div style={{ width: 60, flexShrink: 0 }}>
                    <SelectField label="Unit" value={s.unit || "g"} onChange={(v) => updateScheduleStep(s.id, { unit: v })} options={["g", "kg", "ea"]} />
                  </div>
                  <button
                    onClick={() => removeScheduleStep(s.id)}
                    aria-label="Remove schedule step"
                    style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: "0 6px 9px" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {(s.use === "Boil" || s.use === "First Wort") &&
                  (s.alphaSourced ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <LockedField label="Alpha acid (for IBU estimate)" value={s.alphaAcid} suffix="%" />
                      </div>
                      <button
                        onClick={() => updateScheduleStep(s.id, { alphaSourced: false })}
                        style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter', sans-serif", whiteSpace: "nowrap" }}
                      >
                        Edit manually
                      </button>
                    </div>
                  ) : (
                    <NumberField
                      label="Alpha acid % (optional, for IBU estimate)"
                      value={s.alphaAcid ?? ""}
                      onChange={(v) => updateScheduleStep(s.id, { alphaAcid: v })}
                      step="0.1"
                    />
                  ))}
              </div>
            ))}
            {schedule.length === 0 && (
              <div style={{ color: "#9BA88A", fontSize: 12.5 }}>No timed additions added yet.</div>
            )}
            <button
              onClick={addScheduleStep}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                background: "none",
                border: "1px dashed #C9D1AC",
                borderRadius: 5,
                padding: "8px",
                color: "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <Plus size={13} /> Add schedule step
            </button>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={!!saving}
          style={{
            marginTop: 4,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving === "save" ? "Saving…" : editingRecipe ? "Save as new version" : "Save recipe"}
        </button>
        {onSaveAndBrew && (
          <button
            onClick={async () => {
              const clean = ingredients.filter((l) => l.name.trim());
              if (!name.trim() || clean.length === 0) return;
              const cleanSchedule = schedule
                .filter((s) => s.name.trim())
                .map((s) => ({ ...s, name: s.name.trim(), amount: Number(s.amount) || 0, label: buildScheduleLabel(s.use, s.time, s.name.trim()) }));
              setSaving("brew");
              await onSaveAndBrew({
                id: uid(),
                name: name.trim(),
                style: style.trim() || "Unspecified",
                volume: Number(volume) || 0,
                og: Number(og),
                fg: Number(fg),
                ingredients: clean.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
                schedule: cleanSchedule,
                familyId: editingRecipe ? editingRecipe.familyId : null,
                efficiency: Number(efficiency) || 72,
                boilTime: Number(boilTime) || 60,
                waterChemistry: showWaterChemistry ? { sourceWater, targetPreset: targetWaterPreset, saltGrams } : null,
              });
              setSaving(null);
            }}
            disabled={!!saving}
            style={{
              background: "none",
              border: "1px solid #5C9A3C",
              borderRadius: 5,
              padding: "12px",
              color: saving ? "#A3AC94" : "#5C9A3C",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 15,
              letterSpacing: "0.03em",
              cursor: saving ? "default" : "pointer",
            }}
          >
            {saving === "brew" ? "Saving…" : "Save & brew this recipe"}
          </button>
        )}
    </div>
  );

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (name.trim().length > 0) { setConfirmDiscard(true); return; }
    onClose();
  };

  if (standalone) {
    return (
      <>
      <div style={{ maxWidth: 640 }}>
        <button
          onClick={requestClose}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "none",
            border: "none",
            color: "#5C6B54",
            cursor: "pointer",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            padding: 0,
            marginBottom: 18,
          }}
        >
          <ChevronLeft size={16} /> Back
        </button>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: "0 0 16px", fontWeight: 500 }}>
          Recipe Builder
        </h1>
        {content}
      </div>
      {confirmDiscard && (
        <ConfirmDialogModal
          message="Discard this recipe? Your entries won't be saved."
          confirmLabel="Discard"
          destructive
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={() => { setConfirmDiscard(false); onClose(); }}
        />
      )}
      </>
    );
  }

  return (
    <>
    <Modal title={editingRecipe ? `Save new version — ${editingRecipe.name}` : "New recipe"} onClose={requestClose}>
      {content}
    </Modal>
    {confirmDiscard && (
      <ConfirmDialogModal
        message="Discard this recipe? Your entries won't be saved."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
      />
    )}
    </>
  );
}

function ScaleRecipeModal({ recipe, onClose, onScale }) {
  const [newVolume, setNewVolume] = useState(recipe.volume);

  const submit = () => {
    if (!newVolume || Number(newVolume) <= 0) return;
    onScale(recipe, Number(newVolume));
    onClose();
  };

  return (
    <Modal title={`Scale ${recipe.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
          Currently brewed at {recipe.volume}L. This scales every ingredient, hop addition, and salt addition proportionally, and saves it as a new version.
        </div>
        <NumberField label="New batch volume" value={newVolume} onChange={setNewVolume} step="0.5" suffix="L" />
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Create scaled version
        </button>
      </div>
    </Modal>
  );
}

function RecipeDetail({ recipe, inventory, onBack, onBrew, onDelete, versions, onSwitchVersion, onEdit, onSetActive, onScale }) {
  const shortages = recipe.ingredients.filter((ing) => {
    const stock = inventory.find((it) => it.name.toLowerCase() === ing.name.toLowerCase());
    return !stock || stock.qty < ing.qty;
  });

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All recipes
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: "2px 0 6px", fontWeight: 500 }}>
          {recipe.name}
        </h1>
        {recipe.isActive && versions.length > 1 && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#D9A441",
              border: "1px solid #E3D3A0",
              borderRadius: 3,
              padding: "3px 7px",
            }}
          >
            In use
          </span>
        )}
      </div>
      <div style={{ color: "#5C6B54", fontSize: 14, marginBottom: 12 }}>
        {recipe.style} · {recipe.volume}L · OG {recipe.og.toFixed(3)} → FG {recipe.fg.toFixed(3)}
      </div>

      {(() => {
        const calcOgVal = calcOG(recipe.ingredients, recipe.volume, recipe.efficiency);
        const calcFgVal = calcFG(calcOgVal, recipe.ingredients.find((i) => i.category === "Yeast")?.attenuation);
        const calcAbv = calcABV(calcOgVal, calcFgVal);
        const calcIbuVal = calcIBU(recipe.schedule, recipe.volume, calcOgVal);
        const calcSrmVal = calcSRM(recipe.ingredients, recipe.volume);
        if (!calcAbv && !calcIbuVal && !calcSrmVal) return null;
        return (
          <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
            {calcAbv && (
              <div>
                <div style={{ fontSize: 10, color: "#9BA88A" }}>Est. ABV</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#2A3324" }}>{calcAbv.toFixed(1)}%</div>
              </div>
            )}
            {calcIbuVal && (
              <div>
                <div style={{ fontSize: 10, color: "#9BA88A" }}>Est. IBU</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#2A3324" }}>{Math.round(calcIbuVal)}</div>
              </div>
            )}
            {calcSrmVal && (
              <div>
                <div style={{ fontSize: 10, color: "#9BA88A" }}>Est. SRM</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: "#2A3324" }}>{calcSrmVal.toFixed(1)}</div>
              </div>
            )}
          </div>
        );
      })()}

      {versions.length > 1 && (
        <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
            Version
          </span>
          <select
            value={recipe.id}
            onChange={(e) => onSwitchVersion(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#2A3324",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}{v.isActive ? " (active)" : v.id === versions[0].id ? " (latest)" : ""}
                {v.createdAt ? ` — ${v.createdAt.slice(0, 10)}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Ingredients
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
        {recipe.ingredients.map((ing) => {
          const stock = inventory.find((it) => it.name.toLowerCase() === ing.name.toLowerCase());
          const short = !stock || stock.qty < ing.qty;
          return (
            <div
              key={ing.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "10px 12px",
                background: "#F8F5EA",
                border: `1px solid ${short ? "#E3D3A0" : "#EBE8D6"}`,
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>{ing.name}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[ing.category], fontSize: 11 }}>
                {ing.category}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", width: 64, textAlign: "right", flexShrink: 0 }}>
                {formatQty(ing.qty, ing.unit)}
              </span>
              {short && <AlertTriangle size={13} color="#5C9A3C" />}
            </div>
          );
        })}
      </div>

      {shortages.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#5C9A3C",
            fontSize: 12.5,
            marginBottom: 14,
            background: "#FCF1DC",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "8px 12px",
          }}
        >
          <AlertTriangle size={14} />
          Short on {shortages.length} ingredient{shortages.length !== 1 ? "s" : ""} — you can still brew, but stock will go negative-adjusted to zero.
        </div>
      )}

      {recipe.schedule && recipe.schedule.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Brew day schedule
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...recipe.schedule].sort(compareScheduleItems).map((s) => (
              <div
                key={s.id}
                style={{
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13,
                  color: "#2A3324",
                }}
              >
                {s.label} <span style={{ color: "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>({s.amount} {s.unit})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onBrew(recipe)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          background: "#5C9A3C",
          border: "none",
          borderRadius: 5,
          padding: "12px",
          color: "#16191A",
          fontFamily: "'Oswald', sans-serif",
          fontWeight: 500,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        <Beaker size={16} /> Brew this recipe
      </button>

      {!recipe.isActive && (
        <button
          onClick={() => onSetActive(recipe.id, recipe.familyId)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
            marginTop: 10,
          }}
        >
          Set v{recipe.version} as the version to use
        </button>
      )}

      <button
        onClick={() => onEdit(recipe)}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "11px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 10,
        }}
      >
        Edit — save as new version
      </button>

      <button
        onClick={() => onScale(recipe)}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "11px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 10,
        }}
      >
        Scale to a different batch size
      </button>

      <button
        onClick={() => window.print()}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "11px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 10,
        }}
      >
        <FileText size={14} /> Print / Save as PDF
      </button>

      <button
        onClick={() => onDelete(recipe)}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid #E3D3A0",
          borderRadius: 5,
          padding: "11px",
          color: "#5C9A3C",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 10,
        }}
      >
        Delete recipe
      </button>

      {(() => {
        const calcOgVal = calcOG(recipe.ingredients, recipe.volume, recipe.efficiency);
        const calcFgVal = calcFG(calcOgVal, recipe.ingredients.find((i) => i.category === "Yeast")?.attenuation);
        const calcAbv = calcABV(calcOgVal, calcFgVal);
        const calcIbuVal = calcIBU(recipe.schedule, recipe.volume, calcOgVal);
        const calcSrmVal = calcSRM(recipe.ingredients, recipe.volume);
        return (
          <div className="bp-print-sheet" style={{ display: "none" }}>
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, margin: "0 0 2px" }}>{recipe.name}</h1>
            <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>
              {recipe.style} · {recipe.volume}L batch
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 13 }}>
              <tbody>
                <tr><td style={{ padding: "4px 0", color: "#555", width: "40%" }}>Target OG / FG</td><td>{recipe.og.toFixed(3)} / {recipe.fg.toFixed(3)}</td></tr>
                {calcAbv > 0 && <tr><td style={{ padding: "4px 0", color: "#555" }}>Est. ABV</td><td>{calcAbv.toFixed(1)}%</td></tr>}
                {calcIbuVal > 0 && <tr><td style={{ padding: "4px 0", color: "#555" }}>Est. IBU</td><td>{calcIbuVal.toFixed(0)}</td></tr>}
                {calcSrmVal > 0 && <tr><td style={{ padding: "4px 0", color: "#555" }}>Est. SRM</td><td>{calcSrmVal.toFixed(1)}</td></tr>}
                <tr><td style={{ padding: "4px 0", color: "#555" }}>Mash efficiency</td><td>{recipe.efficiency}%</td></tr>
                <tr><td style={{ padding: "4px 0", color: "#555" }}>Boil time</td><td>{recipe.boilTime} min</td></tr>
              </tbody>
            </table>

            {recipe.ingredients && recipe.ingredients.length > 0 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Ingredients</div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
                  <tbody>
                    {recipe.ingredients.map((ing, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ padding: "4px 0" }}>{ing.name}</td>
                        <td style={{ padding: "4px 0", color: "#555" }}>{ing.category}</td>
                        <td style={{ padding: "4px 0", textAlign: "right" }}>{ing.qty} {ing.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {recipe.schedule && recipe.schedule.length > 0 && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Schedule</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <tbody>
                    {recipe.schedule.map((s, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                        <td style={{ padding: "4px 0" }}>{s.label || s.name}</td>
                        <td style={{ padding: "4px 0", color: "#555" }}>{s.time != null ? `${s.time} min` : ""}</td>
                        <td style={{ padding: "4px 0", textAlign: "right" }}>{s.amount ? `${s.amount} ${s.unit || ""}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {recipe.waterChemistry && (
              <>
                <div style={{ fontWeight: 600, fontSize: 13, margin: "16px 0 6px" }}>Water chemistry</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <tbody>
                    <tr><td style={{ padding: "4px 0", color: "#555" }}>Target profile</td><td>{recipe.waterChemistry.targetPreset}</td></tr>
                    {Object.entries(recipe.waterChemistry.saltGrams || {})
                      .filter(([, v]) => v)
                      .map(([salt, grams]) => (
                        <tr key={salt} style={{ borderBottom: "1px solid #ddd" }}>
                          <td style={{ padding: "4px 0", color: "#555" }}>{salt}</td>
                          <td style={{ padding: "4px 0" }}>{grams} g</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function LockedField({ label, value, suffix }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</span>
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#EBE8D6",
          border: "1px solid #DDE0C8",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
        }}
      >
        {value ?? "—"}
        {suffix ? ` ${suffix}` : ""}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, step = "any", suffix }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            e.target.select();
            scrollFieldIntoView(e);
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 4,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
          }}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 10, top: 9, color: "#9BA88A", fontSize: 12 }}>{suffix}</span>
        )}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={scrollFieldIntoView}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F5F1E4",
          border: "1px solid #DDE0C8",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#2A3324",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
        }}
      />
    </label>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,12,11,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "24px 18px",
        animation: "bp-modal-overlay-in 160ms ease-out",
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes bp-modal-overlay-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bp-modal-panel-in { from { opacity: 0; transform: scale(0.96) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#F8F5EA",
          border: "1px solid #DDE0C8",
          borderRadius: 10,
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          overflowY: "auto",
          padding: "20px 22px 26px",
          animation: "bp-modal-panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>
            {title}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 10 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A styled stand-in for window.confirm() — everywhere the app needs a
// "are you sure?" check, this keeps it looking like the rest of Brewpoint
// instead of the browser's plain OS-level alert box.
function ConfirmDialogModal({ title = "Are you sure?", message, confirmLabel = "Confirm", destructive = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5, margin: 0 }}>{message}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              background: "none",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              background: destructive ? "#B5502F" : "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px",
              color: destructive ? "#FFFFFF" : "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13.5,
              letterSpacing: "0.02em",
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddBatchModal({ onClose, onAdd, nextNumber, recipes, presetRecipe, tanks, batches, inventory, onAddInventoryItem, presetTankId, presetStartDate }) {
  const mashTuns = tanks.filter((t) => t.type === "Mash Tun");
  const tankChoices = mashTuns.length > 0 ? mashTuns : tanks;
  const [recipeId, setRecipeId] = useState(presetRecipe ? presetRecipe.id : "");
  const [name, setName] = useState(presetRecipe ? presetRecipe.name : "");
  const [style, setStyle] = useState(presetRecipe ? presetRecipe.style : "");
  const [volume, setVolume] = useState(presetRecipe ? presetRecipe.volume : 20);
  const [og, setOg] = useState(presetRecipe ? presetRecipe.og : 1.05);
  const [fg, setFg] = useState(presetRecipe ? presetRecipe.fg : 1.01);
  const [temp, setTemp] = useState(20);
  const [tankId, setTankId] = useState(() => {
    if (presetTankId) return presetTankId;
    try {
      return localStorage.getItem("brewpoint-last-tank") || "";
    } catch {
      return "";
    }
  });
  const [startDate, setStartDate] = useState(presetStartDate || today());
  const [batchNumber, setBatchNumber] = useState(nextNumber);
  const [plannedDays, setPlannedDays] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splitRows, setSplitRows] = useState([{ id: uid(), tankId: "", volume: "" }]);
  const [nameFocused, setNameFocused] = useState(false);
  const [batchIngredients, setBatchIngredients] = useState(
    presetRecipe ? presetRecipe.ingredients.map((i) => ({ ...i })) : []
  );
  const [batchSchedule, setBatchSchedule] = useState(
    presetRecipe ? (presetRecipe.schedule || []).map((s) => ({ ...s, done: false, doneAt: null })) : []
  );

  const activeRecipe = recipes.find((r) => r.id === recipeId) || null;

  const applyRecipe = (id) => {
    setRecipeId(id);
    const r = recipes.find((rec) => rec.id === id);
    if (r) {
      setName(r.name);
      setStyle(r.style);
      setVolume(r.volume);
      setOg(r.og);
      setFg(r.fg);
      setBatchIngredients(r.ingredients.map((i) => ({ ...i })));
      setBatchSchedule((r.schedule || []).map((s) => ({ ...s, done: false, doneAt: null })));
    }
  };

  const updateBatchIngredient = (id, patch) =>
    setBatchIngredients((prev) => prev.map((ing) => (ing.id === id ? { ...ing, ...patch } : ing)));

  const addBatchIngredientRow = () =>
    setBatchIngredients((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 0, unit: "kg" }]);

  const removeBatchIngredientRow = (id) =>
    setBatchIngredients((prev) => prev.filter((ing) => ing.id !== id));

  const [focusedBatchIngredientId, setFocusedBatchIngredientId] = useState(null);

  const batchIngredientMatches = (query) =>
    query.trim().length === 0
      ? inventory
      : inventory.filter((it) => it.name.toLowerCase().includes(query.trim().toLowerCase()));

  const stockFor = (ingName) => {
    const item = inventory.find((it) => it.name.toLowerCase() === ingName.toLowerCase());
    return item ? item.qty : null;
  };

  const addSplitRow = () => setSplitRows((prev) => [...prev, { id: uid(), tankId: "", volume: "" }]);
  const updateSplitRow = (id, patch) =>
    setSplitRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeSplitRow = (id) => setSplitRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  const splitTotal = splitRows.reduce((sum, r) => sum + (Number(r.volume) || 0), 0);
  const noSingleTankFits =
    !splitMode &&
    tanks.length > 0 &&
    Number(volume) > 0 &&
    !tanks.some((t) => (!tankIsOccupied(batches, t.id) || startDate > today()) && t.capacity >= Number(volume));

  const selectedTank = tanks.find((t) => t.id === tankId) || null;
  const blockReason =
    !splitMode && selectedTank && tankIsOccupied(batches, selectedTank.id) && startDate <= today()
      ? `${selectedTank.name} is currently occupied by ${occupyingBatch(batches, selectedTank.id)?.name || "another batch"} — pick a later date or a different tank.`
      : splitMode && startDate <= today() && splitRows.some((r) => r.tankId && tankIsOccupied(batches, r.tankId))
      ? "One of the tanks you've chosen is currently occupied — pick a later date or different tanks."
      : batches.some((b) => b.number === batchNumber.trim())
      ? `Batch #${batchNumber.trim()} already exists — pick a different number.`
      : null;

  const searchableRecipes = activeRecipesByFamily(recipes);
  const nameMatches =
    name.trim().length === 0
      ? searchableRecipes
      : searchableRecipes.filter((r) => r.name.toLowerCase().includes(name.trim().toLowerCase()));

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    if (blockReason) return;
    const tank = tanks.find((t) => t.id === tankId) || null;
    if (tank) {
      try {
        localStorage.setItem("brewpoint-last-tank", tank.id);
      } catch {}
    }
    let finalSplitTanks = [];
    if (splitMode) {
      finalSplitTanks = splitRows
        .filter((r) => r.tankId && Number(r.volume) > 0)
        .map((r) => {
          const t = tanks.find((tk) => tk.id === r.tankId);
          return { tankId: r.tankId, tankName: t ? t.name : "", volume: Number(r.volume) || 0 };
        });
    }
    const cleanBatchIngredients = batchIngredients.filter((ing) => ing.name.trim().length > 0 && Number(ing.qty) > 0);
    const mashSteps = cleanBatchIngredients
      .filter((ing) => ing.category === "Grain")
      .map((ing) => ({
        id: uid(),
        use: "Mash",
        time: null,
        name: ing.name,
        amount: ing.qty,
        unit: ing.unit,
        label: buildScheduleLabel("Mash", null, ing.name),
        done: false,
        doneAt: null,
      }));
    setSaving(true);
    await onAdd({
      id: uid(),
      number: batchNumber.trim() || nextNumber,
      name: name.trim(),
      style: style.trim() || "Unspecified",
      volume: Number(volume) || 0,
      og: Number(og),
      fg: Number(fg),
      mashPh: null,
      mashTemp: null,
      preBoilGravity: null,
      topUpWater: null,
      phIntoTank: null,
      sgIntoTank: null,
      stage: "Brewing",
      startDate: startDate || today(),
      recipeId: activeRecipe ? activeRecipe.id : null,
      recipeName: activeRecipe ? activeRecipe.name : null,
      tankId: splitMode ? null : tank ? tank.id : null,
      tankName: splitMode ? null : tank ? tank.name : null,
      brewStage: !splitMode && tank && tank.type === "Mash Tun" ? "Mashing" : null,
      splitTanks: splitMode ? finalSplitTanks : [],
      ingredients: cleanBatchIngredients,
      schedule: [...mashSteps, ...batchSchedule],
      readings: [{ id: uid(), date: startDate || today(), gravity: Number(og), temp: Number(temp), note: "Brew day, pitched yeast" }],
      plannedDays: plannedDays === "" ? null : Number(plannedDays),
    });
    setSaving(false);
    onClose();
  };

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (name.trim().length > 0) { setConfirmDiscard(true); return; }
    onClose();
  };

  return (
    <>
    <Modal title="New Batch" onClose={requestClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
            Brew date
          </span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          />
          {startDate > today() && (
            <span style={{ color: "#9BA88A", fontSize: 11.5 }}>
              This is in the future — the batch is created now to reserve the tank and hold a spot on the schedule.
            </span>
          )}
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
            Batch number
          </span>
          <input
            type="text"
            value={batchNumber}
            onChange={(e) => setBatchNumber(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#2A3324",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
            }}
          />
          <span style={{ color: "#9BA88A", fontSize: 11.5 }}>
            Defaults to the next number in sequence — change it to start counting from somewhere else.
          </span>
        </label>
        <NumberField
          label="Estimated days in tank (optional)"
          value={plannedDays}
          onChange={setPlannedDays}
          step="1"
          suffix="days"
        />
        {tanks.length > 0 && (
          <div>
            {!splitMode ? (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                    {mashTuns.length > 0 ? "Mash tun (optional)" : "Tank (optional)"}
                  </span>
                  <select
                    value={tankId}
                    onChange={(e) => setTankId(e.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 4,
                      padding: "9px 10px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                    }}
                  >
                    <option value="">Unassigned</option>
                    {sortedTanks(tankChoices).map((t) => {
                      const currentlyOccupied = tankIsOccupied(batches, t.id);
                      const occupied = currentlyOccupied && startDate <= today();
                      const occupant = currentlyOccupied ? occupyingBatch(batches, t.id) : null;
                      return (
                        <option key={t.id} value={t.id} disabled={occupied}>
                          {t.name} ({t.capacity}L)
                          {occupied ? ` — occupied by ${occupant?.name || "another batch"}` : ""}
                          {!occupied && currentlyOccupied ? ` — currently in use by ${occupant?.name || "another batch"}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {!splitMode && tankId && startDate > today() && tankIsOccupied(batches, tankId) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#5C9A3C", fontSize: 12, marginTop: -4 }}>
                    <AlertTriangle size={12} />
                    This tank is currently in use — make sure it'll be free by {startDate}.
                  </div>
                )}
                {noSingleTankFits && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#5C9A3C", fontSize: 12, marginBottom: 8 }}>
                      <AlertTriangle size={12} />
                      No single free tank holds {volume}L.
                    </div>
                    <button
                      onClick={() => setSplitMode(true)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        width: "100%",
                        background: "#FCF1DC",
                        border: "1px solid #E3D3A0",
                        borderRadius: 5,
                        padding: "10px",
                        color: "#5C9A3C",
                        fontFamily: "'Oswald', sans-serif",
                        fontWeight: 500,
                        fontSize: 13.5,
                        cursor: "pointer",
                      }}
                    >
                      Split across multiple tanks
                    </button>
                  </div>
                )}
                {!noSingleTankFits && (
                  <button
                    onClick={() => setSplitMode(true)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 7,
                      width: "100%",
                      background: "#EBE8D6",
                      border: "1px solid #C9D1AC",
                      borderRadius: 5,
                      padding: "9px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12.5,
                      cursor: "pointer",
                      marginTop: 8,
                    }}
                  >
                    Split this batch across multiple tanks instead
                  </button>
                )}
              </>
            ) : (
              <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
                    Split across tanks
                  </span>
                  <button
                    onClick={() => {
                      setSplitMode(false);
                      setSplitRows([{ id: uid(), tankId: "", volume: "" }]);
                    }}
                    style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 11.5, padding: 0 }}
                  >
                    Use one tank instead
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {splitRows.map((row) => {
                    const rowTank = tanks.find((t) => t.id === row.tankId);
                    const overCapacity = rowTank && Number(row.volume) > rowTank.capacity;
                    return (
                      <div key={row.id}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <select
                            value={row.tankId}
                            onChange={(e) => updateSplitRow(row.id, { tankId: e.target.value })}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              boxSizing: "border-box",
                              background: "#FFFFFF",
                              border: "1px solid #DDE0C8",
                              borderRadius: 4,
                              padding: "8px 8px",
                              color: "#2A3324",
                              fontFamily: "'Inter', sans-serif",
                              fontSize: 13,
                            }}
                          >
                            <option value="">Choose tank</option>
                            {sortedTanks(tanks).map((t) => {
                              const currentlyOccupied = tankIsOccupied(batches, t.id);
                              const usedAbove = splitRows.some((r) => r.id !== row.id && r.tankId === t.id);
                              const occupied = (currentlyOccupied && startDate <= today()) || usedAbove;
                              const occupant = currentlyOccupied ? occupyingBatch(batches, t.id) : null;
                              return (
                                <option key={t.id} value={t.id} disabled={occupied}>
                                  {t.name} ({t.capacity}L){usedAbove ? " — already used above" : occupant && occupied ? ` — occupied by ${occupant.name}` : occupant ? ` — currently in use by ${occupant.name}` : ""}
                                </option>
                              );
                            })}
                          </select>
                          <input
                            type="number"
                            step="0.1"
                            value={row.volume}
                            onChange={(e) => updateSplitRow(row.id, { volume: e.target.value })}
                            placeholder="Litres"
                            style={{
                              width: 84,
                              flexShrink: 0,
                              boxSizing: "border-box",
                              background: "#FFFFFF",
                              border: `1px solid ${overCapacity ? "#E3D3A0" : "#DDE0C8"}`,
                              borderRadius: 4,
                              padding: "8px 8px",
                              color: overCapacity ? "#5C9A3C" : "#2A3324",
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 13,
                              textAlign: "right",
                            }}
                          />
                          <button
                            onClick={() => removeSplitRow(row.id)}
                            aria-label="Remove tank"
                            style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 8, flexShrink: 0 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {overCapacity && (
                          <div style={{ color: "#5C9A3C", fontSize: 11, marginTop: 3 }}>
                            Exceeds {rowTank.name}'s {rowTank.capacity}L capacity.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={addSplitRow}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    width: "100%",
                    background: "none",
                    border: "1px dashed #C9D1AC",
                    borderRadius: 5,
                    padding: "8px",
                    color: "#5C6B54",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12.5,
                    cursor: "pointer",
                    marginTop: 8,
                  }}
                >
                  <Plus size={13} /> Add another tank
                </button>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontSize: 12,
                    color: Math.abs(splitTotal - Number(volume)) > 0.01 ? "#5C9A3C" : "#D9A441",
                  }}
                >
                  <span>Allocated</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{splitTotal.toFixed(1)}L of {Number(volume) || 0}L</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ position: "relative" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
              Batch name — pick a recipe or type your own
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setRecipeId("");
                setBatchIngredients([]);
                setBatchSchedule([]);
              }}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setTimeout(() => setNameFocused(false), 150)}
              placeholder="e.g. Foghorn Amber"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            />
          </label>
          {nameFocused && recipes.length > 0 && nameMatches.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                marginTop: 4,
                maxHeight: 220,
                overflowY: "auto",
                background: "#F8F5EA",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                zIndex: 20,
              }}
            >
              {nameMatches.map((r) => (
                <button
                  key={r.id}
                  onMouseDown={() => {
                    applyRecipe(r.id);
                    setNameFocused(false);
                  }}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid #EBE8D6",
                    padding: "9px 10px",
                    color: "#2A3324",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <span>{r.name}</span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      color: "#9BA88A",
                      marginLeft: 8,
                      flexShrink: 0,
                    }}
                  >
                    {r.style}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <TextField label="Style" value={style} onChange={setStyle} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Volume" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          <NumberField label="Pitch temp" value={temp} onChange={setTemp} step="0.5" suffix="°C" />
          <NumberField label="Original gravity" value={og} onChange={setOg} step="0.001" />
          <NumberField label="Target FG" value={fg} onChange={setFg} step="0.001" />
        </div>
        <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
            Ingredients — swap, adjust, or add extras for this brew day
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {batchIngredients.map((ing) => {
              const stock = stockFor(ing.name);
              const short = ing.name.trim().length > 0 && stock != null && Number(ing.qty) > stock;
              return (
                <div key={ing.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "8px 8px" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                      <input
                        type="text"
                        value={ing.name}
                        onChange={(e) => updateBatchIngredient(ing.id, { name: e.target.value })}
                        onFocus={() => setFocusedBatchIngredientId(ing.id)}
                        onBlur={() => setTimeout(() => setFocusedBatchIngredientId((cur) => (cur === ing.id ? null : cur)), 150)}
                        placeholder="Ingredient name"
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: "#F5F1E4",
                          border: "1px solid #DDE0C8",
                          borderRadius: 4,
                          padding: "8px 9px",
                          color: "#2A3324",
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 13,
                        }}
                      />
                      {focusedBatchIngredientId === ing.id && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            marginTop: 4,
                            maxHeight: 200,
                            overflowY: "auto",
                            background: "#F8F5EA",
                            border: "1px solid #DDE0C8",
                            borderRadius: 6,
                            zIndex: 20,
                          }}
                        >
                          {batchIngredientMatches(ing.name).map((it) => (
                            <button
                              key={it.id}
                              onMouseDown={() => {
                                updateBatchIngredient(ing.id, { name: it.name, category: it.category, unit: it.unit });
                                setFocusedBatchIngredientId(null);
                              }}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                width: "100%",
                                textAlign: "left",
                                background: "none",
                                border: "none",
                                borderBottom: "1px solid #EBE8D6",
                                padding: "8px 9px",
                                color: "#2A3324",
                                fontSize: 12.5,
                                cursor: "pointer",
                              }}
                            >
                              <span>{it.name}</span>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#9BA88A", marginLeft: 8, flexShrink: 0 }}>
                                {it.qty} {it.unit}
                              </span>
                            </button>
                          ))}
                          {ing.name.trim().length > 0 &&
                            !inventory.some((it) => it.name.toLowerCase() === ing.name.trim().toLowerCase()) && (
                              <button
                                onMouseDown={() => {
                                  const newName = ing.name.trim();
                                  onAddInventoryItem({ id: uid(), name: newName, category: ing.category, qty: 0, unit: ing.unit, threshold: 0 });
                                  setFocusedBatchIngredientId(null);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  width: "100%",
                                  textAlign: "left",
                                  background: "none",
                                  border: "none",
                                  padding: "8px 9px",
                                  color: "#5C9A3C",
                                  fontSize: 12.5,
                                  cursor: "pointer",
                                }}
                              >
                                <Plus size={12} /> Add "{ing.name.trim()}" to inventory
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      value={ing.qty}
                      onChange={(e) => updateBatchIngredient(ing.id, { qty: e.target.value })}
                      style={{
                        width: 64,
                        flexShrink: 0,
                        boxSizing: "border-box",
                        background: "#F5F1E4",
                        border: `1px solid ${short ? "#E3D3A0" : "#DDE0C8"}`,
                        borderRadius: 4,
                        padding: "8px 6px",
                        color: short ? "#5C9A3C" : "#2A3324",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 12.5,
                        textAlign: "right",
                      }}
                    />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 11.5, width: 24, flexShrink: 0, paddingTop: 9 }}>
                      {ing.unit}
                    </span>
                    <button
                      onClick={() => removeBatchIngredientRow(ing.id)}
                      aria-label="Remove ingredient"
                      style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: "6px 8px 0", flexShrink: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {short && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#5C9A3C", fontSize: 11.5, marginTop: 6 }}>
                      <AlertTriangle size={11} /> Only {stock} {ing.unit} in stock — adjust the amount or top up inventory first.
                    </div>
                  )}
                </div>
              );
            })}
            {batchIngredients.length === 0 && (
              <div style={{ color: "#9BA88A", fontSize: 12.5 }}>No ingredients added yet.</div>
            )}
            <button
              onClick={addBatchIngredientRow}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                background: "none",
                border: "1px dashed #C9D1AC",
                borderRadius: 5,
                padding: "8px",
                color: "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <Plus size={13} /> Add ingredient
            </button>
          </div>
        </div>
        {blockReason && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#5C9A3C", fontSize: 12, marginTop: -4 }}>
            <AlertTriangle size={12} />
            {blockReason}
          </div>
        )}
        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 8,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : startDate > today() ? `Schedule batch #${batchNumber.trim() || nextNumber}` : `Start batch #${batchNumber.trim() || nextNumber}`}
        </button>
      </div>
    </Modal>
    {confirmDiscard && (
      <ConfirmDialogModal
        message="Discard this batch? Your entries won't be saved."
        confirmLabel="Discard"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => { setConfirmDiscard(false); onClose(); }}
      />
    )}
    </>
  );
}

function DiacetylTestModal({ batch, onClose, onLog }) {
  const [result, setResult] = useState(null);
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!result) return;
    onLog(batch.id, { id: uid(), date: new Date().toISOString(), result, notes: notes.trim() });
    onClose();
  };

  return (
    <Modal title={`Diacetyl test — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => setResult("pass")}
            style={{
              flex: 1,
              background: result === "pass" ? "#5C9A3C" : "none",
              border: `1px solid ${result === "pass" ? "#5C9A3C" : "#DDE0C8"}`,
              borderRadius: 5,
              padding: "14px",
              color: result === "pass" ? "#16191A" : "#2A3324",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Pass
          </button>
          <button
            onClick={() => setResult("fail")}
            style={{
              flex: 1,
              background: result === "fail" ? "#B5502F" : "none",
              border: `1px solid ${result === "fail" ? "#B5502F" : "#DDE0C8"}`,
              borderRadius: 5,
              padding: "14px",
              color: result === "fail" ? "#2A3324" : "#2A3324",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Fail
          </button>
        </div>
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={!result}
          style={{
            background: result ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: result ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: result ? "pointer" : "default",
          }}
        >
          Save test result
        </button>
      </div>
    </Modal>
  );
}

function LogReadingModal({ batch, onClose, onLog }) {
  const [gravity, setGravity] = useState(latestReading(batch).gravity);
  const [temp, setTemp] = useState(latestReading(batch).temp);
  const [ph, setPh] = useState(latestReading(batch).ph ?? "");
  const [note, setNote] = useState("");

  const submit = () => {
    onLog(batch.id, { id: uid(), date: today(), gravity: Number(gravity), temp: Number(temp), ph: ph === "" ? null : Number(ph), note: note.trim() });
    onClose();
  };

  return (
    <Modal title={`Log reading — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Gravity" value={gravity} onChange={setGravity} step="0.001" />
          <NumberField label="Temp" value={temp} onChange={setTemp} step="0.5" suffix="°C" />
          <NumberField label="pH (optional)" value={ph} onChange={setPh} step="0.01" />
        </div>
        <TextField label="Note (optional)" value={note} onChange={setNote} />
        <button
          onClick={submit}
          style={{
            marginTop: 8,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save reading
        </button>
      </div>
    </Modal>
  );
}

function EditBrewDayFieldModal({ target, onClose, onSave }) {
  const [value, setValue] = useState(target.value ?? "");

  const submit = () => {
    onSave(target.batch.id, target.field, value === "" ? null : Number(value));
    onClose();
  };

  return (
    <Modal title={`${target.label} — ${target.batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NumberField label={target.label} value={value} onChange={setValue} step={target.step} suffix={target.suffix} />
        <button
          onClick={submit}
          style={{
            marginTop: 8,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

// The first half of a packaging run — just picking cans or kegs and marking
// a start time. The actual counts get entered later, in PackagingModal,
// once the run is genuinely finished.
// Every batch that's used this tank, and every cleaning step logged against
// it, in one place — the point is spotting patterns (a tank with repeat
// faults, or one that keeps skipping straight to "Sanitised" without the
// steps in between) rather than just looking up "what's in it right now."
function TankHistoryModal({ tank, batches, onClose, onOpenBatch }) {
  const history = [...(tank.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const batchEntries = history.filter((h) => h.type === "batch");
  const cleanEntries = history.filter((h) => h.type === "clean");
  const [tab, setTab] = useState("batches");

  return (
    <Modal title={`${tank.name} — history`} onClose={onClose}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setTab("batches")}
          style={{
            flex: 1,
            background: tab === "batches" ? "#5C9A3C" : "none",
            border: "1px solid #C9D1AC",
            borderRadius: 5,
            padding: "8px",
            color: tab === "batches" ? "#16191A" : "#5C6B54",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Batches ({batchEntries.length})
        </button>
        <button
          onClick={() => setTab("clean")}
          style={{
            flex: 1,
            background: tab === "clean" ? "#5C9A3C" : "none",
            border: "1px solid #C9D1AC",
            borderRadius: 5,
            padding: "8px",
            color: tab === "clean" ? "#16191A" : "#5C6B54",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Cleaning ({cleanEntries.length})
        </button>
      </div>

      {tab === "batches" && (
        batchEntries.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No batches recorded for this tank yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {batchEntries.map((h) => {
              const stillExists = batches.some((b) => b.id === h.batchId);
              return (
                <button
                  key={h.id}
                  onClick={() => stillExists && onOpenBatch(h.batchId)}
                  disabled={!stillExists}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "9px 12px",
                    background: "#F8F5EA",
                    border: "1px solid #EBE8D6",
                    borderRadius: 5,
                    fontSize: 13,
                    textAlign: "left",
                    cursor: stillExists ? "pointer" : "default",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>
                    {h.batchName} {h.batchNumber ? `(#${h.batchNumber})` : ""}
                    {!stillExists && <span style={{ color: "#9BA88A" }}> — deleted</span>}
                  </span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11.5, flexShrink: 0 }}>
                    {formatHistoryStamp(h.date)}
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}

      {tab === "clean" && (
        cleanEntries.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No cleaning steps logged for this tank yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {cleanEntries.map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: CLEAN_STAGE_COLOR[h.stage] || "#9BA88A", flexShrink: 0 }} />
                  {h.stage}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11.5, flexShrink: 0 }}>
                  {formatHistoryStamp(h.date)}
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </Modal>
  );
}

function StartPackagingModal({ batch, onClose, onSave }) {
  return (
    <Modal title={`Start packaging — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5 }}>
          What are you packaging into? You'll enter the actual counts once the run's finished.
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => onSave("cans")}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 8,
              padding: "18px 10px",
              cursor: "pointer",
            }}
          >
            <Box size={26} color="#5C9A3C" />
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, color: "#2A3324" }}>Cans</span>
          </button>
          <button
            onClick={() => onSave("kegs")}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 8,
              padding: "18px 10px",
              cursor: "pointer",
            }}
          >
            <Package size={26} color="#5C9A3C" />
            <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, color: "#2A3324" }}>Kegs</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PackagingModal({ batch, onClose, onSave, packageTypes, onToggleFault }) {
  const containerFilter = batch.packagingRun?.containerType || null;
  const relevantContainers = containerFilter ? CONTAINERS.filter((c) => c.key.startsWith(containerFilter === "cans" ? "cans" : "kegs")) : CONTAINERS;
  const [counts, setCounts] = useState(() => {
    const init = {};
    CONTAINERS.forEach((c) => (init[c.key] = 0));
    return init;
  });
  const [packageTypeSelections, setPackageTypeSelections] = useState({});
  const activeFaults = currentFaults(batch);

  const remaining = remainingVolume(batch);
  const sessionVolume = CONTAINERS.reduce((sum, c) => sum + (Number(counts[c.key]) || 0) * c.volumeL, 0);
  const diff = Math.round((sessionVolume - remaining) * 100) / 100;
  const leftAfter = Math.max(0, Math.round((remaining - sessionVolume) * 100) / 100);

  const submit = () => {
    const session = {};
    CONTAINERS.forEach((c) => (session[c.key] = Number(counts[c.key]) || 0));
    onSave(batch.id, session, packageTypeSelections);
    onClose();
  };

  return (
    <Modal title={`Log packaging — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {activeFaults.length > 0 && (
          <div style={{ background: "#FBE5DC", border: "1px solid #E3B3A0", borderRadius: 6, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#B5502F", fontSize: 12.5, fontFamily: "'Oswald', sans-serif", fontWeight: 500, marginBottom: 8 }}>
              <AlertTriangle size={14} /> Still flagged before packaging — still accurate?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {activeFaults.map((f) => {
                const color = FAULT_SEVERITY_COLOR[f.severity];
                return (
                  <button
                    key={f.fault}
                    onClick={() => onToggleFault(batch.id, f.fault)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: `${color}22`,
                      border: `1px solid ${color}`,
                      borderRadius: 20,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color,
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    {f.fault}
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700 }}>{f.severity.toUpperCase()}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ color: "#B5502F", fontSize: 11.5, marginTop: 8 }}>
              If it's cleared up since it was last noted, tap it now to update — otherwise it'll be recorded on this batch as-is.
            </div>
          </div>
        )}

        {batch.packagingRun && (
          <div style={{ color: "#9BA88A", fontSize: 11.5 }}>
            Started {formatHistoryStamp(batch.packagingRun.startedAt)} — packaging into {containerFilter === "cans" ? "cans" : "kegs"}
          </div>
        )}
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Remaining in tank: <span style={{ color: "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>{remaining} L</span>
          {" "}of {batch.volume} L batch
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
          This packaging run
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {relevantContainers.map((c) => (
            <NumberField
              key={c.key}
              label={c.label}
              value={counts[c.key]}
              onChange={(v) => setCounts((prev) => ({ ...prev, [c.key]: v }))}
              step="1"
            />
          ))}
        </div>

        {packageTypes.length > 0 &&
          relevantContainers.filter((c) => Number(counts[c.key]) > 0).map((c) => (
            <label key={c.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                Package type for {c.label} (optional — deducts consumables)
              </span>
              <select
                value={packageTypeSelections[c.key] || ""}
                onChange={(e) => setPackageTypeSelections((prev) => ({ ...prev, [c.key]: e.target.value || null }))}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#F5F1E4",
                  border: "1px solid #DDE0C8",
                  borderRadius: 4,
                  padding: "9px 10px",
                  color: "#2A3324",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 14,
                }}
              >
                <option value="">None — don't deduct consumables</option>
                {packageTypes.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.name}
                  </option>
                ))}
              </select>
            </label>
          ))}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 13,
          }}
        >
          <span style={{ color: "#5C6B54" }}>This run</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324" }}>{sessionVolume.toFixed(2)} L</span>
        </div>
        {diff > 0.01 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#5C9A3C",
              fontSize: 12.5,
              background: "#FCF1DC",
              border: "1px solid #E3D3A0",
              borderRadius: 5,
              padding: "8px 12px",
            }}
          >
            <AlertTriangle size={14} />
            {`${diff.toFixed(2)} L more than what's left in the tank — double check counts.`}
          </div>
        ) : (
          sessionVolume > 0 && (
            <div style={{ color: "#9BA88A", fontSize: 12.5 }}>
              {leftAfter > 0
                ? `${leftAfter.toFixed(2)} L will still be left in the tank after this run.`
                : "This clears out everything left in the tank."}
            </div>
          )
        )}
        <button
          onClick={submit}
          disabled={sessionVolume <= 0}
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: sessionVolume > 0 ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: sessionVolume > 0 ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: sessionVolume > 0 ? "pointer" : "default",
          }}
        >
          <Package size={16} /> Log this packaging run
        </button>
      </div>
    </Modal>
  );
}

function DiscardRemainingModal({ batch, onClose, onConfirm }) {
  const remaining = remainingVolume(batch);

  const submit = () => {
    onConfirm(batch.id);
    onClose();
  };

  return (
    <Modal title={`Empty tank — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          There's <span style={{ color: "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>{remaining} L</span> still sitting in
          the tank for this batch. Emptying it logs that remainder as loss (trub, dead space, spillage, etc.) and
          finishes the batch off — it moves fully into your packaged batch history and won't show as outstanding anymore.
        </div>
        <button
          onClick={submit}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#B5502F",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#2A3324",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Empty tank ({remaining} L to loss)
        </button>
      </div>
    </Modal>
  );
}

function DeleteAccountModal({ onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError("");
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ error: "Timed out — no response after 15 seconds. Check your connection and try again." }), 15000)
    );
    const result = await Promise.race([onConfirm(), timeout]);
    if (result && result.error) {
      setError(result.error);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete account" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            color: "#5C9A3C",
            fontSize: 13,
            background: "#FCF1DC",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "10px 12px",
            lineHeight: 1.5,
          }}
        >
          This permanently deletes your login and removes you from the team. It doesn't delete your
          company's batches, inventory, orders, or recipes — those stay in place for any teammates left
          on the account. This can't be undone.
        </div>
        <TextField label='Type "DELETE" to confirm' value={confirmText} onChange={setConfirmText} />
        {error && (
          <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={!canDelete || busy}
          style={{
            background: canDelete ? "#B5502F" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canDelete ? "#2A3324" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: canDelete && !busy ? "pointer" : "default",
          }}
        >
          {busy ? "Deleting…" : "Permanently delete my account"}
        </button>
      </div>
    </Modal>
  );
}

function DeleteCompanyModal({ onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmText.trim().toUpperCase() === "DELETE COMPANY";

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError("");
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ error: "Timed out — no response after 15 seconds. Check your connection and try again." }), 15000)
    );
    const result = await Promise.race([onConfirm(), timeout]);
    if (result && result.error) {
      setError(result.error);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete company" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            color: "#B5502F",
            fontSize: 13,
            background: "#FBE5DC",
            border: "1px solid #E3B3A0",
            borderRadius: 5,
            padding: "10px 12px",
            lineHeight: 1.5,
          }}
        >
          This permanently deletes everything — every batch, ingredient, consumable, recipe, purchase
          order, tank, food safety record, and supplier tied to this company — then deletes the company
          itself and your login. Any teammates on this account will be signed out and lose access too.
          This cannot be undone.
        </div>
        <TextField label='Type "DELETE COMPANY" to confirm' value={confirmText} onChange={setConfirmText} />
        {error && (
          <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={!canDelete || busy}
          style={{
            background: canDelete ? "#B5502F" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canDelete ? "#FFFFFF" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: canDelete && !busy ? "pointer" : "default",
          }}
        >
          {busy ? "Deleting…" : "Permanently delete company"}
        </button>
      </div>
    </Modal>
  );
}

// Simple, ephemeral countdown timers for brew day — mash rest, boil,
// whirlpool/recirculation. Nothing here is saved; it's meant to be watched
// live while standing at the kettle, not referenced later.
const BREW_TIMER_PRESETS = [
  { label: "Mash", minutes: 60 },
  { label: "Boil", minutes: 60 },
  { label: "Whirlpool / recirc", minutes: 15 },
];

function BrewDayTimers({ timers, onStart, onStop }) {
  const [customMinutes, setCustomMinutes] = useState(10);
  const [customLabel, setCustomLabel] = useState("");
  const [now, setNow] = useState(Date.now());
  const dingedRef = useRef(new Set());

  useEffect(() => {
    if (timers.length === 0) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timers.length]);

  useEffect(() => {
    timers.forEach((t) => {
      const remaining = t.endTime - now;
      if (remaining <= 0 && !dingedRef.current.has(t.id)) {
        dingedRef.current.add(t.id);
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          osc.start();
          osc.stop(ctx.currentTime + 0.5);
        } catch {}
      }
    });
  }, [now, timers]);

  const startTimer = (label, minutes) => {
    if (!minutes || minutes <= 0) return;
    onStart(label, minutes);
    setNow(Date.now());
  };

  const stopTimer = (id) => {
    dingedRef.current.delete(id);
    onStop(id);
  };

  const formatRemaining = (ms) => {
    const done = ms <= 0;
    const total = Math.abs(Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${done ? "-" : ""}${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{ marginBottom: 16, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Brew day timers
      </div>

      {timers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {timers.map((t) => {
            const remaining = t.endTime - now;
            const done = remaining <= 0;
            return (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: done ? "#FBE5DC" : "#F8F5EA",
                  border: `1px solid ${done ? "#E3B3A0" : "#EBE8D6"}`,
                  borderRadius: 5,
                }}
              >
                <span style={{ color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif" }}>
                  {t.label}
                  {done && <span style={{ color: "#B5502F", marginLeft: 8, fontSize: 11.5 }}>Time's up</span>}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: done ? "#B5502F" : "#2A3324" }}>
                    {formatRemaining(remaining)}
                  </span>
                  <button
                    onClick={() => stopTimer(t.id)}
                    aria-label={`Stop ${t.label} timer`}
                    style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {BREW_TIMER_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => startTimer(p.label, p.minutes)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 20,
              padding: "7px 12px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            {p.label} · {p.minutes}m
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <TextField label="Custom timer name" value={customLabel} onChange={setCustomLabel} />
        </div>
        <div style={{ width: 90 }}>
          <NumberField label="Mins" value={customMinutes} onChange={setCustomMinutes} step="1" />
        </div>
        <button
          onClick={() => {
            startTimer(customLabel.trim() || "Timer", Number(customMinutes));
            setCustomLabel("");
          }}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "10px 14px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Start
        </button>
      </div>
    </div>
  );
}

function BatchDetail({ batch, onBack, onAdvance, onMoveBack, onLogReading, onDeleteReading, onEditBrewDayField, onOpenPackaging, onStartPackaging, onCancelPackagingRun, onUndoPackagingEvent, onDiscardRemaining, onAssignTank, onToggleScheduleStep, onDeleteBatch, stages, onLogDiacetylTest, onToggleFault, onUploadPhoto, onDeletePhoto, onStartTimer, onStopTimer, tanks, onStartRecirculation, onOpenVesselTransfer, onEditSplitTanks, onOpenFermenterTransfer, onSetCarbonationChecked, onSetBrewDayCheckbox, onAddNote, onDeleteNote }) {
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [noteText, setNoteText] = useState("");
  const latest = latestReading(batch);
  const pct = attenuation(batch.og, batch.fg, latest.gravity);
  const days = daysBetween(batch.startDate, today());
  const stageIdx = stages.indexOf(batch.stage);
  const currentTank = tanks ? tanks.find((t) => t.id === batch.tankId) : null;
  const inMashTun = batch.stage === "Brewing" && currentTank?.type === "Mash Tun";
  const inKettle = batch.stage === "Brewing" && currentTank?.type === "Kettle";
  const BREW_STAGE_INFO = {
    Mashing: { label: "Mashing in", color: "#D9A441" },
    Recirculating: { label: "Recirculating", color: "#D9A441" },
    Kettle: { label: "In the kettle", color: "#E08A3C" },
  };
  const chartData = batch.readings.map((r) => ({
    date: r.date.slice(5),
    gravity: r.gravity,
  }));

  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All batches
      </button>

      <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 22 }}>
        <Tank batch={batch} />
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 13 }}>
            Batch #{batch.number}
          </div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, color: "#2A3324", margin: "2px 0 6px", fontWeight: 500 }}>
            {batch.name}
          </h1>
          <div style={{ color: "#5C6B54", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              {batch.style} · {batch.volume}L{batchTankSummary(batch) ? ` · ${batchTankSummary(batch)}` : " · No tank assigned"}
            </span>
            <button
              onClick={() => (batch.splitTanks && batch.splitTanks.length > 0 ? onEditSplitTanks(batch) : onAssignTank(batch))}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              Change
            </button>
          </div>
          {(inMashTun || inKettle) && batch.brewStage && BREW_STAGE_INFO[batch.brewStage] && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                background: `${BREW_STAGE_INFO[batch.brewStage].color}22`,
                border: `1px solid ${BREW_STAGE_INFO[batch.brewStage].color}`,
                borderRadius: 20,
                padding: "5px 12px",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                color: BREW_STAGE_INFO[batch.brewStage].color,
              }}
            >
              {inKettle ? <FlaskConical size={13} /> : <RotateCcw size={13} />}
              {BREW_STAGE_INFO[batch.brewStage].label} — {currentTank?.name}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", marginBottom: 22, padding: "0 4px" }}>
        {stages.map((s, i) => {
          const done = i < stageIdx;
          const current = i === stageIdx;
          const color = done || current ? STAGE_COLOR[s] || "#5C9A3C" : "#DDE0C8";
          return (
            <React.Fragment key={s}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
                <div
                  style={{
                    width: current ? 16 : 12,
                    height: current ? 16 : 12,
                    borderRadius: "50%",
                    background: done || current ? color : "#FFFFFF",
                    border: `2px solid ${color}`,
                    boxShadow: current ? `0 0 0 4px ${color}33` : "none",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                    color: done || current ? color : "#C9D1AC",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s}
                </span>
              </div>
              {i < stages.length - 1 && (
                <div style={{ flex: 1, height: 2, background: i < stageIdx ? STAGE_COLOR[stages[i]] || "#5C9A3C" : "#DDE0C8", margin: "0 4px 16px" }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {[
          ["OG", batch.og.toFixed(3)],
          ["Current SG", latest.gravity.toFixed(3)],
          ["Target FG", batch.fg.toFixed(3)],
          ["Attenuation", `${pct.toFixed(0)}%`],
        ].map(([label, val]) => (
          <div key={label} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#2A3324", marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      {batch.stage === "Brewing" && (
        <BrewDayTimers
          timers={batch.timers || []}
          onStart={(label, minutes) => onStartTimer(batch.id, label, minutes)}
          onStop={(id) => onStopTimer(batch.id, id)}
        />
      )}

      {batch.schedule && batch.schedule.length > 0 && (() => {
        const next = batch.schedule.find((s) => !s.done);
        return (
          <>
            {next && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: "#FCF1DC",
                  border: "1px solid #E3D3A0",
                  borderRadius: 6,
                  padding: "10px 12px",
                  marginBottom: 12,
                }}
              >
                <Droplet size={15} color="#5C9A3C" />
                <div>
                  <div style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C9A3C" }}>Up next</div>
                  <div style={{ color: "#2A3324", fontSize: 13.5, marginTop: 1 }}>
                    {next.label} <span style={{ color: "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>({next.amount} {next.unit})</span>
                  </div>
                </div>
              </div>
            )}
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Brew day schedule
            </div>
            {(() => {
              const sorted = [...batch.schedule].sort(compareScheduleItems);
              const pending = sorted.filter((s) => !s.done);
              const completed = sorted.filter((s) => s.done);
              const stepButton = (s) => (
                <button
                  key={s.id}
                  onClick={() => onToggleScheduleStep(batch.id, s.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: "#F8F5EA",
                    border: "1px solid #EBE8D6",
                    borderRadius: 5,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    opacity: s.done ? 0.6 : 1,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: `1.5px solid ${s.done ? "#D9A441" : "#C9D1AC"}`,
                      background: s.done ? "#D9A441" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {s.done && <CheckCircle2 size={13} color="#16191A" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#2A3324", textDecoration: s.done ? "line-through" : "none" }}>
                      {s.label} <span style={{ color: "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>({s.amount} {s.unit})</span>
                    </div>
                    {s.done && s.doneAt && (
                      <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>Done {formatHistoryStamp(s.doneAt)}</div>
                    )}
                  </div>
                </button>
              );
              return (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: completed.length > 0 ? 10 : 22 }}>
                    {pending.map(stepButton)}
                    {pending.length === 0 && (
                      <div style={{ color: "#9BA88A", fontSize: 12.5, padding: "8px 4px" }}>All steps done.</div>
                    )}
                  </div>
                  {completed.length > 0 && (
                    <details style={{ marginBottom: 22 }}>
                      <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
                        {completed.length} completed step{completed.length !== 1 ? "s" : ""}
                      </summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        {completed.map(stepButton)}
                      </div>
                    </details>
                  )}
                </>
              );
            })()}
          </>
        );
      })()}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
        Brew day
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 22 }}>
        {[
          ["Mash pH", batch.mashPh, "mashPh", 0.01, "", 2],
          ["Mash temp", batch.mashTemp, "mashTemp", 0.5, "°C", 1],
          ["Pre-boil SG", batch.preBoilGravity, "preBoilGravity", 0.001, "", 3],
          ["Top-up water", batch.topUpWater, "topUpWater", 0.1, "L", 1],
          ["pH into tank", batch.phIntoTank, "phIntoTank", 0.01, "", 2],
          ["SG into tank", batch.sgIntoTank, "sgIntoTank", 0.001, "", 3],
        ].map(([label, rawVal, field, step, suffix, decimals]) => (
          <button
            key={field}
            onClick={() => onEditBrewDayField({ batch, field, label, value: rawVal, step, suffix })}
            style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px", cursor: "pointer", textAlign: "left" }}
          >
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#2A3324", marginTop: 3 }}>
              {rawVal != null ? `${rawVal.toFixed(decimals)}${suffix ? ` ${suffix}` : ""}` : "—"}
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 18, marginBottom: 22, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: "#5C6B54", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
          <input
            type="checkbox"
            checked={!!batch.hopDumpDone}
            onChange={(e) => onSetBrewDayCheckbox(batch.id, "hopDumpDone", e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
          />
          Hop dump done
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: "#5C6B54", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
          <input
            type="checkbox"
            checked={!!batch.yeastDumpDone}
            onChange={(e) => onSetBrewDayCheckbox(batch.id, "yeastDumpDone", e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
          />
          Yeast dump done
        </label>
      </div>

      {batch.ingredients && batch.ingredients.length > 0 && (
        <details style={{ marginBottom: 22 }}>
          <summary style={{ cursor: "pointer", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
            Ingredients{batch.recipeName ? ` — ${batch.recipeName}` : ""} ({batch.ingredients.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {batch.ingredients.map((ing) => (
              <div
                key={ing.id}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ flex: 1, color: "#2A3324", fontFamily: "'Inter', sans-serif" }}>{ing.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[ing.category], fontSize: 11 }}>
                  {ing.category}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 64, textAlign: "right", flexShrink: 0 }}>
                  {formatQty(ing.qty, ing.unit)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
            Photos ({(batch.photos || []).length})
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "6px 10px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              cursor: uploadingPhoto ? "default" : "pointer",
            }}
          >
            <Plus size={12} /> {uploadingPhoto ? "Uploading…" : "Add photo"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={uploadingPhoto}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploadingPhoto(true);
                await onUploadPhoto(batch.id, file);
                setUploadingPhoto(false);
              }}
              style={{ display: "none" }}
            />
          </label>
        </div>
        {(batch.photos || []).length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8 }}>
            {batch.photos.map((url, i) => (
              <div key={i} style={{ position: "relative" }}>
                <button
                  onClick={() => window.open(url, "_blank")}
                  style={{ display: "block", width: "100%", aspectRatio: "1", padding: 0, border: "1px solid #DDE0C8", borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#F8F5EA" }}
                >
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
                <button
                  onClick={() => onDeletePhoto(batch.id, url)}
                  aria-label="Delete photo"
                  style={{ position: "absolute", top: 4, right: 4, background: "rgba(10,12,11,0.6)", border: "none", borderRadius: 4, padding: 4, cursor: "pointer" }}
                >
                  <X size={11} color="#FFFFFF" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
        {stages.map((s, i) => (
          <React.Fragment key={s}>
            <span
              style={{
                fontSize: 11.5,
                fontFamily: "'JetBrains Mono', monospace",
                color: i <= stageIdx ? STAGE_COLOR[batch.stage] : "#C9D1AC",
                letterSpacing: "0.05em",
              }}
            >
              {s.toUpperCase()}
            </span>
            {i < stages.length - 1 && <span style={{ flex: 1, height: 1, background: i < stageIdx ? STAGE_COLOR[batch.stage] : "#DDE0C8" }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ color: "#9BA88A", fontSize: 12.5, marginBottom: 18 }}>{days} days since brew day</div>

      {batch.packaging && (() => {
        const events = packagingEvents(batch);
        const discarded = packagingDiscarded(batch);
        const totals = aggregatePackagingCounts(batch);
        const remaining = remainingVolume(batch);
        return (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              Packaging
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
              {CONTAINERS.map((c) => (
                <div key={c.key} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 10px" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{c.shortLabel}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#2A3324", marginTop: 3 }}>
                    {totals[c.key] || 0}
                  </div>
                </div>
              ))}
            </div>

            {batch.ingredientCost > 0 && (() => {
              const totalVolumePackaged = CONTAINERS.reduce((sum, c) => sum + (totals[c.key] || 0) * c.volumeL, 0);
              if (totalVolumePackaged <= 0) return null;
              const costPerLitre = batch.ingredientCost / totalVolumePackaged;
              return (
                <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6 }}>
                    Ingredient cost — ${batch.ingredientCost.toFixed(2)} total
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {CONTAINERS.filter((c) => (totals[c.key] || 0) > 0).map((c) => (
                      <div key={c.key} style={{ fontSize: 12.5, color: "#5C6B54" }}>
                        {c.shortLabel}: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324" }}>${(costPerLitre * c.volumeL).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {events.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {events.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: "#F8F5EA",
                      border: "1px solid #EBE8D6",
                      borderRadius: 5,
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", flexShrink: 0 }}>{(e.date || "").slice(5)}</span>
                    <span style={{ color: "#5C6B54", flex: 1 }}>
                      {CONTAINERS.filter((c) => (e[c.key] || 0) > 0).map((c) => `${e[c.key]}× ${c.shortLabel}`).join(" · ") || "—"}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", flexShrink: 0 }}>{packagedVolume(e).toFixed(2)} L</span>
                    <button
                      onClick={() => onUndoPackagingEvent(batch.id, e.id)}
                      aria-label="Undo this packaging run"
                      title="Undo — returns to Cooling and restores consumables"
                      style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 6, flexShrink: 0 }}
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ color: "#9BA88A", fontSize: 12.5, marginBottom: 10 }}>
              {totalPackagedVolume(batch).toFixed(2)} L packaged
              {discarded > 0 ? ` · ${discarded.toFixed(2)} L discarded` : ""}
              {" "}of {batch.volume} L batch
              {remaining > 0 ? ` · ${remaining.toFixed(2)} L still in tank` : " · fully accounted for"}
            </div>

            {remaining > 0 && (
              <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                <button
                  onClick={() => (batch.packagingRun ? onOpenPackaging(batch) : onStartPackaging(batch))}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "#EBE8D6",
                    border: "1px solid #C9D1AC",
                    borderRadius: 5,
                    padding: "10px",
                    color: "#2A3324",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <Package size={14} /> {batch.packagingRun ? "Finish packaging" : "Log more packaging"}
                </button>
                <button
                  onClick={() => onDiscardRemaining(batch)}
                  style={{
                    flex: 1,
                    background: "none",
                    border: "1px solid #E3D3A0",
                    borderRadius: 5,
                    padding: "10px",
                    color: "#5C9A3C",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Empty tank
                </button>
              </div>
            )}
          </>
        );
      })()}

      {inMashTun && (
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          {batch.brewStage !== "Recirculating" ? (
            <button
              onClick={() => onStartRecirculation(batch.id, "Recirculating")}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "#EBE8D6",
                border: "1px solid #C9D1AC",
                borderRadius: 5,
                padding: "11px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={15} /> Start recirculation
            </button>
          ) : (
            <button
              onClick={() => onStartRecirculation(batch.id, "Mashing")}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "#EBE8D6",
                border: "1px solid #C9D1AC",
                borderRadius: 5,
                padding: "11px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              <ChevronLeft size={15} /> Back to mashing
            </button>
          )}
          <button
            onClick={() => onOpenVesselTransfer({ batch, toType: "Kettle", brewStage: "Kettle", newStage: null, actionLabel: "Transfer to kettle" })}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13.5,
              letterSpacing: "0.02em",
              cursor: "pointer",
            }}
          >
            Transfer to kettle
          </button>
        </div>
      )}

      {inKettle && (
        <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
          <button
            onClick={() => onOpenVesselTransfer({ batch, toType: "Mash Tun", brewStage: "Mashing", newStage: null, actionLabel: "Move back to mash tun" })}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#EBE8D6",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            <ChevronLeft size={15} /> Back to mash tun
          </button>
          <button
            onClick={() => onOpenFermenterTransfer(batch)}
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13.5,
              letterSpacing: "0.02em",
              cursor: "pointer",
            }}
          >
            Transfer to fermenter
          </button>
        </div>
      )}

      {batch.stage === "Primary" && currentTank?.type !== "Kettle" && (() => {
        const kettles = tanks.filter((t) => t.type === "Kettle");
        if (kettles.length === 0) return null;
        return (
          <button
            onClick={() => onOpenVesselTransfer({ batch, toType: "Kettle", brewStage: "Kettle", newStage: "Brewing", actionLabel: "Move back to kettle" })}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              width: "100%",
              background: "#EBE8D6",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
              marginBottom: 8,
            }}
          >
            <ChevronLeft size={15} /> Transferred too early? Move back to kettle
          </button>
        );
      })()}

      <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
        <button
          onClick={() => onLogReading(batch)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#EBE8D6",
            border: "1px solid #C9D1AC",
            borderRadius: 5,
            padding: "11px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          <Droplet size={15} /> Log reading
        </button>
        {!inMashTun && !inKettle && stageIdx < stages.length - 1 && (() => {
          const nextStage = stages[stageIdx + 1];
          const needsDiacetylPass = batch.stage === "Primary" && nextStage === "Cooling";
          const hasDiacetylPass = (batch.diacetylTests || []).some((t) => t.result === "pass");
          const isPackagingStep = nextStage === "Packaged";
          const isBriteStep = nextStage === "Brite Tank";
          const packagingStarted = isPackagingStep && batch.packagingRun;
          const needsCarbonationCheck = isPackagingStep && !packagingStarted;
          const blocked = (needsDiacetylPass && !hasDiacetylPass) || (needsCarbonationCheck && !batch.carbonationChecked);
          return (
            <button
              onClick={() => {
                if (blocked) return;
                if (isBriteStep) {
                  onOpenVesselTransfer({ batch, toType: "Brite Tank", brewStage: null, newStage: "Brite Tank", actionLabel: "Transfer to Brite tank" });
                  return;
                }
                if (!isPackagingStep) { onAdvance(batch.id); return; }
                packagingStarted ? onOpenPackaging(batch) : onStartPackaging(batch);
              }}
              disabled={blocked}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: blocked ? "#E8E4D4" : "#5C9A3C",
                border: "none",
                borderRadius: 5,
                padding: "11px",
                color: blocked ? "#A3AC94" : "#16191A",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 13.5,
                letterSpacing: "0.02em",
                cursor: blocked ? "default" : "pointer",
              }}
            >
              {isPackagingStep && <Package size={15} />}
              {needsDiacetylPass && !hasDiacetylPass
                ? "Log a passing diacetyl test first"
                : needsCarbonationCheck && !batch.carbonationChecked
                ? "Confirm carbonation is checked first"
                : isBriteStep
                ? "Transfer to Brite tank"
                : !isPackagingStep
                ? `Advance to ${nextStage}`
                : packagingStarted
                ? "Finish packaging"
                : "Start packaging"}
            </button>
          );
        })()}
      </div>
      {!inMashTun && !inKettle && stageIdx < stages.length - 1 && stages[stageIdx + 1] === "Packaged" && !batch.packagingRun && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
            cursor: "pointer",
            color: batch.carbonationChecked ? "#5C6B54" : "#B5502F",
            fontSize: 12.5,
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <input
            type="checkbox"
            checked={!!batch.carbonationChecked}
            onChange={(e) => onSetCarbonationChecked(batch.id, e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
          />
          Carbonation checked
        </label>
      )}
      {batch.packagingRun && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ color: "#9BA88A", fontSize: 11.5 }}>
            Packaging into {batch.packagingRun.containerType} — started {formatHistoryStamp(batch.packagingRun.startedAt)}
          </span>
          <button
            onClick={() => onCancelPackagingRun(batch.id)}
            style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
          >
            Cancel run
          </button>
        </div>
      )}

      {stageIdx > 0 && batch.stage !== "Packaged" && (
        <button
          onClick={() => onMoveBack(batch.id)}
          style={{
            background: "none",
            border: "none",
            color: "#5C6B54",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "'Inter', sans-serif",
            padding: 0,
            marginBottom: 26,
            display: "block",
          }}
        >
          ← Move back to {stages[stageIdx - 1]}
        </button>
      )}

      {(batch.stage === "Primary" || (batch.diacetylTests && batch.diacetylTests.length > 0)) && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
              Diacetyl test
            </div>
            {batch.stage === "Primary" && (
              <button
                onClick={() => onLogDiacetylTest(batch)}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                Log test
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...(batch.diacetylTests || [])].reverse().map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: `1px solid ${t.result === "pass" ? "#DDE0C8" : "#E3D3A0"}`,
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ color: t.result === "pass" ? "#5C9A3C" : "#B5502F", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, textTransform: "uppercase" }}>
                  {t.result}
                </span>
                <span style={{ color: "#9BA88A", fontSize: 11.5 }}>{formatHistoryStamp(t.date)}</span>
              </div>
            ))}
            {(!batch.diacetylTests || batch.diacetylTests.length === 0) && (
              <div style={{ color: "#9BA88A", fontSize: 12.5 }}>
                No tests logged yet — needs at least one pass before this batch can move to Cooling.
              </div>
            )}
          </div>
        </div>
      )}

      {(["Brewing", "Primary", "Cooling"].includes(batch.stage) || (batch.faults && batch.faults.length > 0)) && (() => {
        const active = currentFaults(batch);
        const history = [...(batch.faults || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
        const hasHistory = new Set(history.map((f) => f.fault)).size < history.length; // more entries than unique faults = reassessed at least once
        return (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Quality checklist — common faults
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {COMMON_FAULTS.map((fault) => {
                const existing = active.find((f) => f.fault === fault);
                const severity = existing ? existing.severity : null;
                const isToday = existing && existing.date === today();
                const color = severity ? FAULT_SEVERITY_COLOR[severity] : "#9BA88A";
                return (
                  <button
                    key={fault}
                    onClick={() => onToggleFault(batch.id, fault)}
                    title={existing && !isToday ? `Last noted ${formatHistoryStamp(existing.date)} — tap to reassess today` : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      background: severity ? `${color}22` : "#FFFFFF",
                      border: `1px solid ${severity ? color : "#DDE0C8"}`,
                      borderRadius: 20,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 12.5,
                      color: severity ? color : "#5C6B54",
                      fontFamily: "'Inter', sans-serif",
                    }}
                  >
                    {fault}
                    {severity && (
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.03em" }}>
                        {severity.toUpperCase()}
                        {!isToday ? "*" : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 8 }}>
              Tap a fault to cycle Low → Medium → High → off. Each day gets its own fresh read — tapping today never overwrites an earlier day's note.
              {hasHistory && " * = from an earlier day."}
            </div>

            {hasHistory && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>
                  View full fault history
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                  {history.map((f) => (
                    <div
                      key={f.id || `${f.fault}-${f.date}`}
                      style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}
                    >
                      <span style={{ color: "#2A3324" }}>{f.fault}</span>
                      <span style={{ color: FAULT_SEVERITY_COLOR[f.severity], fontFamily: "'JetBrains Mono', monospace" }}>{f.severity}</span>
                      <span style={{ color: "#9BA88A" }}>{formatHistoryStamp(f.date)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })()}

      {chartData.length > 1 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingDown size={13} /> Gravity trend
          </div>
          <Suspense fallback={<div style={{ height: 160 }} />}>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#9BA88A" fontSize={11} />
              <YAxis stroke="#9BA88A" fontSize={11} domain={["dataMin - 0.003", "dataMax + 0.003"]} tickFormatter={(v) => v.toFixed(3)} />
              <Tooltip
                contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "#5C6B54" }}
              />
              <Line type="monotone" dataKey="gravity" stroke="#5C9A3C" strokeWidth={2} dot={{ r: 3, fill: "#5C9A3C" }} />
            </LineChart>
          </ResponsiveContainer>
          </Suspense>
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Reading log
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[...batch.readings].reverse().map((r) => (
          <div
            key={r.id}
            style={{
              display: "flex",
              gap: 14,
              alignItems: "baseline",
              padding: "9px 12px",
              background: "#F8F5EA",
              border: "1px solid #EBE8D6",
              borderRadius: 5,
              fontSize: 13,
            }}
          >
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", width: 62, flexShrink: 0 }}>{r.date.slice(5)}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", width: 60, flexShrink: 0 }}>{r.gravity.toFixed(3)}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 42, flexShrink: 0 }}>{r.temp}°C</span>
            {r.ph != null && (
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 48, flexShrink: 0 }}>pH {r.ph.toFixed(2)}</span>
            )}
            {r.note && <span style={{ flex: 1, color: "#5C6B54", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>}
            {batch.readings.length > 1 && (
              <button
                onClick={() => onDeleteReading(batch.id, r.id)}
                aria-label="Delete reading"
                style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 6, marginLeft: "auto", flexShrink: 0 }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginTop: 26, marginBottom: 10 }}>
        Notes
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && noteText.trim()) {
              onAddNote(batch.id, noteText.trim());
              setNoteText("");
            }
          }}
          placeholder="Jot something down — brew day, fermentation, packaging, anything"
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 4,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
          }}
        />
        <button
          onClick={() => {
            if (!noteText.trim()) return;
            onAddNote(batch.id, noteText.trim());
            setNoteText("");
          }}
          disabled={!noteText.trim()}
          style={{
            background: noteText.trim() ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "0 16px",
            color: noteText.trim() ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13,
            cursor: noteText.trim() ? "pointer" : "default",
            flexShrink: 0,
          }}
        >
          Add
        </button>
      </div>
      {(batch.notes || []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 26 }}>
          {[...batch.notes].reverse().map((n) => (
            <div
              key={n.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                padding: "9px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11, flexShrink: 0, marginTop: 2 }}>
                {formatHistoryStamp(n.date)}
              </span>
              <span style={{ flex: 1, color: "#2A3324", lineHeight: 1.4, whiteSpace: "pre-wrap", overflowWrap: "break-word" }}>{n.text}</span>
              <button
                onClick={() => onDeleteNote(batch.id, n.id)}
                aria-label="Delete note"
                style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4, flexShrink: 0 }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => window.print()}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          background: "none",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "11px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 26,
        }}
      >
        <FileText size={14} /> Print / Save as PDF
      </button>

      <button
        onClick={() => onDeleteBatch(batch)}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid #E3D3A0",
          borderRadius: 5,
          padding: "11px",
          color: "#5C9A3C",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          cursor: "pointer",
          marginTop: 10,
        }}
      >
        Delete batch
      </button>

      <div className="bp-print-sheet" style={{ display: "none" }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, margin: "0 0 2px" }}>{batch.name}</h1>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>
          Batch #{batch.number} · {batch.style} · {batch.volume}L · {batchTankSummary(batch) || "No tank assigned"}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 13 }}>
          <tbody>
            <tr><td style={{ padding: "4px 0", color: "#555", width: "40%" }}>Brew date</td><td>{batch.startDate}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Recipe</td><td>{batch.recipeName || "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Mash pH</td><td>{batch.mashPh != null ? batch.mashPh.toFixed(2) : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Mash temp</td><td>{batch.mashTemp != null ? `${batch.mashTemp.toFixed(1)}°C` : "—"}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Target OG / FG</td><td>{batch.og.toFixed(3)} / {batch.fg.toFixed(3)}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Actual FG (latest reading)</td><td>{latest.gravity.toFixed(3)}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Attenuation</td><td>{pct.toFixed(0)}%</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>ABV (current)</td><td>{calcABV(batch.og, latest.gravity).toFixed(1)}%</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Days in tank</td><td>{days}</td></tr>
            <tr><td style={{ padding: "4px 0", color: "#555" }}>Ingredient cost</td><td>{batch.ingredientCost ? `$${batch.ingredientCost.toFixed(2)}` : "—"}</td></tr>
          </tbody>
        </table>

        {batch.ingredients && batch.ingredients.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Ingredients</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {batch.ingredients.map((ing, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>{ing.name}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{ing.qty} {ing.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {batch.readings && batch.readings.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Gravity log</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {batch.readings.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>{r.date}</td>
                    <td style={{ padding: "4px 0" }}>{r.gravity.toFixed(3)}</td>
                    <td style={{ padding: "4px 0" }}>{r.temp}°C</td>
                    <td style={{ padding: "4px 0", color: "#555" }}>{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {batch.packaging && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Packaging</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {CONTAINERS.filter((c) => aggregatePackagingCounts(batch)[c.key] > 0).map((c) => (
                  <tr key={c.key}>
                    <td style={{ padding: "4px 0" }}>{c.label}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{aggregatePackagingCounts(batch)[c.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function SupplierDocumentsModal({ supplier, documents, onClose, onUpload, onDelete, onOpen }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    const result = await onUpload(supplier.id, file, name.trim(), expiryDate || null);
    setUploading(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setFile(null);
    setName("");
    setExpiryDate("");
  };

  const isExpiring = (d) => d && daysBetween(today(), d) <= 30;
  const isExpired = (d) => d && d < today();

  return (
    <Modal title={`${supplier.name} — documents`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                background: "#F8F5EA",
                border: `1px solid ${isExpired(doc.expiryDate) ? "#E3D3A0" : "#EBE8D6"}`,
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#2A3324" }}>{doc.name}</div>
                <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>
                  {doc.uploadedBy}
                  {doc.expiryDate && (
                    <span style={{ color: isExpired(doc.expiryDate) || isExpiring(doc.expiryDate) ? "#B5502F" : "#9BA88A" }}>
                      {" "}
                      · {isExpired(doc.expiryDate) ? "expired" : "expires"} {doc.expiryDate}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
                <button onClick={() => onOpen(doc)} style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                  View
                </button>
                <button onClick={() => onDelete(doc)} style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
          {documents.length === 0 && (
            <EmptyState icon={FileText} title="No documents uploaded yet" subtitle="Add a food safety certificate or other paperwork below." />
          )}
        </div>

        <div style={{ borderTop: "1px solid #EBE8D6", paddingTop: 14 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
            Upload a document
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "none",
                border: "1px dashed #C9D1AC",
                borderRadius: 5,
                padding: "10px",
                color: "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <input
                type="file"
                onChange={(e) => setFile(e.target.files && e.target.files[0])}
                style={{ display: "none" }}
              />
              {file ? file.name : "Choose a file (PDF, image, etc.)"}
            </label>
            <TextField label="Document name (optional)" value={name} onChange={setName} />
            <TextField label="Expiry date (optional)" type="date" value={expiryDate} onChange={setExpiryDate} />
            {error && <div style={{ color: "#B5502F", fontSize: 12.5 }}>{error}</div>}
            <button
              onClick={submit}
              disabled={!file || uploading}
              style={{
                background: file && !uploading ? "#5C9A3C" : "#E8E4D4",
                border: "none",
                borderRadius: 5,
                padding: "12px",
                color: file && !uploading ? "#16191A" : "#A3AC94",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 15,
                letterSpacing: "0.03em",
                cursor: file && !uploading ? "pointer" : "default",
              }}
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StaffTrainingRecordModal({ staffName, records, onClose }) {
  const trainingRecords = records
    .filter((r) => r.category === "training" && r.staffName === staffName)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const topicsCovered = [...new Set(trainingRecords.map((r) => r.topic))];
  const outstandingTopics = TRAINING_TOPICS.filter((t) => t !== "Other" && !topicsCovered.includes(t));

  return (
    <Modal title={staffName} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5 }}>
          {topicsCovered.length} of {TRAINING_TOPICS.length - 1} core topics covered
        </div>

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
          Training received
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {trainingRecords.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "#2A3324" }}>{r.topic}</div>
                {r.trainedBy && <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>by {r.trainedBy}</div>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>{r.date}</div>
                <div style={{ fontSize: 10.5, color: r.staffConfirmed ? "#D9A441" : "#5C9A3C", marginTop: 2 }}>
                  {r.staffConfirmed ? "confirmed" : "not confirmed"}
                </div>
              </div>
            </div>
          ))}
          {trainingRecords.length === 0 && (
            <div style={{ color: "#9BA88A", fontSize: 13, padding: "8px 2px" }}>No training logged yet.</div>
          )}
        </div>

        {outstandingTopics.length > 0 && (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
              Not yet covered
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {outstandingTopics.map((t) => (
                <div key={t} style={{ padding: "8px 12px", background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, fontSize: 12.5, color: "#5C9A3C" }}>
                  {t}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function XeroMappingModal({ queue, xeroItems, onConfirm, onClose }) {
  const [lineData, setLineData] = useState(() => {
    const init = {};
    queue.lines.forEach((l) => {
      init[l.productKey] = { itemCode: "", itemName: "", unitCost: "0", query: "" };
    });
    return init;
  });
  const [focusedLine, setFocusedLine] = useState(null);

  const updateLine = (productKey, patch) =>
    setLineData((prev) => ({ ...prev, [productKey]: { ...prev[productKey], ...patch } }));

  const matches = (query) =>
    query.trim().length === 0 ? xeroItems : xeroItems.filter((it) => it.name.toLowerCase().includes(query.trim().toLowerCase()));

  const submit = () => {
    const resolvedLines = queue.lines.map((l) => ({
      productKey: l.productKey,
      productLabel: l.productLabel,
      qty: l.qty,
      itemCode: lineData[l.productKey].itemCode,
      itemName: lineData[l.productKey].itemName,
      unitCost: lineData[l.productKey].unitCost,
    }));
    onConfirm(resolvedLines);
  };

  return (
    <Modal title="Match to Xero items" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
          These products haven't been linked to a Xero item yet. Match them below — this only needs doing once per
          product, future packaging runs will sync automatically. Leave any blank to skip syncing that one.
        </div>
        {queue.lines.map((l) => {
          const line = lineData[l.productKey];
          return (
            <div key={l.productKey} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ color: "#2A3324", fontSize: 13.5, marginBottom: 8 }}>
                {l.productLabel} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>× {l.qty}</span>
              </div>
              <div style={{ position: "relative", marginBottom: 8 }}>
                <input
                  type="text"
                  value={line.itemCode ? line.itemName : line.query}
                  onChange={(e) => updateLine(l.productKey, { query: e.target.value, itemCode: "", itemName: "" })}
                  onFocus={() => setFocusedLine(l.productKey)}
                  onBlur={() => setTimeout(() => setFocusedLine((cur) => (cur === l.productKey ? null : cur)), 150)}
                  placeholder="Search Xero items…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    background: "#FFFFFF",
                    border: "1px solid #DDE0C8",
                    borderRadius: 4,
                    padding: "8px 9px",
                    color: "#2A3324",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13,
                  }}
                />
                {focusedLine === l.productKey && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: 4,
                      maxHeight: 160,
                      overflowY: "auto",
                      background: "#F8F5EA",
                      border: "1px solid #DDE0C8",
                      borderRadius: 6,
                      zIndex: 20,
                    }}
                  >
                    {matches(line.query).map((it) => (
                      <button
                        key={it.code}
                        onMouseDown={() => {
                          updateLine(l.productKey, { itemCode: it.code, itemName: it.name, query: "" });
                          setFocusedLine(null);
                        }}
                        style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 9px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                      >
                        {it.name}
                      </button>
                    ))}
                    {matches(line.query).length === 0 && (
                      <div style={{ padding: "8px 9px", color: "#9BA88A", fontSize: 12.5 }}>No matching items in Xero.</div>
                    )}
                  </div>
                )}
              </div>
              <NumberField label="Unit cost (for the Xero entry)" value={line.unitCost} onChange={(v) => updateLine(l.productKey, { unitCost: v })} step="0.01" />
            </div>
          );
        })}
        <button
          onClick={submit}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Save & sync to Xero
        </button>
      </div>
    </Modal>
  );
}

function FoodSafetyDisclaimerModal({ onAccept }) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,12,11,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          background: "#F8F5EA",
          border: "1px solid #DDE0C8",
          borderRadius: 10,
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          overflowY: "auto",
          padding: "22px 22px 26px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}
      >
        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: "0 0 14px", fontWeight: 500 }}>
          Before you use Food Safety
        </h2>
        <div style={{ color: "#5C6B54", fontSize: 13.5, lineHeight: 1.6, marginBottom: 16 }}>
          This section is a record-keeping tool built to reflect MPI's National Programme 3 guidance (Dec 2025) for
          breweries. It's here to help you organise checklists, calibration, and training records — it is not
          food safety advice, and using it does not register your business, satisfy your legal obligations, or
          replace verification by MPI, your local council, or a qualified food safety consultant.
        </div>
        <div style={{ color: "#5C6B54", fontSize: 13.5, lineHeight: 1.6, marginBottom: 20 }}>
          Your business is responsible for meeting the Food Act 2014 and National Programme requirements that apply
          to it. Brewpoint and its creators are not responsible for your food safety compliance, registration, or
          verification outcomes.
        </div>
        <button
          onClick={() => setConfirmed(!confirmed)}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            background: "none",
            border: "none",
            padding: 0,
            marginBottom: 20,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              border: `1.5px solid ${confirmed ? "#D9A441" : "#C9D1AC"}`,
              background: confirmed ? "#D9A441" : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            {confirmed && <CheckCircle2 size={14} color="#16191A" />}
          </div>
          <span style={{ color: "#2A3324", fontSize: 13.5, lineHeight: 1.5 }}>
            I accept responsibility, on behalf of my company, for our food safety compliance and understand
            Brewpoint is not responsible for it.
          </span>
        </button>
        <button
          onClick={() => confirmed && onAccept()}
          disabled={!confirmed}
          style={{
            width: "100%",
            background: confirmed ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: confirmed ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: confirmed ? "pointer" : "default",
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function FoodSafetyView({ records, onStartChecklist, onStartCalibration, onStartTraining, onStartIllness, onStartNote, onOpenStaff, suppliers, onOpenSupplier }) {
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const categoryLabel = {
    checklist: "Checklist",
    calibration: "Calibration",
    training: "Training",
    water: "Water test",
    recall: "Mock recall",
    incident: "Incident",
    illness: "Staff sickness",
  };
  const categoryColor = {
    checklist: "#D9A441",
    calibration: "#D4A24C",
    training: "#5C6B54",
    water: "#9BA88A",
    recall: "#5C9A3C",
    incident: "#5C9A3C",
    illness: "#B5502F",
  };

  const recordText = (r) =>
    [
      categoryLabel[r.category],
      r.staffName,
      r.topic,
      r.trainedBy,
      r.equipmentName,
      r.result,
      r.notes,
      r.userName,
      ...(r.items ? r.items.map((i) => i.label) : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

  const filteredRecords = records.filter((r) => {
    if (monthFilter && !r.date.startsWith(monthFilter)) return false;
    if (query.trim() && !recordText(r).includes(query.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
        Based on MPI's National Programme 3 (Dec 2025) — the food safety framework for breweries under the Food Act
        2014. Records are kept here for at least 4 years, as required.
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Checklists
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {Object.entries(FOOD_SAFETY_CHECKLISTS).map(([key, template]) => (
          <button
            key={key}
            onClick={() => onStartChecklist(template)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>{template.label}</span>
            <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{template.items.length} items</span>
          </button>
        ))}
      </div>

      {(() => {
        const staffNames = [...new Set(records.filter((r) => r.category === "training" && r.staffName).map((r) => r.staffName))].sort();
        if (staffNames.length === 0) return null;
        return (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Staff training
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
              {staffNames.map((name) => {
                const staffRecords = records.filter((r) => r.category === "training" && r.staffName === name);
                const topicsCovered = new Set(staffRecords.map((r) => r.topic)).size;
                return (
                  <button
                    key={name}
                    onClick={() => onOpenStaff(name)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      background: "#FFFFFF",
                      border: "1px solid #DDE0C8",
                      borderRadius: 6,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ color: "#2A3324", fontSize: 13.5 }}>{name}</span>
                    <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                      {topicsCovered}/{TRAINING_TOPICS.length - 1} topics
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Other records
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
        <button onClick={onStartCalibration} style={secondaryBtnStyle}>Log calibration</button>
        <button onClick={onStartTraining} style={secondaryBtnStyle}>Staff training</button>
        <button onClick={() => onStartNote("water", "Log water test")} style={secondaryBtnStyle}>Water test</button>
        <button onClick={() => onStartNote("recall", "Log mock recall")} style={secondaryBtnStyle}>Mock recall</button>
        <button onClick={onStartIllness} style={{ ...secondaryBtnStyle, background: "#FBE5DC", borderColor: "#E3B3A0", color: "#B5502F" }}>Staff sickness</button>
        <button onClick={() => onStartNote("incident", "Something went wrong")} style={secondaryBtnStyle}>
          Something went wrong
        </button>
      </div>

      {suppliers.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Suppliers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
            {suppliers.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenSupplier(s)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#FFFFFF",
                  border: "1px solid #EBE8D6",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#2A3324", fontSize: 13.5 }}>{s.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 11.5 }}>Documents →</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        History ({filteredRecords.length})
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search records (staff name, topic, equipment, notes…)"
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F5F1E4",
          border: "1px solid #DDE0C8",
          borderRadius: 5,
          padding: "10px 12px",
          color: "#2A3324",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
          marginBottom: 8,
        }}
      />
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", display: "block", marginBottom: 5 }}>
        Search by date
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <input
          type="month"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          style={{
            flex: 1,
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "9px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
          }}
        />
        {monthFilter && (
          <button
            onClick={() => setMonthFilter("")}
            style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: "0 4px" }}
          >
            Clear
          </button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filteredRecords.map((r) => {
          const checkedCount = r.items ? r.items.filter((i) => i.checked).length : 0;
          return (
            <div
              key={r.id}
              style={{
                padding: "10px 12px",
                background: "#F8F5EA",
                border: "1px solid #EBE8D6",
                borderRadius: 5,
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: categoryColor[r.category] || "#5C6B54", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {categoryLabel[r.category] || r.category}
                </span>
                <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{r.date}</span>
              </div>
              <div style={{ color: "#2A3324", marginTop: 4 }}>
                {r.category === "checklist" && `${checkedCount}/${r.items.length} items checked${r.notes ? ` — ${r.notes}` : ""}`}
                {r.category === "calibration" && `${r.equipmentName} — ${r.result || "no result noted"}`}
                {r.category === "training" && (
                  <>
                    {r.staffName} — {r.topic}{r.trainedBy ? ` (by ${r.trainedBy})` : ""}
                    {r.staffConfirmed ? (
                      <span style={{ color: "#D9A441" }}> · confirmed</span>
                    ) : (
                      <span style={{ color: "#5C9A3C" }}> · not confirmed</span>
                    )}
                  </>
                )}
                {(r.category === "water" || r.category === "recall" || r.category === "incident") && (r.notes || "—")}
                {r.category === "illness" && (() => {
                  const symptoms = (r.items || []).filter((i) => i.checked).map((i) => i.label);
                  return (
                    <>
                      {r.staffName}
                      {symptoms.length > 0 ? ` — ${symptoms.join(", ")}` : ""}
                      {r.result ? <span style={{ color: "#B5502F" }}> · {r.result}</span> : ""}
                      {r.dueDate ? ` · cleared to return ${r.dueDate}` : ""}
                    </>
                  );
                })()}
              </div>
              <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 3 }}>{r.userName}</div>
            </div>
          );
        })}
        {filteredRecords.length === 0 && (
          records.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No food safety records yet" subtitle="Complete a checklist above to start building your record." />
          ) : (
            <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>Nothing matches your search.</div>
          )
        )}
      </div>
    </div>
  );
}

const secondaryBtnStyle = {
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
function ExciseReportView({ batches }) {
  const [monthFilter, setMonthFilter] = useState("");
  const allRows = useMemo(() => exciseRowsForBatches(batches), [batches]);
  const months = useMemo(() => {
    const keys = [...new Set(allRows.map((r) => monthKeyFromDate(r.date)))];
    return keys.sort().reverse();
  }, [allRows]);
  const rows = monthFilter ? allRows.filter((r) => monthKeyFromDate(r.date) === monthFilter) : allRows;
  const totalDuty = rows.reduce((s, r) => s + r.duty, 0);
  const totalVolume = Math.round(rows.reduce((s, r) => s + r.volumeL, 0) * 100) / 100;

  const byBand = {};
  rows.forEach((r) => {
    const key = `${r.band.min}-${r.band.max}`;
    if (!byBand[key]) byBand[key] = { band: r.band, volumeL: 0, duty: 0 };
    byBand[key].volumeL += r.volumeL;
    byBand[key].duty += r.duty;
  });
  const bandRows = Object.values(byBand).sort((a, b) => a.band.min - b.band.min);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#7A3E1D", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "12px 14px", marginBottom: 20 }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          <strong>This is a guide, not a filing.</strong> Figures are estimated from NZ Customs rates effective 1 July 2026, based on each batch's packaged volume and measured ABV. Confirm your actual filing obligations, reporting period, and final figures with NZ Customs or your accountant before lodging a real return.
        </div>
      </div>

      {months.length > 0 && (
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            marginBottom: 16,
          }}
        >
          <option value="">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabelFromKey(m)}
            </option>
          ))}
        </select>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing packaged yet" subtitle="Excise is calculated from packaging events, so this fills in once you've packaged a batch with a logged final gravity." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Volume packaged</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>{totalVolume} L</div>
            </div>
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>Estimated duty</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: "#2A3324" }}>${totalDuty.toFixed(2)}</div>
            </div>
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>By duty band</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
            {bandRows.map((b) => (
              <div key={`${b.band.min}-${b.band.max}`} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13.5, color: "#2A3324" }}>
                <span>
                  {b.band.min}–{b.band.max === Infinity ? "23+" : b.band.max}% ABV
                  <span style={{ color: "#9BA88A", fontSize: 12 }}> · {Math.round(b.volumeL * 100) / 100} L</span>
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>${b.duty.toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>Packaging events</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, fontSize: 13 }}>
                <span style={{ color: "#2A3324" }}>
                  {r.batchName} <span style={{ color: "#9BA88A" }}>· {r.abv.toFixed(1)}% ABV · {r.volumeL}L · {r.date}</span>
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", flexShrink: 0 }}>${r.duty.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PackagedView({ batches, onOpenBatch }) {
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const matchingBatches =
    query.trim().length === 0
      ? []
      : batches.filter(
          (b) =>
            (b.packaging && packagingEvents(b).length > 0) &&
            (b.name.toLowerCase().includes(query.trim().toLowerCase()) || String(b.number).includes(query.trim()))
        );

  const allMonths = packagingByMonth(batches);
  const months = monthFilter ? allMonths.filter((m) => m.key === monthFilter) : allMonths;

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search batches by name or number…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        />
      </div>

      {query.trim().length === 0 && !monthFilter && allMonths.length > 1 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8 }}>
            Volume packaged by month (L)
          </div>
          <Suspense fallback={<div style={{ height: 160 }} />}>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={[...allMonths].reverse()} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#9BA88A" fontSize={11} />
              <YAxis stroke="#9BA88A" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "#5C6B54" }}
              />
              <Bar dataKey="volume" fill="#5C9A3C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          </Suspense>
        </div>
      )}

      {query.trim().length === 0 && (
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", display: "block", marginBottom: 5 }}>
            Search by date
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              style={{
                flex: 1,
                boxSizing: "border-box",
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 5,
                padding: "9px 12px",
                color: "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13.5,
              }}
            />
            {monthFilter && (
              <button
                onClick={() => setMonthFilter("")}
                style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: "0 4px" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {query.trim().length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {matchingBatches.map((b) => {
            const totals = aggregatePackagingCounts(b);
            const rem = remainingVolume(b);
            const parts = CONTAINERS.filter((c) => totals[c.key] > 0).map((c) => `${totals[c.key]}× ${c.shortLabel}`);
            return (
              <button
                key={b.id}
                onClick={() => onOpenBatch(b.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div>
                  <div style={{ color: "#2A3324", fontSize: 14, fontFamily: "'Oswald', sans-serif", fontWeight: 500 }}>
                    {b.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>#{b.number}</span>
                  </div>
                  <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 3 }}>
                    {totalPackagedVolume(b).toFixed(2)}L packaged{parts.length ? ` · ${parts.join(" · ")}` : ""}
                    {rem > 0 ? ` · ${rem}L in tank` : ""}
                  </div>
                </div>
              </button>
            );
          })}
          {matchingBatches.length === 0 && (
            <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
              No packaged batches match "{query}".
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {months.map((m) => (
            <div key={m.key}>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: "#2A3324", fontWeight: 500, marginBottom: 8 }}>
                {m.label}
              </div>
              <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 14px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#5C6B54", fontSize: 12.5 }}>Total packaged</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", fontSize: 15 }}>{m.volume.toFixed(2)} L</span>
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#9BA88A", marginTop: 6 }}>
                  {CONTAINERS.filter((c) => m.counts[c.key] > 0)
                    .map((c) => `${m.counts[c.key]}× ${c.shortLabel}`)
                    .join(" · ") || "No containers logged"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {m.batches
                  .sort((a, b) => b.volume - a.volume)
                  .map((b) => (
                    <button
                      key={b.id}
                      onClick={() => onOpenBatch(b.id)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "9px 12px",
                        background: "#F8F5EA",
                        border: "1px solid #EBE8D6",
                        borderRadius: 5,
                        fontSize: 13,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ color: "#2A3324" }}>
                        {b.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>#{b.number}</span>
                      </span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>{b.volume.toFixed(2)} L</span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {months.length === 0 && (
            <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
              {monthFilter
                ? `Nothing packaged in ${monthLabelFromKey(monthFilter)}.`
                : "Nothing packaged yet — once you log a packaging run on a batch, it'll show up here by month."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Big, at-a-glance tank visualization for the Home page — same fermenter
// silhouette as the small Tank component used in batch cards, scaled up with
// a gradient fill and an animated liquid surface for a "real tank" feel.
// A compact vessel graphic for the Brew Day cards — same steel-and-fill
// visual language as the full tank cards, just squat and flat-bottomed
// (mash tuns/kettles aren't conical) and small enough to sit as an icon.
function BrewDayVesselIcon({ isKettle, recirculating, uid: idSeed, size = 42 }) {
  const steelId = `bdv-steel-${idSeed}`;
  const fillId = `bdv-fill-${idSeed}`;
  const fillColor = isKettle ? "#E08A3C" : "#C68A3C";
  const bodyPath = "M6 6 Q6 3 9 3 H41 Q44 3 44 6 V44 Q44 47 41 47 H9 Q6 47 6 44 Z";
  const bubbles = isKettle ? [14, 22, 30, 38].map((x, i) => ({ x, delay: i * 0.18 })) : [];

  return (
    <svg width={size} height={size} viewBox="0 0 50 50" style={{ flexShrink: 0, overflow: "visible" }}>
      <defs>
        <linearGradient id={steelId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E4E0D0" />
          <stop offset="50%" stopColor="#FDFCF7" />
          <stop offset="100%" stopColor="#DDD8C4" />
        </linearGradient>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.6" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="0.92" />
        </linearGradient>
        <clipPath id={`bdv-clip-${idSeed}`}>
          <path d={bodyPath} />
        </clipPath>
      </defs>
      <path d={bodyPath} fill={`url(#${steelId})`} stroke="#C9A876" strokeWidth="2" />
      <g clipPath={`url(#bdv-clip-${idSeed})`}>
        <rect x="6" y="20" width="38" height="27" fill={`url(#${fillId})`} />
        {isKettle &&
          bubbles.map((b, i) => (
            <circle key={i} cx={b.x} cy="44" r="1.3" fill="#FFFFFF" opacity="0.7">
              <animate attributeName="cy" from="44" to="20" dur="1.1s" begin={`${b.delay}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.75;0" dur="1.1s" begin={`${b.delay}s`} repeatCount="indefinite" />
            </circle>
          ))}
        {recirculating && (
          <g style={{ animation: "bp-swirl-spin 1.8s linear infinite", transformOrigin: "25px 33px" }}>
            <path d="M17 25 A10 10 0 1 1 17 41" stroke="#FFFFFF" strokeWidth="2.5" fill="none" opacity="0.75" strokeLinecap="round" />
            <path d="M17 21 L17 29 L25 25 Z" fill="#FFFFFF" opacity="0.75" />
          </g>
        )}
      </g>
      {recirculating && (
        <>
          <path d="M43 42 Q 48 15 25 -4" stroke="#9BA88A" strokeWidth="2" fill="none" strokeLinecap="round" />
          <circle cx="43" cy="42" r="1.6" fill="#9BA88A" />
          <circle cx="25" cy="-4" r="1.8" fill="#9BA88A" />
          {[0, 1, 2].map((i) => (
            <circle key={`shower-${i}`} cx={22 + i * 3} cy="-2" r="1" fill={fillColor} opacity="0">
              <animate attributeName="cy" from="-2" to="24" dur="0.9s" begin={`${i * 0.15}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.85;0.85;0" dur="0.9s" begin={`${i * 0.15}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </>
      )}
      {isKettle &&
        [17, 33].map((x, i) => (
          <path key={`s-${i}`} d={`M${x} 2 Q${x - 3} -3 ${x} -7 Q${x + 3} -11 ${x} -15`} stroke="#E08A3C" strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0">
            <animate attributeName="opacity" values="0;0.5;0" dur="1.6s" begin={`${i * 0.8}s`} repeatCount="indefinite" />
          </path>
        ))}
      <path d={bodyPath} fill="none" stroke="#C9A876" strokeWidth="2" />
    </svg>
  );
}

function TankWallCard({ tank, batch, onOpen, onQuickLog, onCycleClean, onSetCleanStage }) {
  const empty = !batch;
  const latest = batch ? latestReading(batch) : null;
  const color = batch ? STAGE_COLOR[batch.stage] || "#5C9A3C" : "#C9D1AC";
  const days = batch ? daysBetween(batch.startDate, today()) : null;
  const rem = batch ? remainingVolume(batch) : 0;
  const fillPct = batch && tank.capacity > 0 ? Math.max(4, Math.min(100, Math.round((rem / tank.capacity) * 100))) : 0;
  const clipId = `tankwall-clip-${tank.id}`;
  const gradId = `tankwall-grad-${tank.id}`;
  const steelId = `tankwall-steel-${tank.id}`;
  const isMashTun = tank.type === "Mash Tun";
  const isKettle = tank.type === "Kettle";
  const isBrite = tank.type === "Brite Tank";
  const packaging = batch && !!batch.packagingRun;
  const boiling = batch && isKettle && batch.stage === "Brewing";
  const recirculating = batch && isMashTun && batch.brewStage === "Recirculating";
  const vesselColor = packaging ? "#5B7FDE" : boiling ? "#E08A3C" : isMashTun && batch ? "#C68A3C" : color;
  const fermenting = batch && !isMashTun && !isKettle && !packaging && (batch.stage === "Brewing" || batch.stage === "Primary");
  const cooling = batch && !isMashTun && !isKettle && !packaging && batch.stage === "Cooling";
  const brite = batch && !isMashTun && !isKettle && !packaging && batch.stage === "Brite Tank";
  const frostId = `tankwall-frost-${tank.id}`;
  // Fermenters taper into a cone (real ones do, for dumping yeast/trub).
  // Brite tanks don't need that, so they get a flat-bottomed cylinder
  // instead — a genuine shape difference, not just a color/detail one.
  const bodyPath = isBrite
    ? "M10 20 Q10 10 20 10 H100 Q110 10 110 20 V180 Q110 190 100 190 H20 Q10 190 10 180 Z"
    : "M10 10 H110 V140 L60 190 L10 140 Z";
  const surfaceY = 10 + (180 - 10) * (1 - fillPct / 100);
  const bubbles = fermenting
    ? [22, 45, 68, 91].map((x, i) => ({ x, delay: i * 0.7, dur: 2.6 + (i % 2) * 0.5, r: i % 2 ? 2 : 1.4 }))
    : brite || boiling
    ? [18, 32, 46, 60, 74, 88, 102].map((x, i) => ({ x, delay: i * (boiling ? 0.2 : 0.35), dur: (boiling ? 1.1 : 1.6) + (i % 3) * 0.2, r: boiling ? 1.3 : 0.9 }))
    : [];
  const steamWisps = boiling ? [40, 65, 90].map((x, i) => ({ x, delay: i * 0.8 })) : [];
  const droplets = cooling ? [30, 55, 80].map((x, i) => ({ x, delay: i * 1.1 })) : [];
  const boxes = packaging ? [0, 1, 2].map((i) => ({ delay: i * 1.1 })) : [];

  if (empty) {
    const cleanStage = tank.cleanStatus || "Needs CIP";
    const cleanColor = CLEAN_STAGE_COLOR[cleanStage];
    const cipActive = cleanStage !== "Sanitised";

    if (!cipActive) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            background: "none",
            border: "1px dashed #DDE0C8",
            borderRadius: 8,
            padding: "12px 10px",
            textAlign: "center",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12.5, fontWeight: 500, color: "#9BA88A" }}>{tank.name}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase", color: "#C9D1AC" }}>
            {tank.type} · {tank.capacity}L
          </span>
          <button
            onClick={() => onCycleClean(tank.id)}
            style={{
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: `${cleanColor}1A`,
              border: `1px solid ${cleanColor}`,
              borderRadius: 20,
              padding: "4px 10px",
              color: cleanColor,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              fontSize: 10.5,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: cleanColor, flexShrink: 0 }} />
            {cleanStage}
          </button>
        </div>
      );
    }

    // Actively needs attention — same size and visual weight as a working
    // tank, not tucked away as an afterthought.
    const cipFillPct = { "Needs CIP": 30, Rinsed: 55, "Caustic clean": 80 }[cleanStage] || 30;
    const cipSurfaceY = 10 + (180 - 10) * (1 - cipFillPct / 100);
    const suds = [22, 45, 68, 91].map((x, i) => ({ x, delay: i * 0.5, dur: 2.2 + (i % 2) * 0.4, r: i % 2 ? 2 : 1.4 }));
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          background: "#FFFFFF",
          border: `1px solid ${cleanColor}55`,
          borderRadius: 10,
          padding: "16px 12px 14px",
          boxSizing: "border-box",
          boxShadow: `0 1px 2px rgba(42,51,36,0.05), 0 4px 14px ${cleanColor}22`,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, color: "#2A3324" }}>{tank.name}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>
            {tank.type} · {tank.capacity}L
          </span>
        </div>

        <svg width="92" height="146" viewBox="0 0 120 200">
          <defs>
            <clipPath id={clipId}>
              <path d={bodyPath} />
            </clipPath>
            <linearGradient id={steelId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#E4E0D0" />
              <stop offset="35%" stopColor="#F8F6EE" />
              <stop offset="55%" stopColor="#FDFCF7" />
              <stop offset="100%" stopColor="#DDD8C4" />
            </linearGradient>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cleanColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={cleanColor} stopOpacity="0.7" />
            </linearGradient>
          </defs>

          <rect x="24" y="2" width="72" height="9" rx="4" fill={`url(#${steelId})`} stroke={cleanColor} strokeWidth="1.5" />
          <path d={bodyPath} fill={`url(#${steelId})`} stroke={cleanColor} strokeWidth="2.5" />

          <g clipPath={`url(#${clipId})`}>
            <rect x="0" y={cipSurfaceY} width="120" height="200" fill={`url(#${gradId})`} />
            {suds.map((b, i) => (
              <circle key={i} cx={b.x} cy="185" r={b.r} fill="#FFFFFF" opacity="0.7">
                <animate attributeName="cy" from="185" to={cipSurfaceY + 6} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.75;0" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
              </circle>
            ))}
            <g style={{ animation: "bp-swirl-spin 2.8s linear infinite", transformOrigin: "60px 100px" }}>
              <path d="M40 90 A22 22 0 1 1 40 112" stroke="#FFFFFF" strokeWidth="3" fill="none" opacity="0.5" strokeLinecap="round" />
              <path d="M40 84 L40 96 L52 90 Z" fill="#FFFFFF" opacity="0.5" />
            </g>
          </g>

          <line x1="10" y1="60" x2="110" y2="60" stroke={cleanColor} strokeWidth="1" opacity="0.4" />
          <line x1="10" y1="100" x2="110" y2="100" stroke={cleanColor} strokeWidth="1" opacity="0.4" />
          <rect x="104" y="150" width="10" height="6" rx="1.5" fill={cleanColor} opacity="0.5" />
          <path d={bodyPath} fill="none" stroke={cleanColor} strokeWidth="2.5" />
        </svg>

        {tank.type === "Brite Tank" && cleanStage === "Rinsed" ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => onSetCleanStage(tank.id, "Acid clean")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: `${CLEAN_STAGE_COLOR["Acid clean"]}1A`,
                border: `1px solid ${CLEAN_STAGE_COLOR["Acid clean"]}`,
                borderRadius: 20,
                padding: "5px 11px",
                color: CLEAN_STAGE_COLOR["Acid clean"],
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Acid clean
            </button>
            <button
              onClick={() => onSetCleanStage(tank.id, "Caustic clean")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: `${CLEAN_STAGE_COLOR["Caustic clean"]}1A`,
                border: `1px solid ${CLEAN_STAGE_COLOR["Caustic clean"]}`,
                borderRadius: 20,
                padding: "5px 11px",
                color: CLEAN_STAGE_COLOR["Caustic clean"],
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Caustic clean
            </button>
          </div>
        ) : (
          <button
            onClick={() => onCycleClean(tank.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: `${cleanColor}1A`,
              border: `1px solid ${cleanColor}`,
              borderRadius: 20,
              padding: "5px 12px",
              color: cleanColor,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 500,
              fontSize: 11.5,
              cursor: "pointer",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: cleanColor, flexShrink: 0 }} />
            {cleanStage}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 10,
        padding: "16px 12px 14px",
        boxSizing: "border-box",
        boxShadow: "0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06)",
      }}
    >
      {!empty && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onQuickLog(batch);
          }}
          title="Log a reading"
          aria-label={`Log a reading for ${batch.name}`}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "#EBE8D6",
            border: "1px solid #C9D1AC",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 1,
          }}
        >
          <Droplet size={12} color="#5C9A3C" />
        </button>
      )}
      <button
        onClick={() => batch && onOpen(batch.id)}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          cursor: batch ? "pointer" : "default",
          textAlign: "center",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, color: "#2A3324" }}>
            {tank.name}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>
            {tank.type} · {tank.capacity}L
          </span>
        </div>

        <svg width="92" height="146" viewBox="0 0 120 200">
          <defs>
            <clipPath id={clipId}>
              <path d={bodyPath} />
            </clipPath>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={vesselColor} stopOpacity="0.55" />
              <stop offset="100%" stopColor={vesselColor} stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id={steelId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#E4E0D0" />
              <stop offset="35%" stopColor="#F8F6EE" />
              <stop offset="55%" stopColor="#FDFCF7" />
              <stop offset="100%" stopColor="#DDD8C4" />
            </linearGradient>
            <radialGradient id={frostId} cx="50%" cy="0%" r="90%">
              <stop offset="0%" stopColor="#BFE0F0" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#BFE0F0" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Manway lid collar — a small real-tank detail */}
          <rect x="24" y="2" width="72" height="9" rx="4" fill={`url(#${steelId})`} stroke="#C9D1AC" strokeWidth="1.5" />

          <path d={bodyPath} fill={`url(#${steelId})`} stroke="#C9D1AC" strokeWidth="2.5" />

          {!empty && (
            <g clipPath={`url(#${clipId})`}>
              <rect x="0" y={surfaceY} width="120" height="200" fill={`url(#${gradId})`} />
              <g style={{ animation: "bp-wave-drift 6s linear infinite", transformBox: "fill-box" }}>
                <path
                  d="M-60,0 C-45,-6 -35,6 -20,0 C-5,-6 5,6 20,0 C35,-6 45,6 60,0 C75,-6 85,6 100,0 C115,-6 125,6 140,0 C155,-6 165,6 180,0 V16 H-60 Z"
                  transform={`translate(0, ${surfaceY - 4})`}
                  fill={vesselColor}
                  opacity="0.5"
                />
              </g>
              {bubbles.map((b, i) => (
                <circle key={i} cx={b.x} cy="185" r={b.r} fill="#FFFFFF" opacity="0.6">
                  <animate attributeName="cy" from="185" to={surfaceY + 6} dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.65;0" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                </circle>
              ))}
              {brite &&
                [40, 75].map((x, i) => (
                  <rect key={`glint-${i}`} x={x} y="20" width="3" height="14" fill="#FFFFFF" opacity="0">
                    <animate attributeName="opacity" values="0;0.8;0" dur="2.2s" begin={`${i * 1.3}s`} repeatCount="indefinite" />
                  </rect>
                ))}
              {recirculating && (
                <g style={{ animation: "bp-swirl-spin 2.4s linear infinite", transformOrigin: "60px 100px" }}>
                  <path d="M40 90 A22 22 0 1 1 40 112" stroke="#FFFFFF" strokeWidth="3" fill="none" opacity="0.6" strokeLinecap="round" />
                  <path d="M40 84 L40 96 L52 90 Z" fill="#FFFFFF" opacity="0.6" />
                </g>
              )}
            </g>
          )}

          {recirculating && (
            <>
              {/* Recirculation arm — pulls from lower on the side, arcs up and over the top */}
              <path
                d="M102 155 Q 112 55 60 -8"
                stroke="#9BA88A"
                strokeWidth="3.5"
                fill="none"
                strokeLinecap="round"
              />
              <circle cx="102" cy="155" r="3" fill="#9BA88A" />
              <circle cx="60" cy="-8" r="3.5" fill="#9BA88A" />
              {[0, 1, 2, 3].map((i) => (
                <circle key={`shower-${i}`} cx={54 + i * 4} cy="-4" r="1.6" fill={vesselColor} opacity="0">
                  <animate attributeName="cy" from="-4" to={surfaceY + 4} dur="1.1s" begin={`${i * 0.18}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.85;0.85;0" dur="1.1s" begin={`${i * 0.18}s`} repeatCount="indefinite" />
                </circle>
              ))}
            </>
          )}

          {boiling &&
            steamWisps.map((s, i) => (
              <path
                key={`steam-${i}`}
                d={`M${s.x} 6 Q${s.x - 4} -2 ${s.x} -8 Q${s.x + 4} -14 ${s.x} -20`}
                stroke="#FFFFFF"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                opacity="0"
              >
                <animate attributeName="opacity" values="0;0.55;0" dur="1.8s" begin={`${s.delay}s`} repeatCount="indefinite" />
                <animateTransform attributeName="transform" type="translate" from="0 8" to="0 -10" dur="1.8s" begin={`${s.delay}s`} repeatCount="indefinite" />
              </path>
            ))}

          {packaging &&
            boxes.map((b, i) => (
              <g key={`box-${i}`} opacity="0">
                <animateTransform attributeName="transform" type="translate" from="-14 100" to="136 100" dur="2.6s" begin={`${b.delay}s`} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.95;0.95;0" dur="2.6s" begin={`${b.delay}s`} repeatCount="indefinite" />
                {batch.packagingRun.containerType === "kegs" ? (
                  <>
                    <rect x="0" y="0" width="13" height="11" rx="4" fill="#FFFFFF" />
                    <circle cx="6.5" cy="-1.5" r="2" fill="#5B7FDE" />
                    <rect x="1.5" y="4" width="10" height="2" fill="#5B7FDE" opacity="0.4" />
                  </>
                ) : (
                  <>
                    <rect x="0" y="0" width="8" height="14" rx="1.5" fill="#FFFFFF" />
                    <ellipse cx="4" cy="0" rx="4" ry="1.3" fill="#5B7FDE" />
                    <rect x="1.5" y="2" width="1.4" height="10" fill="#5B7FDE" opacity="0.45" />
                  </>
                )}
              </g>
            ))}

          {cooling && (
            <>
              <rect x="10" y="10" width="100" height="60" fill={`url(#${frostId})`} clipPath={`url(#${clipId})`} />
              {droplets.map((d, i) => (
                <circle key={i} cx={d.x} cy="20" r="1.6" fill="#8FBFD6" opacity="0">
                  <animate attributeName="cy" from="20" to="130" dur="3.2s" begin={`${d.delay}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.7;0.7;0" dur="3.2s" begin={`${d.delay}s`} repeatCount="indefinite" />
                </circle>
              ))}
            </>
          )}

          {/* Weld seam rings — tiny detail that reads as "real vessel" */}
          <line x1="10" y1="60" x2="110" y2="60" stroke="#C9D1AC" strokeWidth="1" opacity="0.5" />
          <line x1="10" y1="100" x2="110" y2="100" stroke="#C9D1AC" strokeWidth="1" opacity="0.5" />
          {/* Sample valve nub */}
          <rect x="104" y="150" width="10" height="6" rx="1.5" fill="#C9D1AC" />

          {/* Pressure gauge — brite tanks carbonate under pressure, so this
              is the one detail that reads as "brite" at a glance rather
              than "fermenter." */}
          {isBrite && (
            <g>
              <circle cx="92" cy="24" r="9" fill="#F5F1E4" stroke="#9BA88A" strokeWidth="1.5" />
              <circle cx="92" cy="24" r="9" fill="none" stroke="#F0B429" strokeWidth="1.5" strokeDasharray="4 24" strokeDashoffset="-2" opacity="0.8" />
              <line x1="92" y1="24" x2="95.5" y2="19.5" stroke="#2A3324" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="92" cy="24" r="1.2" fill="#2A3324" />
              <rect x="88" y="33" width="8" height="4" rx="1" fill="#C9D1AC" />
            </g>
          )}

          <path d={bodyPath} fill="none" stroke="#C9D1AC" strokeWidth="2.5" />
          <rect x="18" y="16" width="7" height={isBrite ? 168 : 118} rx="3.5" fill="#FFFFFF" opacity="0.5" />
        </svg>

        {empty ? (
          <div style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'Inter', sans-serif" }}>Empty</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: "100%" }}>
            <div
              style={{
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 13.5,
                color: "#2A3324",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >
              {batch.name}
            </div>
            {packaging ? (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "#5B7FDE1A",
                  border: "1px solid #5B7FDE",
                  borderRadius: 20,
                  padding: "3px 10px",
                  color: "#5B7FDE",
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 500,
                  fontSize: 11,
                }}
              >
                <Package size={11} /> Packaging — {batch.packagingRun.containerType}
              </span>
            ) : (
              <StagePill stage={batch.stage} />
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: "#5C6B54",
                background: "#F5F1E4",
                border: "1px solid #EBE8D6",
                borderRadius: 20,
                padding: "3px 10px",
              }}
            >
              <span>{rem}L</span>
              {latest && <span>SG {latest.gravity.toFixed(3)}</span>}
              <span>{days}d</span>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}

// A Gantt-style schedule: every tank as a row, a scrolling day-by-day
// timeline as columns, and each batch drawn as a bar spanning the days it
// occupies that tank. Tapping empty space schedules a new batch there;
// tapping an existing bar opens that batch.
// A global "jump to anything" search — batches, recipes, purchase orders,
// and tanks — so getting to a specific record doesn't mean digging through
// the right screen and scrolling to find it.
// Lets a recipe be searched for, then shows every batch ever brewed from
// any version of it side by side — target vs actual OG/FG, attenuation,
// ABV, days in tank, and cost — so drift or consistency across brews of
// the same beer is visible at a glance instead of buried per-batch.
function RecipeAnalyticsView({ recipes, batches, onOpenBatch }) {
  const [query, setQuery] = useState("");
  const [selectedFamilyId, setSelectedFamilyId] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [faultMode, setFaultMode] = useState(false);
  const [selectedFault, setSelectedFault] = useState(null);

  const families = activeRecipesByFamily(recipes).filter(
    (r) => r.name.toLowerCase().includes(query.trim().toLowerCase()) || r.style.toLowerCase().includes(query.trim().toLowerCase())
  );

  if (faultMode) {
    const recipeNameById = {};
    recipes.forEach((r) => (recipeNameById[r.id] = r.name));
    const affected = selectedFault
      ? batches.filter((b) => currentFaults(b).some((f) => f.fault === selectedFault))
      : [];
    const byRecipe = {};
    const byTank = {};
    affected.forEach((b) => {
      const rName = b.recipeName || recipeNameById[b.recipeId] || "No recipe";
      byRecipe[rName] = (byRecipe[rName] || 0) + 1;
      const tName = batchTankSummary(b) || "No tank";
      byTank[tName] = (byTank[tName] || 0) + 1;
    });
    const sortedEntries = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);

    return (
      <div>
        <button
          onClick={() => { setFaultMode(false); setSelectedFault(null); }}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: 0, marginBottom: 18 }}
        >
          <ChevronLeft size={16} /> Back
        </button>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
          Search by fault
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 22 }}>
          {COMMON_FAULTS.map((fault) => (
            <button
              key={fault}
              onClick={() => setSelectedFault(fault)}
              style={{
                background: selectedFault === fault ? "#5C9A3C" : "#FFFFFF",
                border: "1px solid " + (selectedFault === fault ? "#5C9A3C" : "#DDE0C8"),
                borderRadius: 6,
                padding: "9px 10px",
                color: selectedFault === fault ? "#16191A" : "#2A3324",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {fault}
            </button>
          ))}
        </div>

        {selectedFault && (
          affected.length === 0 ? (
            <EmptyState icon={AlertTriangle} title={`No batches with ${selectedFault}`} subtitle="Nothing currently on record for this fault — good sign." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 22 }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                    By recipe
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {sortedEntries(byRecipe).map(([name, count]) => (
                      <div key={name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#2A3324" }}>
                        <span>{name}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                    By tank
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {sortedEntries(byTank).map(([name, count]) => (
                      <div key={name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#2A3324" }}>
                        <span>{name}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A" }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                Affected batches ({affected.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[...affected].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || "")).map((b) => {
                  const f = currentFaults(b).find((fl) => fl.fault === selectedFault);
                  return (
                    <button
                      key={b.id}
                      onClick={() => onOpenBatch(b.id)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: "9px 12px",
                        background: "#F8F5EA",
                        border: "1px solid #EBE8D6",
                        borderRadius: 5,
                        fontSize: 13,
                        textAlign: "left",
                        cursor: "pointer",
                        width: "100%",
                        boxSizing: "border-box",
                      }}
                    >
                      <span style={{ color: "#2A3324" }}>
                        {b.name} <span style={{ color: "#9BA88A" }}>· {b.recipeName || "No recipe"} · {batchTankSummary(b) || "No tank"}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {f && (
                          <span style={{ color: FAULT_SEVERITY_COLOR[f.severity], fontFamily: "'Inter', sans-serif", fontSize: 11.5, fontWeight: 500 }}>
                            {f.severity}
                          </span>
                        )}
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11.5 }}>{b.startDate}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )
        )}
      </div>
    );
  }

  if (!selectedFamilyId) {
    return (
      <div>
        <button
          data-tour="page-recipeAnalytics-faultmode"
          onClick={() => setFaultMode(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 12.5, padding: 0, marginBottom: 12 }}
        >
          <AlertTriangle size={14} /> Search by fault instead
        </button>
        <input
          data-tour="page-recipeAnalytics-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes to compare their batch history…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
            marginBottom: 16,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {families.map((r) => {
            const familyRecipeIds = new Set(recipes.filter((rec) => rec.familyId === r.familyId).map((rec) => rec.id));
            const batchCount = batches.filter((b) => b.recipeId && familyRecipeIds.has(b.recipeId)).length;
            return (
              <button
                key={r.familyId}
                onClick={() => setSelectedFamilyId(r.familyId)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 6,
                  padding: "14px 16px",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: 0 }}>{r.name}</h3>
                  <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>{r.style}</div>
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 12.5, flexShrink: 0 }}>
                  {batchCount} batch{batchCount !== 1 ? "es" : ""}
                </span>
              </button>
            );
          })}
        </div>
        {families.length === 0 && (
          <EmptyState icon={TrendingUp} title="No recipes match" subtitle="Try a different search, or brew a batch first — comparisons need at least one brew to show anything." />
        )}
      </div>
    );
  }

  const selectedFamily = recipes.find((r) => r.familyId === selectedFamilyId && r.isActive) || recipes.find((r) => r.familyId === selectedFamilyId);
  const familyRecipeIds = new Set(recipes.filter((r) => r.familyId === selectedFamilyId).map((r) => r.id));
  const familyBatches = batches
    .filter((b) => b.recipeId && familyRecipeIds.has(b.recipeId))
    .slice()
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

  const rows = familyBatches.map((b) => {
    const latest = latestReading(b);
    const targetRecipe = recipes.find((r) => r.id === b.recipeId);
    const firstPass = [...(b.diacetylTests || [])].sort((x, y) => (x.date < y.date ? -1 : 1)).find((t) => t.result === "pass");
    const daysToDiacetylPass = firstPass ? daysBetween(b.startDate, firstPass.date.slice(0, 10)) : null;
    return {
      batch: b,
      latest,
      targetRecipe,
      actualAbv: calcABV(b.og, latest.gravity),
      attn: attenuation(b.og, b.fg, latest.gravity),
      days: daysBetween(b.startDate, latest.date),
      daysToDiacetylPass,
    };
  });

  const avg = (arr) => {
    const clean = arr.filter((v) => v != null);
    return clean.length ? clean.reduce((s, v) => s + v, 0) / clean.length : null;
  };
  const avgOG = avg(rows.map((r) => r.batch.og));
  const avgAttn = avg(rows.map((r) => r.attn));
  const avgCost = avg(rows.map((r) => r.batch.ingredientCost || 0));
  const avgDays = avg(rows.map((r) => r.days));
  const avgMashPh = avg(rows.map((r) => r.batch.mashPh));
  const avgMashTemp = avg(rows.map((r) => r.batch.mashTemp));
  const avgDiacetylDays = avg(rows.map((r) => r.daysToDiacetylPass));
  const faultFreeCount = rows.filter((r) => currentFaults(r.batch).length === 0).length;
  const faultFreePct = rows.length ? Math.round((faultFreeCount / rows.length) * 100) : null;

  const chartData = [...rows].reverse().map((r) => ({ date: r.batch.startDate.slice(5), Attenuation: Math.round(r.attn), Faults: currentFaults(r.batch).length }));

  const toggleCompare = (id) =>
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const compareRows = selectedBatchIds.map((id) => rows.find((r) => r.batch.id === id)).filter(Boolean);

  const metricRow = (label, fn, fmt = (v) => v) => (
    <tr style={{ borderBottom: "1px solid #EBE8D6" }}>
      <td style={{ padding: "8px 10px", color: "#9BA88A", fontSize: 12, whiteSpace: "nowrap" }}>{label}</td>
      {compareRows.map((r) => {
        const v = fn(r);
        return (
          <td key={r.batch.id} style={{ padding: "8px 10px", fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#2A3324" }}>
            {v == null ? "—" : fmt(v)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <div>
      <button
        onClick={() => setSelectedFamilyId(null)}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13, padding: 0, marginBottom: 18 }}
      >
        <ChevronLeft size={16} /> All recipes
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: 0, fontWeight: 500 }}>{selectedFamily.name}</h1>
        {rows.length > 1 && (
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              setSelectedBatchIds([]);
            }}
            style={{
              background: compareMode ? "#5C9A3C" : "none",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "7px 12px",
              color: compareMode ? "#16191A" : "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {compareMode ? "Done comparing" : "Compare batches"}
          </button>
        )}
      </div>
      <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 18 }}>{selectedFamily.style} · {rows.length} batch{rows.length !== 1 ? "es" : ""} brewed</div>

      {rows.length === 0 && (
        <EmptyState icon={TrendingUp} title="No batches brewed from this recipe yet" subtitle="Once you brew a batch using it, its stats will show up here for comparison." />
      )}

      {compareMode && selectedBatchIds.length >= 2 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "4px 4px", marginBottom: 20, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #DDE0C8" }}>
                <td style={{ padding: "8px 10px" }} />
                {compareRows.map((r) => (
                  <td key={r.batch.id} style={{ padding: "8px 10px", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13, color: "#2A3324", whiteSpace: "nowrap" }}>
                    #{r.batch.number}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricRow("Brew date", (r) => r.batch.startDate)}
              {metricRow("Target OG", (r) => r.targetRecipe?.og, (v) => v.toFixed(3))}
              {metricRow("Actual OG", (r) => r.batch.og, (v) => v.toFixed(3))}
              {metricRow("Target FG", (r) => r.targetRecipe?.fg, (v) => v.toFixed(3))}
              {metricRow("Actual FG", (r) => r.latest.gravity, (v) => v.toFixed(3))}
              {metricRow("Attenuation", (r) => r.attn, (v) => `${v.toFixed(0)}%`)}
              {metricRow("ABV", (r) => r.actualAbv, (v) => `${v.toFixed(1)}%`)}
              {metricRow("Mash pH", (r) => r.batch.mashPh, (v) => v.toFixed(2))}
              {metricRow("Mash temp", (r) => r.batch.mashTemp, (v) => `${v.toFixed(1)}°C`)}
              {metricRow("Pre-boil gravity", (r) => r.batch.preBoilGravity, (v) => v.toFixed(3))}
              {metricRow("Days in tank", (r) => r.days, (v) => `${v}d`)}
              {metricRow("Days to diacetyl pass", (r) => r.daysToDiacetylPass, (v) => `${v}d`)}
              {metricRow("Ingredient cost", (r) => r.batch.ingredientCost, (v) => `$${v.toFixed(2)}`)}
              {metricRow(
                "Faults",
                (r) => (currentFaults(r.batch).length > 0 ? currentFaults(r.batch) : null),
                (v) => v.map((f) => `${f.fault} (${f.severity})`).join(", ")
              )}
            </tbody>
          </table>
        </div>
      )}
      {compareMode && selectedBatchIds.length === 1 && (
        <div style={{ color: "#9BA88A", fontSize: 12.5, marginBottom: 16 }}>Pick at least one more batch below to compare.</div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
            {[
              ["Avg OG", avgOG?.toFixed(3), "#5C9A3C"],
              ["Avg attenuation", avgAttn != null ? `${avgAttn.toFixed(0)}%` : "—", "#D9A441"],
              ["Avg mash pH", avgMashPh != null ? avgMashPh.toFixed(2) : "—", "#B8925A"],
              ["Avg mash temp", avgMashTemp != null ? `${avgMashTemp.toFixed(1)}°C` : "—", "#E08A3C"],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 10px" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 19, color, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
            {[
              ["Avg days in tank", avgDays?.toFixed(0), "#D4A24C"],
              ["Avg days to diacetyl pass", avgDiacetylDays != null ? avgDiacetylDays.toFixed(1) : "No passes logged yet", "#5C9A3C"],
              ["Fault-free batches", faultFreePct != null ? `${faultFreePct}%` : "—", "#4FB83D"],
              ["Avg ingredient cost", avgCost != null ? `$${avgCost.toFixed(0)}` : "—", "#9BA88A"],
            ].map(([label, value, color]) => (
              <div key={label} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px 10px" }}>
                <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: typeof value === "string" && value.includes(" ") ? 12 : 19, color, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>

          {chartData.length > 1 && (
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={13} /> Attenuation across batches
              </div>
              <Suspense fallback={<div style={{ height: 160 }} />}>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#9BA88A" fontSize={11} />
                  <YAxis stroke="#9BA88A" fontSize={11} unit="%" domain={["dataMin - 5", "dataMax + 5"]} />
                  <Tooltip contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }} labelStyle={{ color: "#5C6B54" }} />
                  <Line type="monotone" dataKey="Attenuation" stroke="#D9A441" strokeWidth={2} dot={{ r: 3, fill: "#D9A441" }} />
                </LineChart>
              </ResponsiveContainer>
              </Suspense>
            </div>
          )}

          {chartData.length > 1 && chartData.some((d) => d.Faults > 0) && (
            <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <AlertTriangle size={13} /> Faults logged per batch over time
              </div>
              <Suspense fallback={<div style={{ height: 140 }} />}>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={chartData} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
                  <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" stroke="#9BA88A" fontSize={11} />
                  <YAxis stroke="#9BA88A" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }} labelStyle={{ color: "#5C6B54" }} />
                  <Bar dataKey="Faults" fill="#B5502F" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </Suspense>
              <div style={{ color: "#9BA88A", fontSize: 11, padding: "0 8px 8px" }}>Falling toward zero over time is what you're looking for here.</div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map(({ batch, latest, targetRecipe, actualAbv, attn, days, daysToDiacetylPass }) => {
              const checked = selectedBatchIds.includes(batch.id);
              return (
                <button
                  key={batch.id}
                  onClick={() => (compareMode ? toggleCompare(batch.id) : onOpenBatch(batch.id))}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    background: checked ? "#F8F5EA" : "#FFFFFF",
                    border: `1px solid ${checked ? "#5C9A3C" : "#DDE0C8"}`,
                    borderRadius: 6,
                    padding: "12px 14px",
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  {compareMode && (
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        border: `1.5px solid ${checked ? "#5C9A3C" : "#C9D1AC"}`,
                        background: checked ? "#5C9A3C" : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {checked && <CheckCircle2 size={12} color="#16191A" />}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, color: "#2A3324" }}>
                        {batch.name} <span style={{ color: "#9BA88A", fontWeight: 400, fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>#{batch.number}</span>
                      </span>
                      <span style={{ color: "#9BA88A", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>{batch.startDate}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#5C6B54" }}>
                      <span>
                        OG {batch.og.toFixed(3)}
                        {targetRecipe && Math.abs(batch.og - targetRecipe.og) > 0.001 && (
                          <span style={{ color: "#D9A441" }}> ({batch.og > targetRecipe.og ? "+" : ""}{((batch.og - targetRecipe.og) * 1000).toFixed(0)})</span>
                        )}
                      </span>
                      <span>FG {latest.gravity.toFixed(3)}</span>
                      <span>{attn.toFixed(0)}% attn</span>
                      <span>{actualAbv.toFixed(1)}% ABV</span>
                      {batch.mashPh != null && <span>pH {batch.mashPh.toFixed(2)}</span>}
                      {batch.mashTemp != null && <span>{batch.mashTemp.toFixed(1)}°C mash</span>}
                      {batch.preBoilGravity != null && <span>PBG {batch.preBoilGravity.toFixed(3)}</span>}
                      <span>{days}d</span>
                      {daysToDiacetylPass != null && <span>diacetyl {daysToDiacetylPass}d</span>}
                      {batch.ingredientCost > 0 && <span>${batch.ingredientCost.toFixed(0)}</span>}
                    </div>
                    {currentFaults(batch).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {currentFaults(batch).map((f) => (
                          <span
                            key={f.fault}
                            style={{
                              fontSize: 10.5,
                              fontFamily: "'Inter', sans-serif",
                              color: FAULT_SEVERITY_COLOR[f.severity],
                              background: `${FAULT_SEVERITY_COLOR[f.severity]}1A`,
                              border: `1px solid ${FAULT_SEVERITY_COLOR[f.severity]}`,
                              borderRadius: 12,
                              padding: "2px 8px",
                            }}
                          >
                            {f.fault} · {f.severity}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function QuickJumpModal({ onClose, batches, recipes, purchaseOrders, tanks, inventory, consumables, suppliers, foodSafetyRecords, onOpenBatch, onOpenRecipe, onOpenPO, onOpenTank, onOpenInventory, onOpenConsumable, onOpenSupplier, onOpenFoodSafety }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matchedBatches = q ? batches.filter((b) => b.name.toLowerCase().includes(q) || (b.number || "").toLowerCase().includes(q) || (b.style || "").toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedRecipes = q ? activeRecipesByFamily(recipes).filter((r) => r.name.toLowerCase().includes(q) || (r.style || "").toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedPOs = q ? purchaseOrders.filter((po) => po.poNumber.toLowerCase().includes(q) || po.supplier.toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedTanks = q ? tanks.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 4) : [];
  const matchedInventory = q ? inventory.filter((it) => it.name.toLowerCase().includes(q) || (it.category || "").toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedConsumables = q ? consumables.filter((it) => it.name.toLowerCase().includes(q) || (it.category || "").toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedSuppliers = q ? suppliers.filter((s) => s.name.toLowerCase().includes(q) || (s.contactName || "").toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedFoodSafety = q
    ? foodSafetyRecords.filter((r) => (r.staffName || "").toLowerCase().includes(q) || (r.topic || "").toLowerCase().includes(q) || (r.equipmentName || "").toLowerCase().includes(q) || (r.notes || "").toLowerCase().includes(q)).slice(0, 6)
    : [];
  const noResults =
    q &&
    matchedBatches.length === 0 &&
    matchedRecipes.length === 0 &&
    matchedPOs.length === 0 &&
    matchedTanks.length === 0 &&
    matchedInventory.length === 0 &&
    matchedConsumables.length === 0 &&
    matchedSuppliers.length === 0 &&
    matchedFoodSafety.length === 0;

  const sectionLabel = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", margin: "14px 0 8px" };
  const resultRow = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: "none",
    border: "none",
    borderRadius: 5,
    padding: "10px 8px",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "'Inter', sans-serif",
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,12,11,0.85)", zIndex: 70, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "60px 16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#F8F5EA", border: "1px solid #DDE0C8", borderRadius: 10, width: "100%", maxWidth: 480, maxHeight: "70vh", overflowY: "auto", padding: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.35)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
          <Search size={16} color="#9BA88A" style={{ flexShrink: 0 }} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search everything…"
            style={{ flex: 1, border: "none", outline: "none", background: "none", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
        </div>

        {!q && <div style={{ color: "#9BA88A", fontSize: 12.5, padding: "20px 8px", textAlign: "center" }}>Start typing to search everything at once.</div>}
        {noResults && <div style={{ color: "#9BA88A", fontSize: 12.5, padding: "20px 8px", textAlign: "center" }}>No matches for "{query}".</div>}

        {matchedBatches.length > 0 && (
          <>
            <div style={sectionLabel}>Batches</div>
            {matchedBatches.map((b) => (
              <button key={b.id} onClick={() => onOpenBatch(b.id)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{b.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{b.style}</span>
              </button>
            ))}
          </>
        )}

        {matchedRecipes.length > 0 && (
          <>
            <div style={sectionLabel}>Recipes</div>
            {matchedRecipes.map((r) => (
              <button key={r.id} onClick={() => onOpenRecipe(r.id)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{r.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.style}</span>
              </button>
            ))}
          </>
        )}

        {matchedPOs.length > 0 && (
          <>
            <div style={sectionLabel}>Purchase orders</div>
            {matchedPOs.map((po) => (
              <button key={po.id} onClick={() => onOpenPO(po.id)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{po.poNumber}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{po.supplier}</span>
              </button>
            ))}
          </>
        )}

        {matchedTanks.length > 0 && (
          <>
            <div style={sectionLabel}>Tanks</div>
            {matchedTanks.map((t) => (
              <button key={t.id} onClick={() => onOpenTank(t.id)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{t.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{t.type}</span>
              </button>
            ))}
          </>
        )}

        {matchedInventory.length > 0 && (
          <>
            <div style={sectionLabel}>Inventory</div>
            {matchedInventory.map((it) => (
              <button key={it.id} onClick={() => onOpenInventory(it.id)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{it.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{it.category}</span>
              </button>
            ))}
          </>
        )}

        {matchedConsumables.length > 0 && (
          <>
            <div style={sectionLabel}>Consumables</div>
            {matchedConsumables.map((it) => (
              <button key={it.id} onClick={() => onOpenConsumable(it.id)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{it.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{it.category}</span>
              </button>
            ))}
          </>
        )}

        {matchedSuppliers.length > 0 && (
          <>
            <div style={sectionLabel}>Suppliers</div>
            {matchedSuppliers.map((s) => (
              <button key={s.id} onClick={() => onOpenSupplier(s)} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{s.name}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{s.contactName || ""}</span>
              </button>
            ))}
          </>
        )}

        {matchedFoodSafety.length > 0 && (
          <>
            <div style={sectionLabel}>Food safety</div>
            {matchedFoodSafety.map((r) => (
              <button key={r.id} onClick={() => onOpenFoodSafety()} style={resultRow}>
                <span style={{ color: "#2A3324", fontSize: 14 }}>{r.staffName || r.topic || r.equipmentName || r.category}</span>
                <span style={{ color: "#9BA88A", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{r.date}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ProductionManagerView({ tanks, batches, onOpenBatch, onScheduleTank, onEditScheduled }) {
  const calendarTanks = tanks.filter((t) => t.type !== "Mash Tun" && t.type !== "Kettle");
  const daysBack = 7;
  const daysForward = 35;
  const rangeStart = addDays(today(), -daysBack);
  const totalDays = daysBack + daysForward + 1;
  const dayList = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i));
  const dayWidth = 34;
  const dayIndex = (d) => Math.round((new Date(d + "T00:00:00") - new Date(rangeStart + "T00:00:00")) / 86400000);

  const occupancyForTank = (tankId) =>
    batches
      .filter((b) => batchTankIds(b).includes(tankId))
      .map((b) => {
        const events = packagingEvents(b);
        const fullyDone = b.stage === "Packaged" && remainingVolume(b) === 0;
        const estimatedEnd = b.plannedDays ? addDays(b.startDate, b.plannedDays) : addDays(today(), 1);
        const end = fullyDone
          ? (events.length > 0 ? events[events.length - 1].date : b.startDate)
          : estimatedEnd;
        return { batch: b, start: b.startDate, end, isEstimate: !fullyDone && !!b.plannedDays };
      })
      .filter((o) => o.end >= rangeStart && o.start <= dayList[dayList.length - 1]);

  return (
    <div>
      {calendarTanks.length === 0 ? (
        <EmptyState icon={Calendar} title="No fermenters yet" subtitle="Set up a fermenter in Brewery first, then you can schedule batches against it here." />
      ) : (
        <div style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ minWidth: totalDays * dayWidth + 120, width: "fit-content" }}>
            <div style={{ display: "flex" }}>
              <div style={{ width: 120, flexShrink: 0 }} />
              {dayList.map((d) => {
                const isToday = d === today();
                const dt = new Date(d + "T00:00:00");
                return (
                  <div
                    key={d}
                    style={{
                      width: dayWidth,
                      flexShrink: 0,
                      textAlign: "center",
                      padding: "4px 0",
                      background: isToday ? "#5C9A3C" : "transparent",
                      borderRadius: isToday ? 4 : 0,
                    }}
                  >
                    <div style={{ fontSize: 8.5, color: isToday ? "#FFFFFF" : "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>
                      {dt.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12, color: isToday ? "#FFFFFF" : "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>
                      {dt.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {sortedTanks(calendarTanks).map((tank) => {
              const occ = occupancyForTank(tank.id);
              return (
                <div key={tank.id} style={{ display: "flex", alignItems: "center", borderTop: "1px solid #EBE8D6", minHeight: 48 }}>
                  <div style={{ width: 120, flexShrink: 0, paddingRight: 10 }}>
                    <div
                      style={{
                        fontFamily: "'Oswald', sans-serif",
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#2A3324",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tank.name}
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: "#9BA88A" }}>{tank.type}</div>
                  </div>
                  <div style={{ position: "relative", display: "flex" }}>
                    {dayList.map((d) => (
                      <div
                        key={d}
                        onClick={() => {
                          const covered = occ.some((o) => d >= o.start && d <= o.end);
                          if (!covered) onScheduleTank(tank.id, d);
                        }}
                        style={{ width: dayWidth, height: 48, flexShrink: 0, borderLeft: "1px solid #F5F1E4", cursor: "pointer" }}
                      />
                    ))}
                    {occ.map(({ batch, start, end, isEstimate }) => {
                      const startIdx = Math.max(0, dayIndex(start));
                      const endIdx = Math.min(totalDays - 1, dayIndex(end));
                      const isScheduled = batch.startDate > today();
                      return (
                        <button
                          key={batch.id}
                          onClick={() => (isScheduled ? onEditScheduled(batch.id) : onOpenBatch(batch.id))}
                          style={{
                            position: "absolute",
                            left: startIdx * dayWidth + 2,
                            width: (endIdx - startIdx + 1) * dayWidth - 4,
                            top: 7,
                            height: 34,
                            background: STAGE_COLOR[batch.stage] || "#5C9A3C",
                            opacity: isEstimate ? 0.6 : 1,
                            border: isEstimate ? `1px dashed ${STAGE_COLOR[batch.stage] || "#5C9A3C"}` : "none",
                            borderRadius: 5,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              color: "#16191A",
                              fontSize: 11.5,
                              fontFamily: "'Inter', sans-serif",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {batch.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
        {Object.entries(STAGE_COLOR)
          .filter(([stage]) => !["Secondary", "Conditioning"].includes(stage))
          .map(([stage, color]) => (
            <div key={stage} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 11, color: "#9BA88A" }}>{stage}</span>
            </div>
          ))}
      </div>
      <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 10 }}>
        Tap an empty day on a tank's row to schedule a batch there. Tap a solid bar to open that batch, or a scheduled (future) bar to edit its date, recipe, or tank. Dashed bars are an estimated end date, not yet confirmed by packaging.
      </div>
    </div>
  );
}

// For a batch that's scheduled for a future date and hasn't actually started
// brewing yet — lets the details, tank, and timing be changed freely, or the
// whole thing removed, since nothing real has happened to it yet.
function EditScheduledBatchModal({ batch, tanks, batches, recipes, onSave, onDelete, onClose }) {
  const calendarTanks = tanks.filter((t) => t.type !== "Mash Tun" && t.type !== "Kettle");
  const [name, setName] = useState(batch.name);
  const [style, setStyle] = useState(batch.style || "");
  const [volume, setVolume] = useState(batch.volume);
  const [startDate, setStartDate] = useState(batch.startDate);
  const [plannedDays, setPlannedDays] = useState(batch.plannedDays ?? "");
  const [tankId, setTankId] = useState(batch.tankId || "");
  const [recipeId, setRecipeId] = useState(batch.recipeId || "");
  const [saving, setSaving] = useState(false);

  const searchableRecipes = activeRecipesByFamily(recipes);
  const applyRecipe = (id) => {
    setRecipeId(id);
    const r = recipes.find((rec) => rec.id === id);
    if (r) {
      setName(r.name);
      setStyle(r.style);
      setVolume(r.volume);
    }
  };

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const tank = tanks.find((t) => t.id === tankId) || null;
    const activeRecipe = recipes.find((r) => r.id === recipeId) || null;
    await onSave(batch.id, {
      name: name.trim(),
      style,
      volume: Number(volume) || 0,
      startDate,
      plannedDays: plannedDays === "" ? null : Number(plannedDays),
      tankId: tank ? tank.id : null,
      tankName: tank ? tank.name : null,
      recipeId: recipeId || null,
      recipeName: activeRecipe ? activeRecipe.name : null,
      readings: batch.readings.map((r, i) => (i === 0 ? { ...r, date: startDate } : r)),
    });
    setSaving(false);
    onClose();
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const handleDelete = () => setConfirmDelete(true);

  return (
    <>
    <Modal title={`Edit scheduled brew`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C9A3C", fontSize: 12, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px", lineHeight: 1.5 }}>
          This is scheduled for a future date and hasn't started brewing yet — change anything below, or remove it entirely.
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Recipe (optional)</span>
          <select
            value={recipeId}
            onChange={(e) => applyRecipe(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          >
            <option value="">No recipe</option>
            {searchableRecipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.style})
              </option>
            ))}
          </select>
        </label>

        <TextField label="Name" value={name} onChange={setName} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <TextField label="Style" value={style} onChange={setStyle} />
          <NumberField label="Volume" value={volume} onChange={setVolume} step="0.1" suffix="L" />
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Brew date</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
        </label>

        <NumberField label="Estimated days in tank (optional)" value={plannedDays} onChange={setPlannedDays} step="1" suffix="days" />

        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Tank</span>
          <select
            value={tankId}
            onChange={(e) => setTankId(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          >
            <option value="">Unassigned</option>
            {sortedTanks(calendarTanks).map((t) => {
              const currentlyOccupied = tankIsOccupied(batches, t.id, batch.id);
              const occupied = currentlyOccupied && startDate <= today();
              const occupant = currentlyOccupied ? occupyingBatch(batches, t.id, batch.id) : null;
              return (
                <option key={t.id} value={t.id} disabled={occupied}>
                  {t.name} ({t.capacity}L)
                  {occupied ? ` — occupied by ${occupant?.name || "another batch"}` : ""}
                  {!occupied && currentlyOccupied ? ` — currently in use by ${occupant?.name || "another batch"}` : ""}
                </option>
              );
            })}
          </select>
        </label>

        <button
          onClick={submit}
          disabled={saving}
          style={{
            marginTop: 4,
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          onClick={handleDelete}
          style={{
            background: "none",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px",
            color: "#B5502F",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Delete this scheduled batch
        </button>
      </div>
    </Modal>
    {confirmDelete && (
      <ConfirmDialogModal
        message={`Delete the scheduled brew "${batch.name}"? You'll have a few seconds to undo right after.`}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { setConfirmDelete(false); onDelete(batch.id); onClose(); }}
      />
    )}
    </>
  );
}

function HomeView({
  companyName,
  companyLogo,
  fermentingBatches,
  conditioningBatches,
  inProgressBatches,
  packagedBatches,
  inventory,
  purchaseOrders,
  foodSafetyRecords,
  onOpenBatch,
  onOpenPO,
  onGoTo,
  tanks,
  recipes,
  totalBatches,
  batches,
  consumables,
  packageTypes,
  recentBatches,
  onQuickLog,
  activityLog,
  onCycleClean,
  onSetCleanStage,
}) {
  const lowStock = inventory.filter((it) => it.qty <= it.threshold);
  const openOrders = purchaseOrders.filter((po) => po.status === "Sent");

  const daysSince = (dateStr) => Math.floor((new Date(today()) - new Date(dateStr)) / 86400000);

  const brewTasks = [...fermentingBatches, ...conditioningBatches]
    .map((b) => ({ batch: b, next: (b.schedule || []).find((s) => !s.done) }))
    .filter((x) => x.next);

  const dailyDone = foodSafetyRecords.some((r) => r.category === "checklist" && r.frequency === "daily" && r.date === today());
  const weeklyDone = foodSafetyRecords.some((r) => r.category === "checklist" && r.frequency === "weekly" && daysSince(r.date) <= 7);
  const monthlyDone = foodSafetyRecords.some((r) => r.category === "checklist" && r.frequency === "monthly" && daysSince(r.date) <= 31);

  const calibrationByEquipment = {};
  foodSafetyRecords
    .filter((r) => r.category === "calibration" && r.equipmentName)
    .forEach((r) => {
      const existing = calibrationByEquipment[r.equipmentName];
      if (!existing || r.date > existing.date) calibrationByEquipment[r.equipmentName] = r;
    });
  const overdueCalibrations = Object.values(calibrationByEquipment).filter((r) => r.dueDate && r.dueDate < today());

  const foodSafetyTasks = [
    ...(!dailyDone ? [{ label: "Daily food safety checklist not done today" }] : []),
    ...(!weeklyDone ? [{ label: "Weekly food safety checklist not done in the last 7 days" }] : []),
    ...(!monthlyDone ? [{ label: "Monthly food safety checklist not done in the last month" }] : []),
    ...overdueCalibrations.map((r) => ({ label: `${r.equipmentName} calibration overdue (was due ${r.dueDate})` })),
  ];

  const totalTasks = brewTasks.length + foodSafetyTasks.length;

  const setupSteps = [
    { done: tanks.length > 0, label: "Set up your tanks", sub: "So batches can be assigned to them", goTo: "brewery" },
    { done: purchaseOrders.length > 0, label: "Create a purchase order", sub: "Bring ingredients in from a supplier with lot tracking", goTo: "orders" },
    { done: inventory.length > 0, label: "Check your ingredient inventory", sub: "Grain, hops, and yeast — added manually or via a purchase order", goTo: "inventory" },
    { done: recipes.length > 0, label: "Add a recipe", sub: "Pulls ingredients in automatically on brew day", goTo: "recipes" },
    { done: totalBatches > 0, label: "Brew your first batch", sub: "Start tracking a batch from grain to glass", goTo: "batches" },
    { done: consumables.length > 0, label: "Add packaging consumables", sub: "Cans, lids, boxes, and labels", goTo: "consumables" },
    { done: packageTypes.length > 0, label: "Set up a package type", sub: "So packaging a batch deducts the right consumables automatically", goTo: "packageTypes" },
  ];
  const setupComplete = setupSteps.every((s) => s.done);
  const [setupDismissed, setSetupDismissed] = useState(() => {
    try {
      return localStorage.getItem("brewpoint-setup-dismissed") === "true";
    } catch {
      return false;
    }
  });
  const dismissSetup = () => {
    setSetupDismissed(true);
    try {
      localStorage.setItem("brewpoint-setup-dismissed", "true");
    } catch {}
  };

  const stats = [
    ["Fermenting", fermentingBatches.length, STAGE_COLOR.Primary, "batches"],
    ["Conditioning", conditioningBatches.length, STAGE_COLOR.Conditioning, "batches"],
    ["Packaging", inProgressBatches.length, "#D4A24C", "batches"],
    ["Finished Stock", packagedBatches.length, "#9BA88A", "batches"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <FirstVisitTip tipKey="home">
        Welcome to Brewpoint. This Home screen is your at-a-glance view — your tanks and what's in them, tasks that need doing, and anything running low. Use the checklist below to get set up, and check out Production in the menu when you're ready to schedule brews ahead of time.
      </FirstVisitTip>
      <div
        style={{
          position: "relative",
          padding: "18px 20px",
          borderRadius: 10,
          background: "linear-gradient(120deg, rgba(92,154,60,0.10), rgba(217,164,65,0.10))",
          border: "1px solid rgba(92,154,60,0.14)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -30,
            right: -30,
            width: 140,
            height: 140,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(217,164,65,0.16), transparent 70%)",
          }}
        />
        <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 2, position: "relative" }}>Welcome back to</div>
        {companyLogo ? (
          <img src={companyLogo} alt={companyName || "Company logo"} style={{ maxWidth: 200, maxHeight: 72, objectFit: "contain", position: "relative" }} />
        ) : (
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, color: "#2A3324", margin: 0, fontWeight: 500, position: "relative" }}>
            {companyName || "your brewery"}
          </h1>
        )}
      </div>

      {(() => {
        const brewDayBatches = batches.filter((b) => {
          if (b.stage !== "Brewing") return false;
          const t = tanks.find((tk) => tk.id === b.tankId);
          return t && (t.type === "Mash Tun" || t.type === "Kettle");
        });
        if (brewDayBatches.length === 0) return null;
        return (
          <div>
            <style>{`
              @keyframes bp-brewday-pulse { 0%, 100% { box-shadow: 0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06); } 50% { box-shadow: 0 1px 2px rgba(42,51,36,0.05), 0 4px 20px rgba(217,164,65,0.25); } }
              @keyframes bp-swirl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
              @media (prefers-reduced-motion: reduce) {
                [style*="bp-brewday-pulse"], [style*="bp-swirl-spin"] { animation: none !important; }
              }
            `}</style>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
              Brew day
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
              {brewDayBatches.map((b) => {
                const t = tanks.find((tk) => tk.id === b.tankId);
                const isKettle = t.type === "Kettle";
                const border = isKettle ? "#E3B37A" : "#E3D3A0";
                const iconBg = isKettle ? "#E08A3C" : "#C68A3C";
                const label = b.brewStage === "Recirculating" ? "Recirculating" : isKettle ? "In the kettle" : "Mashing in";
                return (
                  <button
                    key={b.id}
                    onClick={() => onOpenBatch(b.id)}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      background: "#FFFFFF",
                      border: `1px solid ${border}`,
                      borderRadius: 10,
                      padding: "16px 12px 14px",
                      boxSizing: "border-box",
                      cursor: "pointer",
                      textAlign: "center",
                      animation: "bp-brewday-pulse 3s ease-in-out infinite",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                      <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 14, fontWeight: 500, color: "#2A3324" }}>{t.name}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>
                        {t.type}
                      </span>
                    </div>
                    <BrewDayVesselIcon isKettle={isKettle} recirculating={b.brewStage === "Recirculating"} uid={b.id} size={92} />
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: "100%" }}>
                      <div
                        style={{
                          fontFamily: "'Oswald', sans-serif",
                          fontWeight: 500,
                          fontSize: 13.5,
                          color: "#2A3324",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "100%",
                        }}
                      >
                        {b.name}
                      </div>
                      <div
                        style={{
                          fontFamily: "'Inter', sans-serif",
                          fontSize: 11,
                          color: iconBg,
                          fontWeight: 500,
                          background: `${iconBg}1A`,
                          border: `1px solid ${iconBg}`,
                          borderRadius: 20,
                          padding: "3px 10px",
                        }}
                      >
                        {label}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {tanks.length > 0 && tanks.some((t) => t.type !== "Mash Tun" && t.type !== "Kettle") && (
        <>
          <style>{`
            @keyframes bp-wave-drift { from { transform: translateX(0); } to { transform: translateX(-60px); } }
            @keyframes bp-swirl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: reduce) {
              [style*="bp-wave-drift"], [style*="bp-swirl-spin"] { animation: none !important; }
            }
          `}</style>
          {[
            { label: "Fermenters", type: "Fermenter" },
            { label: "Brite tanks", type: "Brite Tank" },
          ].map(({ label, type }) => {
            const group = tanks.filter((t) => t.type === type);
            if (group.length === 0) return null;
            return (
              <div key={type}>
                <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                  {label}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12, alignItems: "start" }}>
                  {[...sortedTanks(group)]
                    .sort((a, b) => {
                      const aOcc = occupyingBatch(batches, a.id) ? 0 : 1;
                      const bOcc = occupyingBatch(batches, b.id) ? 0 : 1;
                      return aOcc - bOcc;
                    })
                    .map((t) => (
                      <TankWallCard key={t.id} tank={t} batch={occupyingBatch(batches, t.id)} onOpen={onOpenBatch} onQuickLog={onQuickLog} onCycleClean={onCycleClean} onSetCleanStage={onSetCleanStage} />
                    ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      {recentBatches.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Recently viewed
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {recentBatches.map((b) => (
              <button
                key={b.id}
                onClick={() => onOpenBatch(b.id)}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 6,
                  padding: "9px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 120,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                    fontSize: 12.5,
                    color: "#2A3324",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 140,
                  }}
                >
                  {b.name}
                </span>
                <StagePill stage={b.stage} />
              </button>
            ))}
          </div>
        </div>
      )}

      {activityLog.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Recent activity
          </div>
          <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", boxShadow: "0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06)", borderRadius: 6, padding: "4px 0" }}>
            {activityLog.slice(0, 8).map((entry, i) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: i < Math.min(activityLog.length, 8) - 1 ? "1px solid #EBE8D6" : "none",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#2A3324", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {entry.description}
                  </div>
                  <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>{entry.userName}</div>
                </div>
                <span style={{ color: "#9BA88A", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                  {formatHistoryStamp(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!setupComplete && !setupDismissed && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", boxShadow: "0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06)", borderRadius: 8, padding: "16px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 500, color: "#2A3324" }}>
                Getting set up
              </div>
              <div style={{ fontSize: 12, color: "#9BA88A", marginTop: 2 }}>A few things to do before you're brewing day-to-day</div>
            </div>
            <button onClick={dismissSetup} style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 12, padding: 0, flexShrink: 0 }}>
              Hide this
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {setupSteps.map((s) => (
              <button
                key={s.label}
                onClick={() => onGoTo(s.goTo)}
                disabled={s.done}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: s.done ? "#F8F5EA" : "none",
                  border: `1px solid ${s.done ? "#EBE8D6" : "#DDE0C8"}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                  cursor: s.done ? "default" : "pointer",
                  textAlign: "left",
                }}
              >
                <CheckCircle2 size={16} color={s.done ? "#5C9A3C" : "#DDE0C8"} style={{ flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: s.done ? "#9BA88A" : "#2A3324", textDecoration: s.done ? "line-through" : "none" }}>
                    {s.label}
                  </div>
                  {!s.done && <div style={{ fontSize: 11.5, color: "#9BA88A" }}>{s.sub}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {totalTasks > 0 && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#D4A24C" }}>
              <AlertTriangle size={12} /> Needs doing ({totalTasks})
            </div>
            <button
              onClick={() => window.print()}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              Print day sheet
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {brewTasks.map(({ batch, next }) => (
              <button
                key={batch.id}
                onClick={() => onOpenBatch(batch.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#2A3324", fontSize: 13 }}>
                  <span style={{ color: "#5C6B54" }}>{batch.name}: </span>
                  {next.label}
                </span>
                <span style={{ color: "#5C9A3C", fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, flexShrink: 0, textTransform: "uppercase" }}>brew</span>
              </button>
            ))}
            {foodSafetyTasks.map((t, i) => (
              <button
                key={i}
                onClick={() => onGoTo("foodsafety")}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#2A3324", fontSize: 13 }}>{t.label}</span>
                <span style={{ color: "#D9A441", fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, flexShrink: 0, textTransform: "uppercase" }}>food safety</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bp-print-sheet" style={{ display: "none" }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, margin: "0 0 2px" }}>{companyName || "Brewery"} — Day Sheet</h1>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>{today()}</div>

        {brewTasks.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Brewing tasks</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {brewTasks.map(({ batch, next }, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>☐</td>
                    <td style={{ padding: "4px 8px" }}>{batch.name}</td>
                    <td style={{ padding: "4px 0" }}>{next.label} ({next.amount} {next.unit})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {foodSafetyTasks.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Food safety</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {foodSafetyTasks.map((t, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>☐</td>
                    <td style={{ padding: "4px 8px" }}>{t.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {lowStock.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Running low</div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontSize: 12.5 }}>
              <tbody>
                {lowStock.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>{it.name}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{it.qty} {it.unit} left</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {openOrders.length > 0 && (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Purchase orders awaiting delivery</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <tbody>
                {openOrders.map((po) => (
                  <tr key={po.id} style={{ borderBottom: "1px solid #ddd" }}>
                    <td style={{ padding: "4px 0" }}>{po.poNumber}</td>
                    <td style={{ padding: "4px 0", textAlign: "right" }}>{po.supplier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {brewTasks.length === 0 && foodSafetyTasks.length === 0 && lowStock.length === 0 && openOrders.length === 0 && (
          <div style={{ color: "#555", fontSize: 13 }}>Nothing outstanding today.</div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {stats.map(([label, count, color, goTo]) => (
          <button
            key={label}
            onClick={() => onGoTo(goTo)}
            style={{
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderTop: `3px solid ${color}`,
              borderRadius: 8,
              padding: "13px 12px 12px",
              cursor: "pointer",
              textAlign: "left",
              boxShadow: "0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06)",
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 23, color, marginTop: 4 }}>{count}</div>
          </button>
        ))}
      </div>

      {(() => {
        const groups = {};
        batches.forEach((b) => {
          const key = monthKeyFromDate(b.startDate);
          if (!groups[key]) groups[key] = { batches: 0, cost: 0 };
          groups[key].batches += 1;
          groups[key].cost += b.ingredientCost || 0;
        });
        const monthlyData = Object.keys(groups)
          .sort()
          .slice(-6)
          .map((key) => ({ date: monthLabelFromKey(key).slice(0, 3), Batches: groups[key].batches, Cost: Math.round(groups[key].cost) }));
        if (monthlyData.length < 2) return null;
        return (
          <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", boxShadow: "0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06)", borderRadius: 6, padding: "16px 12px 6px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <TrendingUp size={13} /> Brewing activity — last 6 months
            </div>
            <Suspense fallback={<div style={{ height: 150 }} />}>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="#9BA88A" fontSize={11} />
                <YAxis stroke="#9BA88A" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }} labelStyle={{ color: "#5C6B54" }} />
                <Bar dataKey="Batches" fill="#4FB83D" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            </Suspense>
          </div>
        );
      })()}

      {(() => {
        const groups = {};
        batches.forEach((b) => {
          const key = monthKeyFromDate(b.startDate);
          if (!groups[key]) groups[key] = { cost: 0, count: 0 };
          groups[key].cost += b.ingredientCost || 0;
          groups[key].count += 1;
        });
        const monthlyData = Object.keys(groups)
          .sort()
          .slice(-6)
          .map((key) => ({ date: monthLabelFromKey(key).slice(0, 3), "Avg cost": groups[key].count ? Math.round(groups[key].cost / groups[key].count) : 0 }));
        if (monthlyData.length < 2 || !monthlyData.some((d) => d["Avg cost"] > 0)) return null;
        return (
          <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", boxShadow: "0 1px 2px rgba(42,51,36,0.05), 0 4px 14px rgba(42,51,36,0.06)", borderRadius: 6, padding: "16px 12px 6px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <TrendingUp size={13} /> Avg ingredient cost per batch — last 6 months
            </div>
            <Suspense fallback={<div style={{ height: 150 }} />}>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={monthlyData} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#9BA88A" fontSize={11} />
                <YAxis stroke="#9BA88A" fontSize={11} unit="$" />
                <Tooltip contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }} labelStyle={{ color: "#5C6B54" }} />
                <Line type="monotone" dataKey="Avg cost" stroke="#D9A441" strokeWidth={2} dot={{ r: 3, fill: "#D9A441" }} />
              </LineChart>
            </ResponsiveContainer>
            </Suspense>
          </div>
        );
      })()}

      {inProgressBatches.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#D4A24C", marginBottom: 10 }}>
            <Package size={12} /> Packaging in progress
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {inProgressBatches.map((b) => (
              <button
                key={b.id}
                onClick={() => onOpenBatch(b.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#2A3324" }}>{b.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#D4A24C", fontSize: 12 }}>
                  {remainingVolume(b)}L left
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(lowStock.length > 0 || openOrders.length > 0) && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Needs attention
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {lowStock.map((it) => (
              <button
                key={it.id}
                onClick={() => onGoTo("inventory")}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#F8F5EA",
                  border: "1px solid #E3D3A0",
                  borderRadius: 5,
                  fontSize: 13.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#2A3324" }}>
                  <AlertTriangle size={13} color="#5C9A3C" /> {it.name} running low
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C9A3C", fontSize: 12 }}>
                  {item_qty(it)} {it.unit}
                </span>
              </button>
            ))}
            {openOrders.map((po) => (
              <button
                key={po.id}
                onClick={() => onOpenPO(po.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#F8F5EA",
                  border: "1px solid #EBE8D6",
                  borderRadius: 5,
                  fontSize: 13.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#2A3324" }}>{po.poNumber} — {po.supplier}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>Awaiting delivery</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {fermentingBatches.length === 0 && conditioningBatches.length === 0 && inProgressBatches.length === 0 && packagedBatches.length === 0 && (
        <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
          Nothing brewing yet — head to Batches to start your first batch.
        </div>
      )}
    </div>
  );
}

const item_qty = (it) => (Number.isInteger(it.qty) ? it.qty : it.qty.toFixed(2));

function EmailConfirmedScreen({ onContinue }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        button:focus-visible { outline: 2px solid #5C9A3C; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <BreworxMark size={50} />
          </div>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#5C9A3C",
              marginBottom: 6,
            }}
          >
            Brewpoint
          </span>
        </div>

        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#F8F5EA",
            border: "1px solid #E3D3A0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <CheckCircle2 size={22} color="#D9A441" />
        </div>

        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: "0 0 8px", fontWeight: 500 }}>
          Email confirmed
        </h1>
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5, margin: "0 0 26px" }}>
          Thanks for confirming your email. Your account's ready to go — log in below to get into your brewery.
        </p>

        <button
          onClick={onContinue}
          style={{
            width: "100%",
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Continue to sign in
        </button>
      </div>
    </div>
  );
}

function AuthScreen({ inviteToken }) {
  const [mode, setMode] = useState(inviteToken ? "signup" : "signin");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === "signup" && !inviteToken && !companyName.trim()) {
      setError("Enter your company name.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    setInfo("");
    setBusy(true);
    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim(), company: companyName.trim(), inviteToken: inviteToken || null } },
      });
      setBusy(false);
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setInfo("Check your email to confirm your account, then sign in.");
        setMode("signin");
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(false);
      if (signInError) setError(signInError.message);
      // on success, the onAuthStateChange listener in TankLog picks up the session
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #5C9A3C; }
        button:focus-visible { outline: 2px solid #5C9A3C; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 30 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <BreworxMark size={50} />
          </div>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#5C9A3C",
              marginBottom: 6,
            }}
          >
            Brewpoint
          </span>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0, fontWeight: 500 }}>
            {mode === "signin" ? "Welcome back" : inviteToken ? "Join your team" : "Start your brewery log"}
          </h1>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "signup" && inviteToken && (
            <div style={{ color: "#5C6B54", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 12px" }}>
              You're joining an existing brewery via invite link — no need to enter a company name.
            </div>
          )}
          {mode === "signup" && !inviteToken && <TextField label="Company name" value={companyName} onChange={setCompanyName} />}
          {mode === "signup" && <TextField label="Your name" value={name} onChange={setName} />}
          <div onKeyDown={onKeyDown}>
            <TextField label="Email" value={email} onChange={setEmail} type="email" />
          </div>
          <div onKeyDown={onKeyDown}>
            <TextField label="Password" value={password} onChange={setPassword} type="password" />
          </div>

          {error && (
            <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
              {error}
            </div>
          )}
          {info && !error && (
            <div style={{ color: "#D9A441", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
              {info}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            style={{
              marginTop: 4,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "12px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 15,
              letterSpacing: "0.03em",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <button
            onClick={() => {
              setError("");
              setInfo("");
              setMode(mode === "signin" ? "signup" : "signin");
            }}
            style={{
              background: "none",
              border: "none",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function XeroCallback() {
  const [status, setStatus] = useState("connecting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const companyId = params.get("state");
    const errorParam = params.get("error");

    if (errorParam) {
      setStatus("error");
      setMessage(`Xero said: ${errorParam}`);
      return;
    }
    if (!code || !companyId) {
      setStatus("error");
      setMessage("Missing information from Xero's redirect — try connecting again.");
      return;
    }

    (async () => {
      let userName = null;
      try {
        const { data } = await supabase.auth.getSession();
        userName = data.session?.user?.user_metadata?.name || null;
      } catch {
        // ignore — connected_by is just informational
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const functionUrl = `${supabaseUrl}/functions/v1/xero-callback`;
      try {
        const res = await fetch(functionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${anonKey}`,
            apikey: anonKey,
          },
          body: JSON.stringify({ code, companyId, userName }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setStatus("error");
          const baseMsg = typeof data.error === "string" ? data.error : "Something went wrong connecting to Xero.";
          const detailStr = data.detail ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail)) : "";
          const debugStr = data.debug ? JSON.stringify(data.debug) : "";
          setMessage([baseMsg, detailStr, debugStr].filter(Boolean).join(" — "));
        } else {
          setStatus("success");
          setMessage(`Connected to ${data.tenantName}.`);
          setTimeout(() => {
            window.location.href = "/?view=settings";
          }, 2000);
        }
      } catch {
        setStatus("error");
        setMessage("Couldn't reach the connection service — check your internet and try again.");
      }
    })();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
      `}</style>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <BreworxMark size={44} />
        </div>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", color: "#2A3324", fontSize: 20, fontWeight: 500, margin: "0 0 8px" }}>
          {status === "connecting" && "Connecting to Xero…"}
          {status === "success" && "Connected"}
          {status === "error" && "Couldn't connect"}
        </h1>
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5 }}>{message}</p>
        {status === "error" && (
          <button
            onClick={() => (window.location.href = "/")}
            style={{
              marginTop: 16,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "10px 18px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Back to Brewpoint
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      {Icon && <Icon size={26} color="#C9D1AC" style={{ marginBottom: 12 }} />}
      <div style={{ fontSize: 14, color: "#5C6B54", fontFamily: "'Oswald', sans-serif", fontWeight: 500, marginBottom: subtitle ? 4 : 0 }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 12.5, color: "#9BA88A", maxWidth: 300, margin: "0 auto", lineHeight: 1.5 }}>{subtitle}</div>}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 16,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "9px 16px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> {action.label}
        </button>
      )}
    </div>
  );
}

// A short explainer shown the first time someone visits a given screen —
// dismissed permanently per-screen once tapped, so it never nags after that.
function FirstVisitTip({ tipKey, children }) {
  const storageKey = `brewpoint-tip-dismissed-${tipKey}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "true");
    } catch {}
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: "#F8F5EA",
        border: "1px solid #C9D1AC",
        borderRadius: 6,
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <Info size={15} color="#5C9A3C" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#2A3324", fontSize: 12.5, lineHeight: 1.5 }}>{children}</div>
        <button
          onClick={dismiss}
          style={{
            background: "none",
            border: "none",
            color: "#5C9A3C",
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: "pointer",
            padding: "6px 0 0",
          }}
        >
          Got it, don't show this again
        </button>
      </div>
    </div>
  );
}

function OfflineBanner() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 90,
        background: "#2A1E16",
        borderBottom: "1px solid #E3D3A0",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <AlertTriangle size={14} color="#E3B04A" />
      <span style={{ color: "#F5F1E4", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
        You're offline — changes won't save until you're back online.
      </span>
    </div>
  );
}

const APP_VERSION = "2026-07-31-112";

function UpdateBanner({ onRefresh, runningVersion, latestVersion }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <div
      style={{
        position: "fixed",
        bottom: "env(safe-area-inset-bottom, 0px)",
        left: 0,
        right: 0,
        zIndex: 95,
        background: "#1F2E18",
        borderTop: "1px solid #C9D1AC",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <CheckCircle2 size={14} color="#8FCB6C" />
      <span style={{ color: "#F5F1E4", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
        A new version of Brewpoint is available.
        {runningVersion && latestVersion && (
          <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
            {" "}(running {runningVersion}, latest {latestVersion})
          </span>
        )}
      </span>
      <button
        onClick={() => {
          setRefreshing(true);
          onRefresh();
        }}
        disabled={refreshing}
        style={{
          background: refreshing ? "#3A4A2E" : "none",
          border: "1px solid #C9D1AC",
          borderRadius: 5,
          padding: "4px 10px",
          color: "#F5F1E4",
          fontFamily: "'Oswald', sans-serif",
          fontWeight: 500,
          fontSize: 12,
          cursor: refreshing ? "default" : "pointer",
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        zIndex: 100,
        pointerEvents: "none",
        padding: "0 16px",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: 420,
            width: "100%",
            background: t.type === "error" ? "#2A1E16" : "#1F2E18",
            border: `1px solid ${t.type === "error" ? "#E3D3A0" : "#C9D1AC"}`,
            borderRadius: 8,
            padding: "11px 14px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            cursor: "pointer",
            animation: "bp-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <style>{`
            @keyframes bp-toast-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes bp-check-pop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
            @media (prefers-reduced-motion: reduce) {
              .bp-check-pop { animation: none !important; }
            }
          `}</style>
          {t.type === "error" ? (
            <AlertTriangle size={16} color="#E3B04A" style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={16} color="#8FCB6C" className="bp-check-pop" style={{ flexShrink: 0, animation: "bp-check-pop 380ms cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
          )}
          <span style={{ color: "#F5F1E4", fontSize: 13, fontFamily: "'Inter', sans-serif", lineHeight: 1.4, flex: 1 }}>{t.message}</span>
          {t.action && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                t.action.onClick();
                onDismiss(t.id);
              }}
              style={{
                background: "none",
                border: "1px solid #C9D1AC",
                borderRadius: 5,
                padding: "5px 10px",
                color: "#F5F1E4",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 12.5,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// Catches any render-time crash and shows the actual error instead of a
// blank white screen — critical for diagnosing issues on iPad, where
// there's no easy way to open dev tools and see what actually happened.
class BrewpointErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("Brewpoint crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error);
      const stack = this.state.error?.stack || "";
      const componentStack = this.state.info?.componentStack || "";
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#F5F1E4",
            fontFamily: "'Inter', sans-serif",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#5C6B54", fontSize: 13.5, maxWidth: 480, margin: "0 0 16px" }}>
            Brewpoint hit an error and couldn't load. Screenshot everything below and send it over — this tells us exactly what broke.
          </p>
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: 14,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: "#B5502F",
              maxWidth: "100%",
              width: 560,
              maxHeight: "50vh",
              overflow: "auto",
              textAlign: "left",
              boxSizing: "border-box",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {message}
            {stack ? `\n\n${stack}` : ""}
            {componentStack ? `\n\n--- component stack ---${componentStack}` : ""}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px 22px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function TankLogApp() {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [justConfirmedEmail, setJustConfirmedEmail] = useState(() => {
    const hash = window.location.hash || "";
    return hash.includes("type=signup") || hash.includes("type=invite") || hash.includes("type=email_change");
  });
  const [loadingData, setLoadingData] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Detects when a newer build has been deployed while this session is still
  // open — important for the installed PWA, which otherwise keeps showing a
  // stale cached version until the user manually reinstalls it.
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersionSeen, setLatestVersionSeen] = useState(null);
  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const res = await fetch(`/version.txt?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const latest = (await res.text()).trim();
        setLatestVersionSeen(latest);
        if (latest && latest !== APP_VERSION) setUpdateAvailable(true);
      } catch {
        // Network hiccup or offline — not worth surfacing, just skip this check.
      }
    };
    checkForUpdate();
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const showToast = (type, message, action) => {
    const id = uid();
    setToasts((prev) => [...prev, { id, type, message, action }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 6000 : 4500);
    return id;
  };
  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const pendingDeletesRef = useRef({});
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "settings" ? "settings" : "home";
  });
  const [inviteToken] = useState(() => new URLSearchParams(window.location.search).get("invite"));
  const [tankParam] = useState(() => new URLSearchParams(window.location.search).get("tank"));
  const [qrTankTarget, setQrTankTarget] = useState(null);
  const [historyTankTarget, setHistoryTankTarget] = useState(null);

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [batches, setBatches] = useState([]);
  const [activityLog, setActivityLog] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const [brewDayFieldTarget, setBrewDayFieldTarget] = useState(null);
  const [packagingTarget, setPackagingTarget] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [packageTypes, setPackageTypes] = useState([]);
  const [showAddInventory, setShowAddInventory] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [batchQuery, setBatchQuery] = useState("");
  const [poQuery, setPoQuery] = useState("");
  const [showAddConsumable, setShowAddConsumable] = useState(false);
  const [selectedConsumableId, setSelectedConsumableId] = useState(null);
  const [consumableQuery, setConsumableQuery] = useState("");
  const [consumableAdjustTarget, setConsumableAdjustTarget] = useState(null);
  const [showAddPackageType, setShowAddPackageType] = useState(false);
  const [selectedPackageTypeId, setSelectedPackageTypeId] = useState(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [selectedPOId, setSelectedPOId] = useState(null);
  const [showAddPO, setShowAddPO] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [showAddSalesOrder, setShowAddSalesOrder] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showDeleteCompany, setShowDeleteCompany] = useState(false);
  const [brewRecipe, setBrewRecipe] = useState(null);
  const [batchPreset, setBatchPreset] = useState(null);
  const [editScheduledBatchId, setEditScheduledBatchId] = useState(null);
  const [showQuickJump, setShowQuickJump] = useState(false);
  const [showHelpGuide, setShowHelpGuide] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [textScale, setTextScale] = useState(() => {
    try {
      return localStorage.getItem("brewpoint-text-scale") || "1";
    } catch {
      return "1";
    }
  });
  const setTextScalePersist = (v) => {
    setTextScale(v);
    try {
      localStorage.setItem("brewpoint-text-scale", v);
    } catch {}
  };
  const [profile, setProfile] = useState(null);

  const [showWelcomeTour, setShowWelcomeTour] = useState(false);
  useEffect(() => {
    if (!profile) return;
    if (!(profile.toursSeen || []).includes("welcome")) setShowWelcomeTour(true);
  }, [profile]);

  // Marks a tour (the welcome tour, or any single page's tour) as seen —
  // tied to the person's account rather than the device, so it follows
  // them wherever they log in, and each teammate gets their own first look
  // regardless of whether they're sharing a device with someone else.
  const markTourSeen = async (key) => {
    if (!profile) return;
    const toursSeen = [...new Set([...(profile.toursSeen || []), key])];
    setProfile((prev) => (prev ? { ...prev, toursSeen } : prev));
    try {
      await supabase.from("profiles").update({ tours_seen: toursSeen }).eq("id", profile.id);
    } catch {}
  };

  const dismissWelcomeTour = () => {
    setShowWelcomeTour(false);
    markTourSeen("welcome");
    try {
      // A brand-new account doesn't need a "what changed" recap on top of
      // the tour it just saw — mark the changelog seen too.
      localStorage.setItem("brewpoint-changelog-seen", String(LATEST_CHANGELOG_ID));
    } catch {}
  };

  // Same spotlight mechanism as the welcome tour, but scoped to a single
  // page — fires the first time this account lands on a page that has one.
  // Skips while the welcome tour itself is showing, so a brand-new account
  // isn't hit by two overlapping tours.
  const [pageTourKey, setPageTourKey] = useState(null);
  useEffect(() => {
    if (showWelcomeTour) return;
    if (!profile) return;
    if (!PAGE_TOURS[view]) return;
    if (!(profile.toursSeen || []).includes(view)) setPageTourKey(view);
  }, [view, showWelcomeTour, profile]);
  const dismissPageTour = () => {
    if (pageTourKey) markTourSeen(pageTourKey);
    setPageTourKey(null);
  };

  const [showWhatsNew, setShowWhatsNew] = useState(false);
  useEffect(() => {
    if (!profile) return;
    try {
      const isFirstVisit = !(profile.toursSeen || []).includes("welcome");
      if (isFirstVisit) return;
      const lastSeen = Number(localStorage.getItem("brewpoint-changelog-seen") || "0");
      if (lastSeen < LATEST_CHANGELOG_ID) setShowWhatsNew(true);
    } catch {}
  }, [profile]);
  const dismissWhatsNew = () => {
    setShowWhatsNew(false);
    try {
      localStorage.setItem("brewpoint-changelog-seen", String(LATEST_CHANGELOG_ID));
    } catch {}
  };
  const [companyName, setCompanyName] = useState("");
  const [companyLogo, setCompanyLogo] = useState("");
  const [xeroConnection, setXeroConnection] = useState(null);
  const [xeroConnecting, setXeroConnecting] = useState(false);
  const [xeroSettings, setXeroSettings] = useState(null);
  const [xeroItemMappings, setXeroItemMappings] = useState([]);
  const [xeroAccounts, setXeroAccounts] = useState([]);
  const [xeroItems, setXeroItems] = useState([]);
  const [xeroContacts, setXeroContacts] = useState([]);
  const [xeroContactLinkTarget, setXeroContactLinkTarget] = useState(null);
  const [xeroMappingQueue, setXeroMappingQueue] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [supplierDocuments, setSupplierDocuments] = useState([]);
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [deleteSupplierTarget, setDeleteSupplierTarget] = useState(null);
  const [scaleRecipeTarget, setScaleRecipeTarget] = useState(null);
  const [viewingSupplierDocs, setViewingSupplierDocs] = useState(null);
  const [foodSafetyDisclaimerAcceptedAt, setFoodSafetyDisclaimerAcceptedAt] = useState(null);
  const [salesModuleEnabled, setSalesModuleEnabled] = useState(true);
  const [teammates, setTeammates] = useState([]);
  const [inviteLink, setInviteLink] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [tanks, setTanks] = useState([]);
  const [showAddTank, setShowAddTank] = useState(false);
  const [stockTakes, setStockTakes] = useState([]);
  const [foodSafetyRecords, setFoodSafetyRecords] = useState([]);
  const [activeChecklistTemplate, setActiveChecklistTemplate] = useState(null);
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [showIllnessModal, setShowIllnessModal] = useState(false);
  const [activeNoteModal, setActiveNoteModal] = useState(null);
  const [viewingStaffTraining, setViewingStaffTraining] = useState(null);
  const [showStockTake, setShowStockTake] = useState(false);
  const [showStockTakeHistory, setShowStockTakeHistory] = useState(false);
  const [viewingStockTake, setViewingStockTake] = useState(null);
  const [showConsumablesStockTake, setShowConsumablesStockTake] = useState(false);
  const [showConsumablesStockTakeHistory, setShowConsumablesStockTakeHistory] = useState(false);
  const [viewingConsumablesStockTake, setViewingConsumablesStockTake] = useState(null);
  const [editTankTarget, setEditTankTarget] = useState(null);
  const [deleteTankTarget, setDeleteTankTarget] = useState(null);
  const [deleteRecipeTarget, setDeleteRecipeTarget] = useState(null);
  const [editRecipeTarget, setEditRecipeTarget] = useState(null);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState(null);
  const [assignTankTarget, setAssignTankTarget] = useState(null);
  const [vesselTransferTarget, setVesselTransferTarget] = useState(null);
  const [editSplitTanksTarget, setEditSplitTanksTarget] = useState(null);
  const [fermenterTransferTarget, setFermenterTransferTarget] = useState(null);
  const [startPackagingTarget, setStartPackagingTarget] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const askConfirm = (message, onConfirm, opts = {}) => setConfirmTarget({ message, onConfirm, ...opts });
  const [diacetylTestTarget, setDiacetylTestTarget] = useState(null);

  // Watch the Supabase auth session. This runs once and fires again on
  // sign-in, sign-out, or token refresh — session becomes null on sign-out.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Confirmation links auto-sign the user in via the token in the URL —
  // strip it out and sign back out so they land on a proper sign-in
  // screen instead of skipping straight past it.
  useEffect(() => {
    if (!justConfirmedEmail) return;
    window.history.replaceState(null, "", window.location.pathname);
    supabase.auth.signOut();
  }, [justConfirmedEmail]);

  const user = session
    ? { id: session.user.id, email: session.user.email, name: session.user.user_metadata?.name || session.user.email.split("@")[0] }
    : null;

  // Load every table for the signed-in user once we have a session.
  useEffect(() => {
    if (!user) {
      setBatches([]);
      setActivityLog([]);
      setInventory([]);
      setConsumables([]);
      setPackageTypes([]);
      setPurchaseOrders([]);
      setRecipes([]);
      setProfile(null);
      setCompanyName("");
      setCompanyLogo("");
      setFoodSafetyDisclaimerAcceptedAt(null);
      setTeammates([]);
      setTanks([]);
      setStockTakes([]);
      setFoodSafetyRecords([]);
      setXeroConnection(null);
      setXeroSettings(null);
      setXeroItemMappings([]);
      setSuppliers([]);
      setSupplierDocuments([]);
      return;
    }
    let cancelled = false;
    setLoadingData(true);
    (async () => {
      try {
      // Every account belongs to a company. If this is the very first time
      // this user has ever loaded the app, they won't have a profile row
      // yet — create/join their company now using what they entered at
      // sign-up (stashed in their auth metadata).
      let profileRow = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (!profileRow.data) {
        const meta = session.user.user_metadata || {};
        const memberName = meta.name || user.email.split("@")[0];
        const { error: joinError } = meta.inviteToken
          ? await supabase.rpc("join_via_invite", { invite_token: meta.inviteToken, member_name: memberName })
          : await supabase.rpc("join_or_create_company", { company_name: meta.company || "My Brewery", member_name: memberName });
        if (joinError) { showToast("error", meta.inviteToken ? "That invite link didn't work — check your connection and try again." : "Something didn't save — check your connection and try again."); }
        profileRow = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      }
      if (cancelled) return;
      if (!profileRow.data) {
        setLoadingData(false);
        return;
      }
      const myProfile = rowToProfile(profileRow.data);
      setProfile(myProfile);

      const [companyRes, teammatesRes, batchesRes, inventoryRes, consumablesRes, packageTypesRes, poRes, recipesRes, tanksRes, stockTakesRes, foodSafetyRes, xeroRes, xeroSettingsRes, xeroMappingsRes, suppliersRes, supplierDocsRes, activityRes, customersRes, salesOrdersRes] = await Promise.all([
        supabase.from("companies").select("name, logo_url, food_safety_disclaimer_accepted_at, food_safety_disclaimer_accepted_by, sales_module_enabled").eq("id", myProfile.companyId).single(),
        supabase.from("profiles").select("*").eq("company_id", myProfile.companyId),
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
        supabase.from("consumables").select("*").order("created_at", { ascending: false }),
        supabase.from("package_types").select("*").order("created_at", { ascending: false }),
        supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
        supabase.from("recipes").select("*").order("created_at", { ascending: false }),
        supabase.from("tanks").select("*").order("created_at", { ascending: false }),
        supabase.from("stock_takes").select("*").order("created_at", { ascending: false }),
        supabase.from("food_safety_records").select("*").order("created_at", { ascending: false }),
        supabase.from("xero_connections").select("*").eq("company_id", myProfile.companyId).maybeSingle(),
        supabase.from("xero_settings").select("*").eq("company_id", myProfile.companyId).maybeSingle(),
        supabase.from("xero_item_mappings").select("*").eq("company_id", myProfile.companyId),
        supabase.from("suppliers").select("*").order("name", { ascending: true }),
        supabase.from("supplier_documents").select("*").order("uploaded_at", { ascending: false }),
        supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(50),
        supabase.from("customers").select("*").order("name", { ascending: true }),
        supabase.from("sales_orders").select("*").order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (companyRes.error) console.error(companyRes.error);
      else {
        setCompanyName(companyRes.data.name);
        setCompanyLogo(companyRes.data.logo_url || "");
        setFoodSafetyDisclaimerAcceptedAt(companyRes.data.food_safety_disclaimer_accepted_at || null);
        setSalesModuleEnabled(companyRes.data.sales_module_enabled !== false);
      }
      if (teammatesRes.error) console.error(teammatesRes.error);
      else setTeammates(teammatesRes.data.map(rowToProfile));
      if (batchesRes.error) console.error(batchesRes.error);
      else setBatches(batchesRes.data.map(rowToBatch));
      if (inventoryRes.error) console.error(inventoryRes.error);
      else setInventory(inventoryRes.data.map(rowToInventoryItem));
      if (consumablesRes.error) console.error(consumablesRes.error);
      else setConsumables(consumablesRes.data.map(rowToConsumable));
      if (packageTypesRes.error) console.error(packageTypesRes.error);
      else setPackageTypes(packageTypesRes.data.map(rowToPackageType));
      if (poRes.error) console.error(poRes.error);
      else setPurchaseOrders(poRes.data.map(rowToPO));
      if (recipesRes.error) console.error(recipesRes.error);
      else setRecipes(recipesRes.data.map(rowToRecipe));
      if (tanksRes.error) console.error(tanksRes.error);
      else setTanks(tanksRes.data.map(rowToTank));
      if (xeroSettingsRes.error) console.error(xeroSettingsRes.error);
      else setXeroSettings(xeroSettingsRes.data || null);
      if (xeroMappingsRes.error) console.error(xeroMappingsRes.error);
      else setXeroItemMappings(xeroMappingsRes.data || []);
      if (stockTakesRes.error) console.error(stockTakesRes.error);
      else setStockTakes(stockTakesRes.data.map(rowToStockTake));
      if (xeroRes.error) console.error(xeroRes.error);
      else setXeroConnection(xeroRes.data || null);
      if (foodSafetyRes.error) console.error(foodSafetyRes.error);
      else setFoodSafetyRecords(foodSafetyRes.data.map(rowToFoodSafetyRecord));
      if (suppliersRes.error) console.error(suppliersRes.error);
      else setSuppliers(suppliersRes.data.map(rowToSupplier));
      if (supplierDocsRes.error) console.error(supplierDocsRes.error);
      else setSupplierDocuments(supplierDocsRes.data.map(rowToSupplierDocument));
      if (activityRes.error) console.error(activityRes.error);
      else setActivityLog(activityRes.data.map(rowToActivity));
      if (customersRes.error) console.error(customersRes.error);
      else setCustomers(customersRes.data.map(rowToCustomer));
      if (salesOrdersRes.error) console.error(salesOrdersRes.error);
      else setSalesOrders(salesOrdersRes.data.map(rowToSalesOrder));
      } catch (err) {
        // Whatever went wrong, never leave the app stuck on the loading
        // skeleton forever — surface it and let the user try again.
        console.error(err);
        if (!cancelled) showToast("error", "Something went wrong loading your data — check your connection and try refreshing.");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // If the app was opened via a tank's QR code, jump straight to whatever's
  // currently in it (or the Brewery list if it's empty) once data is ready.
  useEffect(() => {
    if (!tankParam || loadingData || tanks.length === 0) return;
    const tank = tanks.find((t) => t.id === tankParam);
    if (!tank) return;
    const occupant = occupyingBatch(batches, tank.id);
    if (occupant) {
      setSelectedId(occupant.id);
      setView("batches");
    } else {
      setView("brewery");
    }
  }, [tankParam, loadingData]);

  const selected = useMemo(() => batches.find((b) => b.id === selectedId) || null, [batches, selectedId]);

  // Tracks the last few batches opened, purely for the "Recently viewed"
  // strip on Home — local to this device, not synced.
  const [recentBatchIds, setRecentBatchIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("brewpoint-recent-batches") || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (!selected) return;
    setRecentBatchIds((prev) => {
      if (prev[0] === selected.id) return prev;
      const next = [selected.id, ...prev.filter((id) => id !== selected.id)].slice(0, 6);
      try {
        localStorage.setItem("brewpoint-recent-batches", JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [selected?.id]);
  const recentBatches = recentBatchIds.map((id) => batches.find((b) => b.id === id)).filter(Boolean);
  const nextNumber = useMemo(() => String(Math.max(0, ...batches.map((b) => parseInt(b.number, 10) || 0)) + 1), [batches]);
  const selectedPO = useMemo(() => purchaseOrders.find((p) => p.id === selectedPOId) || null, [purchaseOrders, selectedPOId]);
  const nextPONumber = useMemo(() => {
    const nums = purchaseOrders.map((p) => parseInt((p.poNumber.match(/\d+/) || [0])[0], 10) || 0);
    return `PO-${Math.max(100, ...nums) + 1}`;
  }, [purchaseOrders]);
  const nextSalesOrderNumber = useMemo(() => {
    const nums = salesOrders.map((o) => parseInt(((o.orderNumber || "").match(/\d+/) || [0])[0], 10) || 0);
    return `SO-${Math.max(100, ...nums) + 1}`;
  }, [salesOrders]);
  const [selectedSalesOrderId, setSelectedSalesOrderId] = useState(null);
  const selectedSalesOrder = useMemo(() => salesOrders.find((o) => o.id === selectedSalesOrderId) || null, [salesOrders, selectedSalesOrderId]);
  const availableStock = useMemo(() => availableStockList(batches, salesOrders), [batches, salesOrders]);
  const selectedRecipe = useMemo(() => recipes.find((r) => r.id === selectedRecipeId) || null, [recipes, selectedRecipeId]);
  const selectedInventoryItem = useMemo(
    () => inventory.find((it) => it.id === selectedInventoryId) || null,
    [inventory, selectedInventoryId]
  );
  const selectedConsumableItem = useMemo(
    () => consumables.find((it) => it.id === selectedConsumableId) || null,
    [consumables, selectedConsumableId]
  );
  const selectedPackageType = useMemo(
    () => packageTypes.find((pt) => pt.id === selectedPackageTypeId) || null,
    [packageTypes, selectedPackageTypeId]
  );
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Fire-and-forget: records a line in the activity feed. Never blocks or
  // fails the action it's attached to — if this insert fails, the real
  // action already succeeded, so we just log it and move on.
  const logActivity = (action, entityType, entityName, description) => {
    const entry = {
      id: uid(),
      action,
      entityType,
      entityName,
      description,
      userName: user?.name || "Someone",
      createdAt: new Date().toISOString(),
    };
    setActivityLog((prev) => [entry, ...prev].slice(0, 50));
    supabase
      .from("activity_log")
      .insert(activityToRow(entry, user.id, profile.companyId))
      .then(({ error }) => {
        if (error) console.error(error);
      });
  };

  const createInvite = async () => {
    setCreatingInvite(true);
    const { data, error } = await supabase.rpc("create_company_invite");
    setCreatingInvite(false);
    if (error) { console.error(error); showToast("error", `Couldn't create an invite link: ${error.message || "unknown error"}`); return; }
    setInviteLink(`${window.location.origin}${window.location.pathname}?invite=${data}`);
  };

  const removeTeammate = (teammate) => {
    askConfirm(
      `Remove ${teammate.name} from the team? They'll lose access to this company immediately.`,
      () => {
        setTeammates((prev) => prev.filter((t) => t.id !== teammate.id));
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[teammate.id];
          const { error } = await supabase.rpc("remove_teammate", { member_id: teammate.id });
          if (error) { showToast("error", `Couldn't remove ${teammate.name}: ${error.message || "unknown error"}`); setTeammates((prev) => [teammate, ...prev]); }
        }, 5000);
        pendingDeletesRef.current[teammate.id] = timeoutId;
        showToast("success", `${teammate.name} removed from the team.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[teammate.id]);
            delete pendingDeletesRef.current[teammate.id];
            setTeammates((prev) => [teammate, ...prev]);
          },
        });
      },
      { confirmLabel: "Remove", destructive: true }
    );
  };

  const uploadBatchPhoto = async (batchId, file) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const path = `${profile.companyId}/${batchId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("batch-photos").upload(path, file);
    if (uploadError) { showToast("error", `Couldn't upload photo: ${uploadError.message || "unknown error"}`); return; }
    const { data } = supabase.storage.from("batch-photos").getPublicUrl(path);
    const photos = [...(batch.photos || []), data.publicUrl];
    const { error } = await supabase.from("batches").update({ photos }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, photos } : b)));
  };

  const deleteBatchPhoto = async (batchId, url) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const photos = (batch.photos || []).filter((p) => p !== url);
    const { error } = await supabase.from("batches").update({ photos }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, photos } : b)));
  };

  // Timers store an absolute end time (not a countdown), so any device that
  // loads the batch computes the correct time remaining on its own — no
  // live sync needed, just a shared source of truth.
  const startBrewTimer = async (batchId, label, minutes) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const timers = [...(batch.timers || []), { id: uid(), label, endTime: Date.now() + minutes * 60000 }];
    const { error } = await supabase.from("batches").update({ timers }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, timers } : b)));
  };

  const stopBrewTimer = async (batchId, timerId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const timers = (batch.timers || []).filter((t) => t.id !== timerId);
    const { error } = await supabase.from("batches").update({ timers }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, timers } : b)));
  };

  const addBatch = async (b) => {
    // Work out which lots each ingredient will draw from — and their cost —
    // before creating the batch, so the batch record itself carries the
    // real ingredient cost from the moment it exists.
    let totalIngredientCost = 0;
    const plannedUpdates = [];
    if (b.ingredients && b.ingredients.length > 0) {
      for (const ing of b.ingredients) {
        const item = inventory.find((it) => it.name.toLowerCase() === ing.name.toLowerCase());
        if (!item) continue;

        let remainingToDeduct = ing.qty;
        const lotsUsed = [];
        const updatedLots = (item.lots || []).map((lot) => {
          const currentRemaining = lot.remainingQty ?? lot.qty;
          if (remainingToDeduct <= 0 || currentRemaining <= 0) {
            return { ...lot, remainingQty: currentRemaining };
          }
          const take = Math.round(Math.min(currentRemaining, remainingToDeduct) * 100) / 100;
          remainingToDeduct = Math.round((remainingToDeduct - take) * 100) / 100;
          if (take > 0) {
            lotsUsed.push({ lotNumber: lot.lotNumber, qty: take });
            if (lot.unitCost != null) totalIngredientCost += take * lot.unitCost;
          }
          return { ...lot, remainingQty: Math.round((currentRemaining - take) * 100) / 100 };
        });

        plannedUpdates.push({ item, updatedLots, lotsUsed });
      }
    }
    totalIngredientCost = Math.round(totalIngredientCost * 100) / 100;

    const { data, error } = await supabase
      .from("batches")
      .insert(batchToRow({ ...b, ingredientCost: totalIngredientCost }, user.id, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => [rowToBatch(data), ...prev]);
    showToast("success", `${b.name} created.`);
    logActivity("created", "batch", b.name, `${b.startDate > today() ? "Scheduled" : "Started"} batch ${b.name} (#${b.number})`);
    if (b.tankId) resetTankClean(b.tankId, b);
    (b.splitTanks || []).forEach((t) => resetTankClean(t.tankId, b));

    for (const { item, updatedLots, lotsUsed } of plannedUpdates) {
      const newQty = Math.max(0, Math.round((item.qty - (b.ingredients.find((i) => i.name.toLowerCase() === item.name.toLowerCase())?.qty || 0)) * 100) / 100);
      const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "batch",
        delta: actualDelta,
        note: `${b.name} (#${b.number})`,
        lots: lotsUsed,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error: invError } = await supabase
        .from("inventory_items")
        .update({ qty: newQty, lots: updatedLots, history: newHistory })
        .eq("id", item.id);
      if (invError) { showToast("error", "Something didn't save — check your connection and try again."); }
      else setInventory((prev) => prev.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
    }
  };

  const updateScheduledBatch = async (id, patch) => {
    const row = {
      name: patch.name,
      style: patch.style,
      volume: patch.volume,
      start_date: patch.startDate,
      planned_days: patch.plannedDays,
      tank_id: patch.tankId,
      tank_name: patch.tankName,
      recipe_id: patch.recipeId,
      recipe_name: patch.recipeName,
      readings: patch.readings,
    };
    const { error } = await supabase.from("batches").update(row).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    showToast("success", "Schedule updated.");
  };

  const deleteBatch = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    // Remove from view immediately; the real inventory rollback + DB delete
    // are delayed so Undo can cancel them before anything actually happens.
    setBatches((prev) => prev.filter((b) => b.id !== id));
    setSelectedId(null);
    logActivity("deleted", "batch", batch.name, `${batch.name} (#${batch.number}) deleted`);

    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const batchTag = `${batch.name} (#${batch.number})`;

      let nextInventory = [...inventory];
      for (let i = 0; i < nextInventory.length; i++) {
        const item = nextInventory[i];
        const usageEntries = (item.history || []).filter((h) => h.type === "batch" && h.note === batchTag);
        if (usageEntries.length === 0) continue;

        let qty = item.qty;
        let lots = [...(item.lots || [])];
        const restoreHistory = [];

        usageEntries.forEach((entry) => {
          const restoreQty = Math.round(-entry.delta * 100) / 100;
          qty = Math.round((qty + restoreQty) * 100) / 100;
          (entry.lots || []).forEach((used) => {
            lots = lots.map((lot) =>
              lot.lotNumber === used.lotNumber
                ? { ...lot, remainingQty: Math.min(lot.qty, Math.round(((lot.remainingQty ?? lot.qty) + used.qty) * 100) / 100) }
                : lot
            );
          });
          restoreHistory.push({
            id: uid(),
            date: new Date().toISOString(),
            user: user.name,
            type: "restored",
            delta: restoreQty,
            note: `Batch deleted — ${batchTag}`,
          });
        });

        const newHistory = [...(item.history || []), ...restoreHistory];
        const { error: invError } = await supabase.from("inventory_items").update({ qty, lots, history: newHistory }).eq("id", item.id);
        if (invError) {
          showToast("error", "Something didn't save — check your connection and try again.");
          continue;
        }
        nextInventory[i] = { ...item, qty, lots, history: newHistory };
      }
      setInventory(nextInventory);

      const { error } = await supabase.from("batches").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);

    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${batch.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setBatches((prev) => [batch, ...prev]);
      },
    });
  };

  const addRecipe = async (r) => {
    const familyId = r.familyId || uid();
    const versionsInFamily = recipes.filter((rec) => rec.familyId === familyId);
    const version = versionsInFamily.length > 0 ? Math.max(...versionsInFamily.map((v) => v.version || 1)) + 1 : 1;
    const payload = { ...r, familyId, version, isActive: true };
    const { data, error } = await supabase.from("recipes").insert(recipeToRow(payload, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    const newRecipe = rowToRecipe(data);

    if (versionsInFamily.length > 0) {
      const siblingIds = versionsInFamily.map((v) => v.id);
      const { error: deactivateError } = await supabase.from("recipes").update({ is_active: false }).in("id", siblingIds);
      if (deactivateError) { showToast("error", "Something didn't save — check your connection and try again."); }
    }

    setRecipes((prev) => [newRecipe, ...prev.map((rec) => (rec.familyId === familyId ? { ...rec, isActive: false } : rec))]);
    setSelectedRecipeId(newRecipe.id);
    logActivity("created", "recipe", newRecipe.name, `${version > 1 ? "New version of" : "Recipe"} ${newRecipe.name} saved`);
    return newRecipe;
  };

  const saveAndBrewRecipe = async (r) => {
    const newRecipe = await addRecipe(r);
    if (!newRecipe) return;
    setBrewRecipe(newRecipe);
    setSelectedRecipeId(null);
    setView("batches");
    setShowAdd(true);
  };

  const scaleRecipe = (recipe, newVolume) => {
    const ratio = newVolume / recipe.volume;
    const scaledIngredients = recipe.ingredients.map((i) => ({ ...i, qty: Math.round(i.qty * ratio * 1000) / 1000 }));
    const scaledSchedule = (recipe.schedule || []).map((s) => ({ ...s, amount: Math.round((Number(s.amount) || 0) * ratio * 1000) / 1000 }));
    let scaledWaterChemistry = null;
    if (recipe.waterChemistry) {
      const saltGrams = Object.fromEntries(
        Object.entries(recipe.waterChemistry.saltGrams || {}).map(([k, v]) => [
          k,
          v === "" || v == null ? "" : Math.round(Number(v) * ratio * 100) / 100,
        ])
      );
      scaledWaterChemistry = { ...recipe.waterChemistry, saltGrams };
    }
    addRecipe({
      id: uid(),
      name: recipe.name,
      style: recipe.style,
      volume: newVolume,
      og: recipe.og,
      fg: recipe.fg,
      ingredients: scaledIngredients,
      schedule: scaledSchedule,
      familyId: recipe.familyId,
      efficiency: recipe.efficiency,
      boilTime: recipe.boilTime,
      waterChemistry: scaledWaterChemistry,
    });
  };

  const setActiveRecipeVersion = async (recipeId, familyId) => {
    const versionsInFamily = recipes.filter((rec) => rec.familyId === familyId);
    const otherIds = versionsInFamily.map((v) => v.id).filter((id) => id !== recipeId);
    const { error: activateError } = await supabase.from("recipes").update({ is_active: true }).eq("id", recipeId);
    if (activateError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    if (otherIds.length > 0) {
      const { error: deactivateError } = await supabase.from("recipes").update({ is_active: false }).in("id", otherIds);
      if (deactivateError) { showToast("error", "Something didn't save — check your connection and try again."); }
    }
    setRecipes((prev) => prev.map((rec) => (rec.familyId === familyId ? { ...rec, isActive: rec.id === recipeId } : rec)));
  };

  const deleteRecipe = async (id) => {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe) return;
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setSelectedRecipeId(null);
    logActivity("deleted", "recipe", recipe.name, `${recipe.name} deleted`);
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("recipes").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${recipe.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setRecipes((prev) => [recipe, ...prev]);
      },
    });
  };

  const uploadCompanyLogo = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const maxSize = 240;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        const { error } = await supabase.from("companies").update({ logo_url: dataUrl }).eq("id", profile.companyId);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setCompanyLogo(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const removeCompanyLogo = async () => {
    const { error } = await supabase.from("companies").update({ logo_url: null }).eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCompanyLogo("");
  };

  const acceptFoodSafetyDisclaimer = async () => {
    const acceptedAt = new Date().toISOString();
    const { error } = await supabase
      .from("companies")
      .update({ food_safety_disclaimer_accepted_at: acceptedAt, food_safety_disclaimer_accepted_by: user.name })
      .eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setFoodSafetyDisclaimerAcceptedAt(acceptedAt);
  };

  // Sales (Customers + Orders) is a genuinely optional module — plenty of
  // breweries run their sales through something else entirely (Upstock,
  // spreadsheets, whatever), so this just hides the whole section rather
  // than forcing it on everyone.
  const toggleSalesModule = async (enabled) => {
    const { error } = await supabase.from("companies").update({ sales_module_enabled: enabled }).eq("id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesModuleEnabled(enabled);
    if (!enabled && (view === "customers" || view === "salesOrders")) setView("home");
  };

  const disconnectXero = async () => {
    const { error } = await supabase.from("xero_connections").delete().eq("company_id", profile.companyId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setXeroConnection(null);
  };

  const callXeroApi = async (action, extra) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/xero-api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
      body: JSON.stringify({ action, companyId: profile.companyId, ...extra }),
    });
    return res.json();
  };

  const loadXeroAccounts = async () => {
    const data = await callXeroApi("listAccounts");
    if (data.error) {
      showToast("error", "Something didn't save — check your connection and try again.");
      return;
    }
    setXeroAccounts(data.accounts || []);
  };

  // Opens the link-a-customer-to-Xero picker — fetches the current Xero
  // contact list fresh each time, since it's cheap and avoids showing a
  // stale list if someone's added contacts directly in Xero since.
  const openXeroContactLink = async (customer) => {
    setXeroContactLinkTarget(customer);
    const data = await callXeroApi("listContacts");
    if (data.error) {
      showToast("error", "Couldn't load Xero contacts — check your Xero connection.");
      return;
    }
    setXeroContacts(data.contacts || []);
  };

  const linkCustomerToXero = async (customerId, xeroContactId, xeroContactName) => {
    const { error } = await supabase
      .from("customers")
      .update({ xero_contact_id: xeroContactId, xero_contact_name: xeroContactName })
      .eq("id", customerId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, xeroContactId, xeroContactName } : c)));
    setXeroContactLinkTarget(null);
    showToast("success", `Linked to ${xeroContactName} in Xero.`);
  };

  const unlinkCustomerFromXero = async (customerId) => {
    const { error } = await supabase.from("customers").update({ xero_contact_id: null, xero_contact_name: null }).eq("id", customerId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, xeroContactId: null, xeroContactName: null } : c)));
  };

  // Creates a brand-new contact in Xero from a Brewpoint customer's
  // details, then immediately links the two — for a customer that doesn't
  // already exist in Xero at all.
  const createXeroContactForCustomer = async (customer) => {
    const result = await callXeroApi("createContact", { name: customer.name, email: customer.email || null });
    if (result.error) {
      showToast("error", "Couldn't create the Xero contact — check your Xero connection.");
      return;
    }
    await linkCustomerToXero(customer.id, result.contactId, result.contactName || customer.name);
  };

  const saveXeroAdjustmentAccount = async (code, name) => {
    const { error } = await supabase
      .from("xero_settings")
      .upsert({ company_id: profile.companyId, adjustment_account_code: code, adjustment_account_name: name });
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setXeroSettings({ company_id: profile.companyId, adjustment_account_code: code, adjustment_account_name: name });
  };

  const productKeyFor = (batchName, containerKey) => `${batchName.trim().toLowerCase()}::${containerKey}`;

  const postPackagingLineToXero = async (batch, mapping, qty) => {
    const result = await callXeroApi("postStock", {
      itemCode: mapping.xero_item_code,
      quantity: qty,
      direction: "increase",
      unitCost: mapping.unit_cost,
      adjustmentAccountCode: xeroSettings.adjustment_account_code,
      reference: `${batch.name} (#${batch.number})`,
    });
    if (result.error) console.error("Xero sync failed:", result.error, result.detail);
    return result;
  };

  const syncPackagingToXero = async (batch, sessionCounts) => {
    if (!xeroConnection || !xeroSettings?.adjustment_account_code) return;
    const lines = CONTAINERS.filter((c) => (sessionCounts[c.key] || 0) > 0).map((c) => ({
      containerKey: c.key,
      containerLabel: c.label,
      qty: sessionCounts[c.key],
      productKey: productKeyFor(batch.name, c.key),
      productLabel: `${batch.name} — ${c.label}`,
    }));
    if (lines.length === 0) return;

    const unmapped = lines.filter((l) => !xeroItemMappings.some((m) => m.product_key === l.productKey));
    if (unmapped.length > 0) {
      const data = await callXeroApi("listItems");
      setXeroItems(data.items || []);
      setXeroMappingQueue({ batch, lines });
      return;
    }

    for (const line of lines) {
      const mapping = xeroItemMappings.find((m) => m.product_key === line.productKey);
      await postPackagingLineToXero(batch, mapping, line.qty);
    }
  };

  const confirmXeroMappings = async (resolvedLines) => {
    const { batch } = xeroMappingQueue;
    const newMappings = [];
    for (const line of resolvedLines) {
      if (!line.itemCode) continue;
      const record = {
        id: uid(),
        company_id: profile.companyId,
        product_key: line.productKey,
        product_label: line.productLabel,
        xero_item_code: line.itemCode,
        xero_item_name: line.itemName,
        unit_cost: Number(line.unitCost) || 0,
      };
      const { error } = await supabase.from("xero_item_mappings").upsert(record, { onConflict: "company_id,product_key" });
      if (error) {
        showToast("error", "Something didn't save — check your connection and try again.");
        continue;
      }
      newMappings.push(record);
    }
    const updatedMappings = [...xeroItemMappings.filter((m) => !newMappings.some((n) => n.product_key === m.product_key)), ...newMappings];
    setXeroItemMappings(updatedMappings);

    for (const line of resolvedLines) {
      if (!line.itemCode) continue;
      const mapping = updatedMappings.find((m) => m.product_key === line.productKey);
      if (mapping) await postPackagingLineToXero(batch, mapping, line.qty);
    }
    setXeroMappingQueue(null);
  };

  const completeStockTake = async (lines) => {
    const date = today();
    let nextInventory = [...inventory];

    for (const line of lines) {
      if (line.discrepancy === 0) continue;
      const idx = nextInventory.findIndex((it) => it.id === line.itemId);
      if (idx < 0) continue;
      const item = nextInventory[idx];
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "stocktake",
        delta: line.discrepancy,
        note: `Stock take ${date}`,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error } = await supabase.from("inventory_items").update({ qty: line.countedQty, history: newHistory }).eq("id", item.id);
      if (error) {
        showToast("error", "Something didn't save — check your connection and try again.");
        continue;
      }
      nextInventory[idx] = { ...item, qty: line.countedQty, history: newHistory };
    }
    setInventory(nextInventory);

    const record = { id: uid(), date, userName: user.name, lines, type: "inventory" };
    const { data, error: stError } = await supabase
      .from("stock_takes")
      .insert(stockTakeToRow(record, user.id, profile.companyId))
      .select()
      .single();
    if (stError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setStockTakes((prev) => [rowToStockTake(data), ...prev]);
  };

  // Same idea as completeStockTake, just walking the cans/kegs/labels
  // shelf instead of the ingredients shelf.
  const completeConsumablesStockTake = async (lines) => {
    const date = today();
    let nextConsumables = [...consumables];

    for (const line of lines) {
      if (line.discrepancy === 0) continue;
      const idx = nextConsumables.findIndex((it) => it.id === line.itemId);
      if (idx < 0) continue;
      const item = nextConsumables[idx];
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "stocktake",
        delta: line.discrepancy,
        note: `Stock take ${date}`,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error } = await supabase.from("consumables").update({ qty: line.countedQty, history: newHistory }).eq("id", item.id);
      if (error) {
        showToast("error", "Something didn't save — check your connection and try again.");
        continue;
      }
      nextConsumables[idx] = { ...item, qty: line.countedQty, history: newHistory };
    }
    setConsumables(nextConsumables);

    const record = { id: uid(), date, userName: user.name, lines, type: "consumables" };
    const { data, error: stError } = await supabase
      .from("stock_takes")
      .insert(stockTakeToRow(record, user.id, profile.companyId))
      .select()
      .single();
    if (stError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setStockTakes((prev) => [rowToStockTake(data), ...prev]);
  };

  const addFoodSafetyRecord = async (record) => {
    const payload = { id: uid(), userName: user.name, ...record };
    const { data, error } = await supabase
      .from("food_safety_records")
      .insert(foodSafetyRecordToRow(payload, user.id, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setFoodSafetyRecords((prev) => [rowToFoodSafetyRecord(data), ...prev]);
    showToast("success", "Logged.");
  };

  const addSupplier = async (supplier) => {
    const payload = { id: uid(), ...supplier };
    const { data, error } = await supabase
      .from("suppliers")
      .insert(supplierToRow(payload, profile.companyId))
      .select()
      .single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSuppliers((prev) => [...prev, rowToSupplier(data)].sort((a, b) => a.name.localeCompare(b.name)));
    showToast("success", `${payload.name} added.`);
  };

  const updateSupplier = async (id, patch) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) return;
    const updated = { ...supplier, ...patch };
    const { error } = await supabase
      .from("suppliers")
      .update(supplierToRow(updated, profile.companyId))
      .eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSuppliers((prev) => prev.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteSupplier = async (id) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) return;
    const relatedDocs = supplierDocuments.filter((d) => d.supplierId === id);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setSupplierDocuments((prev) => prev.filter((d) => d.supplierId !== id));
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${supplier.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setSuppliers((prev) => [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)));
        setSupplierDocuments((prev) => [...prev, ...relatedDocs]);
      },
    });
  };

  const addCustomer = async (customer) => {
    const row = customerToRow(customer, profile.companyId);
    delete row.id; // uid() makes a short client-side key, not a real UUID — let Postgres generate the real one
    const { data, error } = await supabase
      .from("customers")
      .insert(row)
      .select()
      .single();
    if (error) { showToast("error", `Save failed: ${error.message || error.code || "unknown error"}`); return; }
    setCustomers((prev) => [...prev, rowToCustomer(data)].sort((a, b) => a.name.localeCompare(b.name)));
    showToast("success", `${customer.name} added.`);
  };

  const updateCustomer = async (id, patch) => {
    const customer = customers.find((c) => c.id === id);
    if (!customer) return;
    const updated = { ...customer, ...patch };
    const { error } = await supabase
      .from("customers")
      .update(customerToRow(updated, profile.companyId))
      .eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setCustomers((prev) => prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteCustomer = (customer) => {
    askConfirm(
      `Delete ${customer.name}? You'll have a few seconds to undo right after.`,
      () => {
        setCustomers((prev) => prev.filter((c) => c.id !== customer.id));
        setSelectedCustomerId(null);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[customer.id];
          const { error } = await supabase.from("customers").delete().eq("id", customer.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[customer.id] = timeoutId;
        showToast("success", `${customer.name} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[customer.id]);
            delete pendingDeletesRef.current[customer.id];
            setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)));
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const addSalesOrder = async (order) => {
    const row = salesOrderToRow(order, profile.companyId);
    delete row.id; // same fix as addCustomer — let Postgres generate the real UUID
    const { data, error } = await supabase
      .from("sales_orders")
      .insert(row)
      .select()
      .single();
    if (error) { showToast("error", `Save failed: ${error.message || error.code || "unknown error"}`); return; }
    setSalesOrders((prev) => [rowToSalesOrder(data), ...prev]);
    showToast("success", `${order.orderNumber} created.`);
    logActivity("created", "sales order", order.orderNumber, `Sales order ${order.orderNumber} created`);
  };

  // Fires once an order is marked Fulfilled — reuses the same item mappings
  // already built up from packaging sync, and either matches or creates a
  // Xero contact for the customer server-side. If Xero isn't connected,
  // this just quietly does nothing, same as the packaging sync does.
  const syncOrderToXero = async (order) => {
    if (!xeroConnection) return;
    const customer = customers.find((c) => c.id === order.customerId);
    if (!customer) return;
    const lineItems = (order.lines || []).map((l) => {
      const mapping = xeroItemMappings.find((m) => m.product_key === productKeyFor(l.batchName, l.containerKey));
      return {
        description: `${l.batchName} — ${l.containerLabel}`,
        quantity: l.qty,
        unitAmount: l.unitPrice,
        itemCode: mapping ? mapping.xero_item_code : null,
      };
    });
    const result = await callXeroApi("createInvoice", {
      contactId: customer.xeroContactId || null,
      customerName: customer.name,
      customerEmail: customer.email || null,
      reference: order.orderNumber,
      lineItems,
    });
    if (result.error) {
      console.error("Xero invoice sync failed:", result.error, result.detail);
      showToast("error", "Order fulfilled, but the Xero invoice couldn't be created — check your Xero connection.");
    } else {
      showToast("success", "Invoice sent to Xero.");
    }
  };

  const advanceSalesOrderStatus = async (id, status) => {
    const { error } = await supabase.from("sales_orders").update({ status }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    showToast("success", status === "Fulfilled" ? "Order marked fulfilled — stock updated." : `Order ${status.toLowerCase()}.`);
    if (status === "Fulfilled") {
      const order = salesOrders.find((o) => o.id === id);
      if (order) syncOrderToXero({ ...order, status });
    }
  };

  const cancelSalesOrder = (id) => {
    askConfirm(
      "Cancel this order? Any stock it had reserved will become available to sell again.",
      async () => {
        const { error } = await supabase.from("sales_orders").update({ status: "Cancelled" }).eq("id", id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setSalesOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: "Cancelled" } : o)));
        showToast("success", "Order cancelled.");
      },
      { confirmLabel: "Cancel order", destructive: true }
    );
  };

  const toggleSalesOrderPaid = async (id, paid) => {
    const { error } = await supabase.from("sales_orders").update({ paid }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSalesOrders((prev) => prev.map((o) => (o.id === id ? { ...o, paid } : o)));
  };

  const deleteSalesOrder = (order) => {
    askConfirm(
      `Delete ${order.orderNumber}? This can't be undone.`,
      async () => {
        const { error } = await supabase.from("sales_orders").delete().eq("id", order.id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setSalesOrders((prev) => prev.filter((o) => o.id !== order.id));
        setSelectedSalesOrderId(null);
        showToast("success", `${order.orderNumber} deleted.`);
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const uploadSupplierDocument = async (supplierId, file, name, expiryDate) => {
    const filePath = `${profile.companyId}/${supplierId}/${uid()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("supplier-documents").upload(filePath, file);
    if (uploadError) {
      console.error(uploadError);
      return { error: uploadError.message };
    }
    const payload = {
      id: uid(),
      supplierId,
      name: name || file.name,
      filePath,
      fileType: file.type,
      expiryDate: expiryDate || null,
      uploadedBy: user.name,
    };
    const { data, error } = await supabase
      .from("supplier_documents")
      .insert(supplierDocumentToRow(payload, profile.companyId))
      .select()
      .single();
    if (error) {
      console.error(error);
      return { error: error.message };
    }
    setSupplierDocuments((prev) => [rowToSupplierDocument(data), ...prev]);
    showToast("success", "Document uploaded.");
    return { success: true };
  };

  const deleteSupplierDocument = async (doc) => {
    await supabase.storage.from("supplier-documents").remove([doc.filePath]);
    const { error } = await supabase.from("supplier_documents").delete().eq("id", doc.id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setSupplierDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  };

  const openSupplierDocument = async (doc) => {
    const { data, error } = await supabase.storage.from("supplier-documents").createSignedUrl(doc.filePath, 60);
    if (error) {
      showToast("error", "Something didn't save — check your connection and try again.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const addTank = async (t) => {
    const { data, error } = await supabase.from("tanks").insert(tankToRow(t, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => [rowToTank(data), ...prev]);
    showToast("success", `${t.name} added.`);
    logActivity("added", "tank", t.name, `Tank ${t.name} added`);
  };

  const updateTank = async (id, patch) => {
    const { error } = await supabase.from("tanks").update({ name: patch.name, capacity: patch.capacity, type: patch.type }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  // Cycles a tank through the CIP workflow — tapping the badge on an empty
  // tank moves it to the next step. Sanitised loops back to Needs CIP if
  // tapped again, in case that was a mistake.
  const cycleTankClean = async (id) => {
    const tank = tanks.find((t) => t.id === id);
    if (!tank) return;
    const next = NEXT_CLEAN_STAGE[tank.cleanStatus || "Needs CIP"] || "Needs CIP";
    const history = [...(tank.history || []), { id: uid(), type: "clean", date: new Date().toISOString(), stage: next }];
    const { error } = await supabase.from("tanks").update({ clean_status: next, history }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, cleanStatus: next, history } : t)));
  };

  // For Brite tanks choosing between acid and caustic clean — sets the
  // stage directly rather than just advancing to "next."
  const setTankCleanStage = async (id, stage) => {
    const tank = tanks.find((t) => t.id === id);
    if (!tank) return;
    const history = [...(tank.history || []), { id: uid(), type: "clean", date: new Date().toISOString(), stage }];
    const { error } = await supabase.from("tanks").update({ clean_status: stage, history }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, cleanStatus: stage, history } : t)));
  };

  // Whenever a tank starts being used by a batch, its clean status resets —
  // so the next time it empties out, it correctly starts a fresh CIP cycle
  // instead of showing a stale "Sanitised" from before. Also logs a batch
  // history entry — this is what lets the tank's history view show every
  // batch that's ever used it.
  const resetTankClean = async (tankId, batch) => {
    if (!tankId) return;
    const tank = tanks.find((t) => t.id === tankId);
    const historyEntry = batch
      ? [{ id: uid(), type: "batch", date: new Date().toISOString(), batchId: batch.id, batchName: batch.name, batchNumber: batch.number }]
      : [];
    const history = [...(tank?.history || []), ...historyEntry];
    await supabase.from("tanks").update({ clean_status: null, history }).eq("id", tankId);
    setTanks((prev) => prev.map((t) => (t.id === tankId ? { ...t, cleanStatus: null, history } : t)));
  };

  const deleteTank = async (id) => {
    const tank = tanks.find((t) => t.id === id);
    if (!tank) return;
    setTanks((prev) => prev.filter((t) => t.id !== id));
    logActivity("deleted", "tank", tank.name, `Tank ${tank.name} deleted`);
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("tanks").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${tank.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setTanks((prev) => [tank, ...prev]);
      },
    });
  };

  const assignBatchTank = async (batchId, tank, brewStage) => {
    const batch = batches.find((b) => b.id === batchId);
    const { error } = await supabase
      .from("batches")
      .update({ tank_id: tank ? tank.id : null, tank_name: tank ? tank.name : null, brew_stage: brewStage ?? null })
      .eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, tankId: tank ? tank.id : null, tankName: tank ? tank.name : null, brewStage: brewStage ?? null } : b))
    );
    if (tank) resetTankClean(tank.id, batch);
  };

  const updateBatchSplitTanks = async (batchId, splitTanks) => {
    const batch = batches.find((b) => b.id === batchId);
    const { error } = await supabase.from("batches").update({ split_tanks: splitTanks }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, splitTanks } : b)));
    splitTanks.forEach((t) => resetTankClean(t.tankId, batch));
  };

  const addInventoryItem = async (item) => {
    const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(item, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => [rowToInventoryItem(data), ...prev]);
    showToast("success", `${item.name} added to inventory.`);
  };

  const deleteInventoryItem = (item) => {
    askConfirm(
      `Delete ${item.name}? You'll have a few seconds to undo right after.`,
      () => {
        setInventory((prev) => prev.filter((it) => it.id !== item.id));
        setSelectedInventoryId(null);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[item.id];
          const { error } = await supabase.from("inventory_items").delete().eq("id", item.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[item.id] = timeoutId;
        showToast("success", `${item.name} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[item.id]);
            delete pendingDeletesRef.current[item.id];
            setInventory((prev) => [item, ...prev]);
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const updateInventorySupplier = async (id, supplierId) => {
    const { error } = await supabase.from("inventory_items").update({ supplier_id: supplierId }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, supplierId } : it)));
  };

  const adjustInventory = async (id, delta) => {
    const item = inventory.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "manual", delta: actualDelta, note: "Manual adjustment" };
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("inventory_items").update({ qty: newQty, history: newHistory }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const adjustInventoryWithNote = async (id, delta, batchRef) => {
    const item = inventory.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const historyEntry = {
      id: uid(),
      date: new Date().toISOString(),
      user: user.name,
      type: "manual",
      delta: actualDelta,
      note: batchRef ? `Manual adjustment — Batch ${batchRef}` : "Manual adjustment",
    };
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("inventory_items").update({ qty: newQty, history: newHistory }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const addConsumable = async (item) => {
    const { data, error } = await supabase.from("consumables").insert(consumableToRow(item, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => [rowToConsumable(data), ...prev]);
    showToast("success", `${item.name} added to consumables.`);
  };

  const deleteConsumable = (item) => {
    askConfirm(
      `Delete ${item.name}? You'll have a few seconds to undo right after.`,
      () => {
        setConsumables((prev) => prev.filter((it) => it.id !== item.id));
        setSelectedConsumableId(null);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[item.id];
          const { error } = await supabase.from("consumables").delete().eq("id", item.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[item.id] = timeoutId;
        showToast("success", `${item.name} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[item.id]);
            delete pendingDeletesRef.current[item.id];
            setConsumables((prev) => [item, ...prev]);
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const updateConsumableSupplier = async (id, supplierId) => {
    const { error } = await supabase.from("consumables").update({ supplier_id: supplierId }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, supplierId } : it)));
  };

  const updateConsumableCost = async (id, costPerUnit) => {
    const { error } = await supabase.from("consumables").update({ cost_per_unit: costPerUnit }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, costPerUnit } : it)));
    showToast("success", "Cost updated.");
  };

  const adjustConsumable = async (id, delta) => {
    const item = consumables.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "manual", delta: actualDelta, note: "Manual adjustment" };
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const adjustConsumableWithNote = async (id, delta, batchRef) => {
    const item = consumables.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
    const historyEntry = {
      id: uid(),
      date: new Date().toISOString(),
      user: user.name,
      type: "manual",
      delta: actualDelta,
      note: batchRef ? `Manual adjustment — Batch ${batchRef}` : "Manual adjustment",
    };
    const newHistory = [...(item.history || []), historyEntry];
    const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setConsumables((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const addPackageType = async (packageType) => {
    const { data, error } = await supabase.from("package_types").insert(packageTypeToRow(packageType, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPackageTypes((prev) => [rowToPackageType(data), ...prev]);
    showToast("success", `${packageType.name} added.`);
  };

  const deletePackageType = async (id) => {
    const packageType = packageTypes.find((pt) => pt.id === id);
    if (!packageType) return;
    setPackageTypes((prev) => prev.filter((pt) => pt.id !== id));
    setSelectedPackageTypeId(null);
    const timeoutId = setTimeout(async () => {
      delete pendingDeletesRef.current[id];
      const { error } = await supabase.from("package_types").delete().eq("id", id);
      if (error) showToast("error", "Something didn't save — check your connection and try again.");
    }, 5000);
    pendingDeletesRef.current[id] = timeoutId;
    showToast("success", `${packageType.name} deleted.`, {
      label: "Undo",
      onClick: () => {
        clearTimeout(pendingDeletesRef.current[id]);
        delete pendingDeletesRef.current[id];
        setPackageTypes((prev) => [packageType, ...prev]);
      },
    });
  };

  const createReorderPO = async (supplierName, items) => {
    const po = {
      id: uid(),
      poNumber: nextPONumber,
      supplier: supplierName,
      orderDate: today(),
      receivedDate: null,
      status: "Draft",
      deliveryCost: null,
      lines: items.map((it) => ({
        id: uid(),
        name: it.name,
        category: it.category,
        qty: Math.max(it.threshold * 2 - it.qty, it.threshold, 1),
        unit: it.unit,
        costPerUnit: it.costPerUnit ?? null,
      })),
    };
    await addPO(po);
    setView("orders");
    setSelectedPOId(po.id);
  };

  const addPO = async (po) => {
    const { data, error } = await supabase.from("purchase_orders").insert(poToRow(po, user.id, profile.companyId)).select().single();
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => [rowToPO(data), ...prev]);
    showToast("success", `${po.poNumber} created.`);
    logActivity("created", "purchase order", po.poNumber, `Purchase order ${po.poNumber} created for ${po.supplier}`);
  };

  const deletePO = (po) => {
    askConfirm(
      `Delete ${po.poNumber}? You'll have a few seconds to undo right after.`,
      () => {
        setPurchaseOrders((prev) => prev.filter((p) => p.id !== po.id));
        setSelectedPOId(null);
        logActivity("deleted", "purchase order", po.poNumber, `Purchase order ${po.poNumber} deleted`);
        const timeoutId = setTimeout(async () => {
          delete pendingDeletesRef.current[po.id];
          const { error } = await supabase.from("purchase_orders").delete().eq("id", po.id);
          if (error) showToast("error", "Something didn't save — check your connection and try again.");
        }, 5000);
        pendingDeletesRef.current[po.id] = timeoutId;
        showToast("success", `${po.poNumber} deleted.`, {
          label: "Undo",
          onClick: () => {
            clearTimeout(pendingDeletesRef.current[po.id]);
            delete pendingDeletesRef.current[po.id];
            setPurchaseOrders((prev) => [po, ...prev]);
          },
        });
      },
      { confirmLabel: "Delete", destructive: true }
    );
  };

  const markPOSent = async (id) => {
    const { error } = await supabase.from("purchase_orders").update({ status: "Sent" }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Sent" } : p)));
  };

  const receivePO = async (id, lotNumbers) => {
    const po = purchaseOrders.find((p) => p.id === id);
    if (!po) return;

    // Delivery cost is spread across lines in proportion to each line's own
    // value — a line that's a bigger share of the order's cost carries a
    // bigger share of the delivery cost too.
    const totalValue = po.lines.reduce((sum, l) => sum + (l.qty || 0) * (l.costPerUnit || 0), 0);
    const deliveryCost = po.deliveryCost || 0;

    let nextInventory = [...inventory];
    const finalizedLines = [];
    for (const line of po.lines) {
      const lotNumber = (lotNumbers && lotNumbers[line.id] && lotNumbers[line.id].trim()) || "no lot #";
      finalizedLines.push({ ...line, lotNumber });
      const idx = nextInventory.findIndex((it) => it.name.toLowerCase() === line.name.toLowerCase());
      const lineValue = (line.qty || 0) * (line.costPerUnit || 0);
      const deliveryShare = totalValue > 0 ? (lineValue / totalValue) * deliveryCost : 0;
      const unitCost = line.costPerUnit != null ? line.costPerUnit + (line.qty > 0 ? deliveryShare / line.qty : 0) : null;
      const lotEntry = { id: uid(), lotNumber, qty: line.qty, remainingQty: line.qty, date: today(), poNumber: po.poNumber, unitCost };
      const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "received", delta: line.qty, note: `${po.poNumber} — ${po.supplier}` };

      if (idx >= 0) {
        const item = nextInventory[idx];
        const newQty = Math.round((item.qty + line.qty) * 100) / 100;
        const newLots = [...(item.lots || []), lotEntry];
        const newHistory = [...(item.history || []), historyEntry];
        const { error } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", item.id);
        if (error) {
          showToast("error", "Something didn't save — check your connection and try again.");
          continue;
        }
        nextInventory[idx] = { ...item, qty: newQty, lots: newLots, history: newHistory };
      } else {
        const newItem = { id: uid(), name: line.name, category: line.category, qty: line.qty, unit: line.unit, threshold: 0, lots: [lotEntry], history: [historyEntry] };
        const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(newItem, user.id, profile.companyId)).select().single();
        if (error) {
          showToast("error", "Something didn't save — check your connection and try again.");
          continue;
        }
        nextInventory = [rowToInventoryItem(data), ...nextInventory];
      }
    }
    setInventory(nextInventory);

    const { error: poError } = await supabase
      .from("purchase_orders")
      .update({ status: "Received", received_date: today(), lines: finalizedLines })
      .eq("id", id);
    if (poError) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Received", receivedDate: today(), lines: finalizedLines } : p)));
    showToast("success", `${po.poNumber} received — inventory updated.`);
    logActivity("received", "purchase order", po.poNumber, `Purchase order ${po.poNumber} received from ${po.supplier} — inventory updated`);
  };

  const advance = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const stages = getStages(hasBriteTanks);
    const idx = stages.indexOf(batch.stage);
    if (idx >= stages.length - 1) return;
    const nextStage = stages[idx + 1];
    if (batch.stage === "Primary" && nextStage === "Cooling") {
      const hasPass = (batch.diacetylTests || []).some((t) => t.result === "pass");
      if (!hasPass) return;
    }
    const { error } = await supabase.from("batches").update({ stage: nextStage }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stage: nextStage } : b)));
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) moved to ${nextStage}`);
  };

  const moveStageBack = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const stages = getStages(hasBriteTanks);
    const idx = stages.indexOf(batch.stage);
    if (idx <= 0) return;
    const prevStage = stages[idx - 1];
    const { error } = await supabase.from("batches").update({ stage: prevStage }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stage: prevStage } : b)));
  };

  const setBrewSubStage = async (id, brewStage) => {
    const { error } = await supabase.from("batches").update({ brew_stage: brewStage }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, brewStage } : b)));
  };

  // Moves a batch to a different vessel mid-brew-day (Mash Tun → Kettle →
  // Fermenter). Because occupancy is just "which batch currently has this
  // tank_id," simply changing tank_id automatically frees the old vessel —
  // no separate release step needed. Reaching a Fermenter is what actually
  // advances the batch's real stage to Primary.
  const transferBatchVessel = async (id, tank, brewStage, newStage) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const patch = { tank_id: tank.id, tank_name: tank.name, brew_stage: brewStage };
    if (newStage) patch.stage = newStage;
    const { error } = await supabase.from("batches").update(patch).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === id ? { ...b, tankId: tank.id, tankName: tank.name, brewStage, ...(newStage ? { stage: newStage } : {}) } : b))
    );
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) moved to ${tank.name}${newStage ? ` — ${newStage}` : ""}`);
    resetTankClean(tank.id, batch);
  };

  // From the kettle, a batch can go into one fermenter or split across
  // several — this handles both, and either way it's what actually moves
  // the batch's real stage into Primary.
  const transferToFermenter = async (id, tanksChosen) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;

    if (tanksChosen.length === 1) {
      const tank = tanksChosen[0];
      const patch = { tank_id: tank.tankId, tank_name: tank.tankName, split_tanks: [], brew_stage: null, stage: "Primary" };
      const { error } = await supabase.from("batches").update(patch).eq("id", id);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
      setBatches((prev) =>
        prev.map((b) => (b.id === id ? { ...b, tankId: tank.tankId, tankName: tank.tankName, splitTanks: [], brewStage: null, stage: "Primary" } : b))
      );
      logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) moved to ${tank.tankName} — Primary`);
      resetTankClean(tank.tankId, batch);
      return;
    }

    // Splitting across several fermenters: from this point on each one needs
    // its own stage, readings, and history — a shared splitTanks field on
    // one record can't represent that once they diverge. So this creates a
    // genuinely separate, lettered batch per fermenter (sharing the brew-day
    // history up to now) and retires the original kettle-stage record.
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const totalSplitVolume = tanksChosen.reduce((sum, t) => sum + (Number(t.volume) || 0), 0);
    const newBatches = tanksChosen.map((t, i) => {
      const suffix = letters[i] || String(i + 1);
      const share = totalSplitVolume > 0 ? t.volume / totalSplitVolume : 0;
      return {
        ...batch,
        id: uid(),
        number: `${batch.number}${suffix}`,
        name: `${batch.name} — ${suffix}`,
        volume: t.volume,
        tankId: t.tankId,
        tankName: t.tankName,
        splitTanks: [],
        brewStage: null,
        stage: "Primary",
        ingredientCost: batch.ingredientCost != null ? Math.round(batch.ingredientCost * share * 100) / 100 : null,
      };
    });

    for (const nb of newBatches) {
      const { error } = await supabase.from("batches").insert(batchToRow(nb, user.id, profile.companyId));
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    }
    const { error: deleteError } = await supabase.from("batches").delete().eq("id", id);
    if (deleteError) { showToast("error", "Something didn't save — check your connection and try again."); return; }

    setBatches((prev) => [...newBatches, ...prev.filter((b) => b.id !== id)]);
    setSelectedId(newBatches[0].id);
    const summary = newBatches.map((b) => `${b.name} (${b.tankName})`).join(" + ");
    showToast("success", `Split into ${newBatches.length} separate batches.`);
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) split into ${summary} — Primary`);
    tanksChosen.forEach((t, i) => resetTankClean(t.tankId, newBatches[i]));
  };

  const logDiacetylTest = async (id, test) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const diacetylTests = [...(batch.diacetylTests || []), test];
    const { error } = await supabase.from("batches").update({ diacetyl_tests: diacetylTests }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, diacetylTests } : b)));
    showToast("success", `Diacetyl test logged: ${test.result}.`);
  };

  const toggleBatchFault = async (id, faultName) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const allEntries = batch.faults || [];
    const todayStr = today();
    const todaysEntry = allEntries.find((f) => f.fault === faultName && f.date === todayStr);
    let faults;
    if (todaysEntry) {
      // Same-day taps cycle through Low → Medium → High → off, same as before.
      const nextSeverity = FAULT_SEVERITY_NEXT[todaysEntry.severity];
      faults = nextSeverity === null
        ? allEntries.filter((f) => !(f.fault === faultName && f.date === todayStr))
        : allEntries.map((f) => (f.fault === faultName && f.date === todayStr ? { ...f, severity: nextSeverity } : f));
    } else {
      // First tap on a new day starts a fresh assessment at Low, regardless
      // of what an earlier day recorded — that entry stays put as history.
      faults = [...allEntries, { id: uid(), fault: faultName, severity: "Low", date: todayStr }];
    }
    const { error } = await supabase.from("batches").update({ faults }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, faults } : b)));
  };

  const logReading = async (id, reading) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const readings = [...batch.readings, reading];
    const { error } = await supabase.from("batches").update({ readings }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, readings } : b)));
  };

  const deleteReading = async (batchId, readingId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch || batch.readings.length <= 1) return;
    const readings = batch.readings.filter((r) => r.id !== readingId);
    const { error } = await supabase.from("batches").update({ readings }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, readings } : b)));
  };

  const BREW_DAY_FIELD_COLUMNS = {
    mashPh: "mash_ph",
    mashTemp: "mash_temp",
    preBoilGravity: "pre_boil_gravity",
    topUpWater: "top_up_water",
    phIntoTank: "ph_into_tank",
    sgIntoTank: "sg_into_tank",
  };

  const updateBrewDayField = async (id, field, value) => {
    const column = BREW_DAY_FIELD_COLUMNS[field];
    if (!column) return;
    const batch = batches.find((b) => b.id === id);

    // SG/pH into tank are the batch's real starting numbers, so the first
    // reading in the log should reflect them, not the recipe's target OG.
    let readings = batch?.readings;
    if (batch && readings && readings.length > 0 && (field === "sgIntoTank" || field === "phIntoTank") && value != null) {
      readings = readings.map((r, i) =>
        i === 0 ? { ...r, ...(field === "sgIntoTank" ? { gravity: value } : { ph: value }) } : r
      );
    }

    const patch = readings && readings !== batch.readings ? { [column]: value, readings } : { [column]: value };
    const { error } = await supabase.from("batches").update(patch).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) =>
      prev.map((b) => (b.id === id ? { ...b, [field]: value, ...(readings && readings !== batch.readings ? { readings } : {}) } : b))
    );
  };

  const toggleScheduleStep = async (batchId, stepId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const newSchedule = (batch.schedule || []).map((s) =>
      s.id === stepId ? { ...s, done: !s.done, doneAt: !s.done ? new Date().toISOString() : null } : s
    );
    const { error } = await supabase.from("batches").update({ schedule: newSchedule }).eq("id", batchId);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, schedule: newSchedule } : b)));
  };

  const deductConsumablesForPackaging = async (batch, sessionCounts, packageTypeSelections, sign = -1) => {
    // Work out total qty to deduct (or, with sign=1, restore) per consumable
    // across every container type in this packaging session.
    const deductions = {}; // consumableId -> total qty
    let missingLabel = false;
    for (const c of CONTAINERS) {
      const count = Number(sessionCounts[c.key]) || 0;
      const packageTypeId = packageTypeSelections[c.key];
      if (count <= 0 || !packageTypeId) continue;
      const packageType = packageTypes.find((pt) => pt.id === packageTypeId);
      if (!packageType) continue;
      for (const item of packageType.items) {
        let consumableId = item.consumableId;
        if (item.matchLabelByRecipeName) {
          const beerName = (batch.recipeName || batch.name || "").trim().toLowerCase();
          const match = consumables.find((co) => co.category === "Label" && co.name.trim().toLowerCase() === beerName);
          if (!match) { missingLabel = true; continue; }
          consumableId = match.id;
        }
        if (!consumableId) continue;
        const qty = (Number(item.qtyPerUnit) || 0) * count;
        deductions[consumableId] = (deductions[consumableId] || 0) + qty;
      }
    }

    if (missingLabel) {
      showToast("error", `No matching Label consumable found for "${batch.recipeName || batch.name}" — that ${sign < 0 ? "deduction" : "return"} was skipped.`);
    }

    const ids = Object.keys(deductions);
    if (ids.length === 0) return;

    let nextConsumables = [...consumables];
    for (const consumableId of ids) {
      const item = nextConsumables.find((co) => co.id === consumableId);
      if (!item) continue;
      const delta = sign * deductions[consumableId];
      const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
      const actualDelta = Math.round((newQty - item.qty) * 100) / 100;
      const historyEntry = {
        id: uid(),
        date: new Date().toISOString(),
        user: user.name,
        type: "batch",
        delta: actualDelta,
        note: sign < 0 ? `Packaging — ${batch.number || batch.name}` : `Undo packaging — ${batch.number || batch.name}`,
      };
      const newHistory = [...(item.history || []), historyEntry];
      const { error } = await supabase.from("consumables").update({ qty: newQty, history: newHistory }).eq("id", consumableId);
      if (error) { showToast("error", "Something didn't save — check your connection and try again."); continue; }
      nextConsumables = nextConsumables.map((co) => (co.id === consumableId ? { ...co, qty: newQty, history: newHistory } : co));
    }
    setConsumables(nextConsumables);
  };

  const logPackagingSession = async (id, sessionCounts, packageTypeSelections = {}) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const events = packagingEvents(batch);
    const newEvent = { id: uid(), date: today(), ...sessionCounts, packageTypes: packageTypeSelections };
    const newPackaging = { events: [...events, newEvent], discarded: packagingDiscarded(batch) };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged", packaging_run: null }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Packaged", packagingRun: null } : b)));
    syncPackagingToXero(batch, sessionCounts);
    await deductConsumablesForPackaging(batch, sessionCounts, packageTypeSelections);
    logActivity("packaged", "batch", batch.name, `${batch.name} (#${batch.number}) packaged`);
  };

  // First half of a packaging run — just records what's being packaged
  // into and when it started. The tank stays occupied and the batch's
  // real stage doesn't change until logPackagingSession finishes it.
  const startPackagingRun = async (id, containerType) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const packagingRun = { containerType, startedAt: new Date().toISOString() };
    const { error } = await supabase.from("batches").update({ packaging_run: packagingRun }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packagingRun } : b)));
    logActivity("advanced", "batch", batch.name, `${batch.name} (#${batch.number}) started packaging (${containerType})`);
  };

  const setCarbonationChecked = async (id, checked) => {
    const { error } = await supabase.from("batches").update({ carbonation_checked: checked }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, carbonationChecked: checked } : b)));
  };

  // Optional brew-day checkboxes — hop dump, yeast dump. Purely
  // informational, never blocks anything.
  const setBrewDayCheckbox = async (id, field, checked) => {
    const column = field === "hopDumpDone" ? "hop_dump_done" : "yeast_dump_done";
    const { error } = await supabase.from("batches").update({ [column]: checked }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: checked } : b)));
  };

  const addBatchNote = async (id, text) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const newNote = { id: uid(), date: new Date().toISOString(), text };
    const notes = [...(batch.notes || []), newNote];
    const { error } = await supabase.from("batches").update({ notes }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, notes } : b)));
  };

  const deleteBatchNote = async (id, noteId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const notes = (batch.notes || []).filter((n) => n.id !== noteId);
    const { error } = await supabase.from("batches").update({ notes }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, notes } : b)));
  };

  // Cancels a packaging run that was started but never finished. Nothing
  // gets deducted until logPackagingSession actually runs (that only
  // happens on "Finish packaging"), so there's genuinely nothing to give
  // back here — this just clears the in-progress marker.
  const cancelPackagingRun = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    askConfirm(
      "Cancel this packaging run? Nothing's been deducted yet, so the tank and your stock stay exactly as they are — this just clears the in-progress status.",
      async () => {
        const { error } = await supabase.from("batches").update({ packaging_run: null }).eq("id", id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packagingRun: null } : b)));
        showToast("success", "Packaging run cancelled.");
      },
      { confirmLabel: "Cancel run", destructive: true }
    );
  };


  const undoPackagingEvent = async (id, eventId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const event = packagingEvents(batch).find((e) => e.id === eventId);
    if (!event) return;
    askConfirm(
      "Undo this packaging run? It'll go back to the Cooling stage, and any consumables (cans, lids, boxes, labels) used for it will be returned to stock.",
      async () => {
        const events = packagingEvents(batch).filter((e) => e.id !== eventId);
        const newPackaging = { events, discarded: packagingDiscarded(batch) };
        const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Cooling" }).eq("id", id);
        if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
        setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Cooling" } : b)));
        await deductConsumablesForPackaging(batch, event, event.packageTypes || {}, 1);
        showToast("success", "Packaging undone — back to Cooling, consumables returned to stock.");
        logActivity("undid packaging for", "batch", batch.name, `Packaging undone for ${batch.name} (#${batch.number})`);
      },
      { confirmLabel: "Undo packaging", destructive: true }
    );
  };

  const discardRemaining = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const events = packagingEvents(batch);
    const newDiscarded = packagingDiscarded(batch) + remainingVolume(batch);
    const newPackaging = { events, discarded: newDiscarded };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged" }).eq("id", id);
    if (error) { showToast("error", "Something didn't save — check your connection and try again."); return; }
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Packaged" } : b)));
  };

  const deleteAccount = async () => {
    try {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        console.error(error);
        return { error: error.message };
      }
      setShowDeleteAccount(false);
      await supabase.auth.signOut();
      return { error: null };
    } catch (err) {
      console.error(err);
      return { error: (err && err.message) || "Something went wrong. Check your connection and try again." };
    }
  };

  const deleteCompany = async () => {
    try {
      const { error } = await supabase.rpc("delete_my_company");
      if (error) {
        console.error(error);
        return { error: error.message };
      }
      setShowDeleteCompany(false);
      await supabase.auth.signOut();
      return { error: null };
    } catch (err) {
      console.error(err);
      return { error: (err && err.message) || "Something went wrong. Check your connection and try again." };
    }
  };

  const hasBriteTanks = tanks.some((t) => t.type === "Brite Tank");
  const stages = getStages(hasBriteTanks);
  const fermentingBatches = batches.filter((b) => ["Brewing", "Primary", "Secondary"].includes(b.stage));
  const conditioningBatches = batches.filter((b) => ["Cooling", "Brite Tank", "Conditioning"].includes(b.stage));
  const inProgressBatches = batches.filter((b) => b.stage === "Packaged" && remainingVolume(b) > 0);
  const packagedBatches = batches.filter((b) => b.stage === "Packaged" && remainingVolume(b) === 0);

  if (justConfirmedEmail) {
    return <EmailConfirmedScreen onContinue={() => setJustConfirmedEmail(false)} />;
  }

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F1E4", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BrewpointLoadingMark />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen inviteToken={inviteToken} />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        padding: "0 0 60px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #5C9A3C; }
        button:focus-visible { outline: 2px solid #5C9A3C; outline-offset: 2px; }
      `}</style>

      <style>{`
        button:not(:disabled):active { transform: scale(0.97); }
        button { transition: transform 90ms ease, border-color 0.15s, background 0.15s; }
        @media (prefers-reduced-motion: reduce) {
          button:not(:disabled):active { transform: none; }
        }
        @media print {
          body * { visibility: hidden; }
          .bp-print-sheet, .bp-print-sheet * { visibility: visible; }
          .bp-print-sheet { display: block !important; position: absolute; top: 0; left: 0; width: 100%; padding: 24px; }
        }
        .bp-hamburger-btn { display: none; }
        .bp-sidebar-backdrop { display: none; }
        @media (max-width: 860px) {
          .bp-hamburger-btn { display: flex !important; }
          .bp-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            z-index: 96;
            transform: translateX(-100%);
            transition: transform 0.22s ease;
            box-shadow: 4px 0 24px rgba(0,0,0,0.15);
          }
          .bp-sidebar.bp-sidebar-open { transform: translateX(0); }
          .bp-sidebar-backdrop.bp-sidebar-open {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(10,12,11,0.5);
            z-index: 95;
          }
          .bp-main-content { padding-top: calc(env(safe-area-inset-top, 0px) + 64px) !important; }
        }
      `}</style>
      {updateAvailable && (
        <UpdateBanner
          runningVersion={APP_VERSION}
          latestVersion={latestVersionSeen}
          onRefresh={async () => {
            // Installed home-screen apps on iOS can hang onto a cached copy
            // even when the server says not to — this throws everything we
            // can at it: clear any Cache Storage entries (harmless if none
            // exist), confirm a fresh copy is actually fetchable, then force
            // a hard navigation (replace, not href — less likely to resolve
            // from any in-memory/back-forward cache) to a cache-busted URL.
            try {
              if (window.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
            } catch {}
            const url = window.location.pathname + "?v=" + Date.now();
            try {
              await fetch(url, { cache: "no-store" });
            } catch {}
            window.location.replace(url);
          }}
        />
      )}
      {isOffline && <OfflineBanner />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <button
        className="bp-hamburger-btn"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
        style={{
          display: "none",
          position: "fixed",
          top: `calc(env(safe-area-inset-top, 0px) + ${14 + (isOffline ? 42 : 0)}px)`,
          left: `calc(env(safe-area-inset-left, 0px) + 14px)`,
          zIndex: 97,
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          background: "#FFFFFF",
          border: "1px solid #DDE0C8",
          borderRadius: 6,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
        }}
      >
        <Menu size={18} color="#2A3324" />
      </button>
      <div className={`bp-sidebar-backdrop ${sidebarOpen ? "bp-sidebar-open" : ""}`} onClick={() => setSidebarOpen(false)} />

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <div
          className={`bp-sidebar ${sidebarOpen ? "bp-sidebar-open" : ""}`}
          style={{
            width: 210,
            flexShrink: 0,
            background: "#F5F1E4",
            borderRight: "1px solid #DDE0C8",
            padding: "calc(env(safe-area-inset-top, 0px) + 24px) 14px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5C9A3C" }}>
              <BreworxMark size={26} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Brewpoint
              </span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="bp-hamburger-btn"
              aria-label="Close menu"
              style={{ display: "none", background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 4 }}
            >
              <X size={18} />
            </button>
          </div>

          <button
            data-tour="search-btn"
            onClick={() => setShowQuickJump(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "8px 10px",
              color: "#9BA88A",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Search size={13} /> Search…
          </button>

          <button
            data-tour="help-guide-btn"
            onClick={() => setShowHelpGuide(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "8px 10px",
              color: "#9BA88A",
              fontFamily: "'Inter', sans-serif",
              fontSize: 12.5,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Info size={13} /> Help guide
          </button>

          <div data-tour="nav-groups" style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
            {[
              { items: [["home", "Home", Home]] },
              {
                label: "Production",
                items: [
                  ["batches", "Batches", Droplet],
                  ["packaged", "Finished Stock", Package],
                  ["production", "Production", Calendar],
                  ["brewery", "Brewery", Warehouse],
                ],
              },
              {
                label: "Recipes",
                items: [
                  ["recipes", "Recipes", Beaker],
                  // Recipe Builder hidden from nav for now — the view and
                  // its code are untouched, just re-add this line to bring
                  // it back: ["recipeBuilder", "Recipe Builder", FlaskConical],
                  ["recipeAnalytics", "Recipe Analytics", TrendingUp],
                ],
              },
              salesModuleEnabled && {
                label: "Sales",
                items: [
                  ["customers", "Customers", Users],
                  ["salesOrders", "Orders", Truck],
                ],
              },
              {
                label: "Stock",
                items: [
                  ["inventory", "Inventory", LayoutGrid],
                  ["consumables", "Consumables", Box],
                  ["packageTypes", "Package Types", Layers],
                  ["orders", "Purchase Orders", Truck],
                ],
              },
              { label: "Compliance", items: [["foodsafety", "Food Safety", CheckCircle2], ["excise", "Excise", FileText]] },
              { items: [["settings", "Settings", Settings]] },
            ].filter(Boolean).map((group, gi) => (
              <div key={gi} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {group.label && (
                  <div
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      fontWeight: 500,
                      fontSize: 12.5,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#5C9A3C",
                      padding: "0 12px",
                      marginBottom: 6,
                    }}
                  >
                    {group.label}
                  </div>
                )}
                {group.items.map(([key, label, Icon]) => {
                  const isCurrent = view === key && !selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedCustomerId && !selectedSalesOrderId;
                  return (
                    <button
                      key={key}
                      data-tour={`nav-${key}`}
                      onClick={() => {
                        setView(key);
                        setSelectedId(null);
                        setSelectedPOId(null);
                        setSelectedRecipeId(null);
                        setSelectedInventoryId(null);
                        setSelectedConsumableId(null);
                        setSelectedPackageTypeId(null);
                        setSidebarOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "left",
                        background: isCurrent ? "#FFFFFF" : "none",
                        border: "none",
                        borderLeft: `2px solid ${isCurrent ? "#5C9A3C" : "transparent"}`,
                        borderRadius: 4,
                        padding: "10px 12px",
                        cursor: "pointer",
                      }}
                    >
                      <Icon size={16} color={isCurrent ? "#5C9A3C" : "#9BA88A"} style={{ flexShrink: 0 }} />
                      <span
                        style={{
                          fontFamily: "'Oswald', sans-serif",
                          fontSize: 15,
                          color: isCurrent ? "#2A3324" : "#5C6B54",
                          fontWeight: 500,
                        }}
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "0 6px" }}>
            <span style={{ color: "#5C6B54", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>{user.name}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "none",
                border: "1px solid #DDE0C8",
                borderRadius: 4,
                color: "#5C6B54",
                cursor: "pointer",
                padding: "8px 10px",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>

        <div
          className="bp-main-content"
          style={{
            flex: 1,
            minWidth: 0,
            padding: `24px 22px ${60 + (updateAvailable ? 50 : 0)}px`,
            zoom: textScale,
          }}
        >
        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedCustomerId && !selectedSalesOrderId && (
          <div key={view} className="bp-view-fade">
            <style>{`
              @keyframes bp-view-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
              .bp-view-fade { animation: bp-view-fade-in 180ms ease-out; }
              @media (prefers-reduced-motion: reduce) {
                .bp-view-fade { animation: none; }
              }
            `}</style>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
              {view !== "settings" && view !== "home" && view !== "packaged" && view !== "foodsafety" && view !== "recipeBuilder" && view !== "production" && view !== "recipeAnalytics" && view !== "excise" && (
                <button
                  data-tour={`page-${view}-newbtn`}
                  onClick={() => {
                    if (view === "batches") setShowAdd(true);
                    else if (view === "inventory") setShowAddInventory(true);
                    else if (view === "consumables") setShowAddConsumable(true);
                    else if (view === "packageTypes") setShowAddPackageType(true);
                    else if (view === "orders") setShowAddPO(true);
                    else if (view === "recipes") setShowAddRecipe(true);
                    else if (view === "customers") setShowAddCustomer(true);
                    else if (view === "salesOrders") setShowAddSalesOrder(true);
                    else setShowAddTank(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#5C9A3C",
                    border: "none",
                    borderRadius: 5,
                    padding: "9px 14px",
                    color: "#16191A",
                    fontFamily: "'Oswald', sans-serif",
                    fontWeight: 500,
                    fontSize: 13.5,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <Plus size={16} />{" "}
                  {view === "batches" ? "New batch" : view === "inventory" ? "New item" : view === "consumables" ? "New item" : view === "packageTypes" ? "New package type" : view === "orders" ? "New order" : view === "recipes" ? "New recipe" : view === "customers" ? "New customer" : view === "salesOrders" ? "New order" : "New tank"}
                </button>
              )}
            </div>

            {loadingData && <SkeletonList />}

            {!loadingData && view === "home" && (
              <HomeView
                companyName={companyName}
                companyLogo={companyLogo}
                fermentingBatches={fermentingBatches}
                conditioningBatches={conditioningBatches}
                inProgressBatches={inProgressBatches}
                packagedBatches={packagedBatches}
                inventory={inventory}
                purchaseOrders={purchaseOrders}
                foodSafetyRecords={foodSafetyRecords}
                onOpenBatch={(id) => {
                  setSelectedId(id);
                  setView("batches");
                }}
                onOpenPO={(id) => {
                  setSelectedPOId(id);
                  setView("orders");
                }}
                onGoTo={setView}
                tanks={tanks}
                recipes={recipes}
                totalBatches={batches.length}
                batches={batches}
                consumables={consumables}
                packageTypes={packageTypes}
                recentBatches={recentBatches}
                onQuickLog={setLogTarget}
                activityLog={activityLog}
                onCycleClean={cycleTankClean}
                onSetCleanStage={setTankCleanStage}
              />
            )}

            {!loadingData && view === "packaged" && (
              <PackagedView
                batches={batches}
                onOpenBatch={(id) => {
                  setSelectedId(id);
                  setView("batches");
                }}
              />
            )}

            {!loadingData && view === "foodsafety" && (
              <>
                <FoodSafetyView
                  records={foodSafetyRecords}
                  onStartChecklist={setActiveChecklistTemplate}
                  onStartCalibration={() => setShowCalibrationModal(true)}
                  onStartTraining={() => setShowTrainingModal(true)}
                  onStartIllness={() => setShowIllnessModal(true)}
                  onStartNote={(category, title) => setActiveNoteModal({ category, title })}
                  onOpenStaff={setViewingStaffTraining}
                  suppliers={suppliers}
                  onOpenSupplier={setViewingSupplierDocs}
                />
              </>
            )}
            {!loadingData && view === "foodsafety" && !foodSafetyDisclaimerAcceptedAt && (
              <FoodSafetyDisclaimerModal onAccept={acceptFoodSafetyDisclaimer} />
            )}

            {!loadingData && view === "excise" && <ExciseReportView batches={batches} />}

            {!loadingData && view === "batches" && (() => {
              const matches = (b) => {
                const q = batchQuery.trim().toLowerCase();
                if (!q) return true;
                return b.name.toLowerCase().includes(q) || (b.style || "").toLowerCase().includes(q) || (b.number || "").toLowerCase().includes(q);
              };
              const fFerm = fermentingBatches.filter(matches);
              const fCond = conditioningBatches.filter(matches);
              const fProg = inProgressBatches.filter(matches);
              const fPack = packagedBatches.filter(matches);
              const noMatches = batchQuery.trim() && fFerm.length === 0 && fCond.length === 0 && fProg.length === 0 && fPack.length === 0;
              return (
                <>
                  <input
                    data-tour="page-batches-search"
                    type="text"
                    value={batchQuery}
                    onChange={(e) => setBatchQuery(e.target.value)}
                    placeholder="Search batches by name, style, or number…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 8,
                    }}
                  />
                  {batches.length > 0 && (
                    <button
                      onClick={() => {
                        const all = [...fFerm, ...fCond, ...fProg, ...fPack];
                        downloadCSV(
                          `batches-${today()}.csv`,
                          ["Number", "Name", "Style", "Stage", "Brew date", "Volume (L)", "OG", "FG (latest reading)", "Ingredient cost", "Tank"],
                          all.map((b) => [
                            b.number,
                            b.name,
                            b.style,
                            b.stage,
                            b.startDate,
                            b.volume,
                            b.og.toFixed(3),
                            latestReading(b).gravity.toFixed(3),
                            b.ingredientCost ?? "",
                            b.tankName || "",
                          ])
                        );
                      }}
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 16, display: "block" }}
                    >
                      Export CSV
                    </button>
                  )}
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Fermenting ({fFerm.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (fCond.length || fProg.length || fPack.length) ? 26 : 0 }}>
                    {fFerm.map((b) => (
                      <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                    ))}
                    {fFerm.length === 0 && !noMatches && (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                        No batches fermenting right now. Start one to get going.
                      </div>
                    )}
                  </div>

                  {fCond.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Conditioning ({fCond.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (fProg.length || fPack.length) ? 26 : 0 }}>
                        {fCond.map((b) => (
                          <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                        ))}
                      </div>
                    </>
                  )}

                  {fProg.length > 0 && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#D4A24C", marginBottom: 10 }}>
                        <Package size={12} /> Packaging in progress ({fProg.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: fPack.length ? 26 : 0 }}>
                        {fProg.map((b) => (
                          <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                        ))}
                      </div>
                    </>
                  )}

                  {fPack.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Packaged ({fPack.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {fPack.map((b) => (
                          <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                        ))}
                      </div>
                    </>
                  )}

                  {noMatches && (
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No batches match "{batchQuery}".</div>
                  )}
                </>
              );
            })()}

            {!loadingData && view === "inventory" && (() => {
              const filtered = inventory.filter((it) =>
                it.name.toLowerCase().includes(inventoryQuery.trim().toLowerCase())
              );
              const grouped = CATEGORIES.map((cat) => ({
                category: cat,
                items: filtered.filter((it) => it.category === cat),
              })).filter((g) => g.items.length > 0);

              return (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      data-tour="page-inventory-stocktake"
                      onClick={() => setShowStockTake(true)}
                      style={{
                        flex: 1,
                        background: "#EBE8D6",
                        border: "1px solid #C9D1AC",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Start stock take
                    </button>
                    <button
                      onClick={() => setShowStockTakeHistory(true)}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Past reports ({stockTakes.filter((st) => st.type !== "consumables").length})
                    </button>
                    <button
                      onClick={() => setShowSuppliersModal(true)}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Suppliers ({suppliers.length})
                    </button>
                  </div>
                  <input
                    type="text"
                    value={inventoryQuery}
                    onChange={(e) => setInventoryQuery(e.target.value)}
                    placeholder="Search ingredients…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 8,
                    }}
                  />
                  {inventory.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          `inventory-${today()}.csv`,
                          ["Name", "Category", "Qty", "Unit", "Threshold", "Cost per unit", "Supplier"],
                          filtered.map((it) => [
                            it.name,
                            it.category,
                            it.qty,
                            it.unit,
                            it.threshold,
                            it.costPerUnit ?? "",
                            suppliers.find((s) => s.id === it.supplierId)?.name || "",
                          ])
                        )
                      }
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 16, display: "block" }}
                    >
                      Export CSV
                    </button>
                  )}

                  {inventory.some((it) => it.qty <= it.threshold) && (() => {
                    const lowItems = inventory.filter((it) => it.qty <= it.threshold);
                    const bySupplier = {};
                    lowItems.forEach((it) => {
                      const key = it.supplierId || "none";
                      if (!bySupplier[key]) bySupplier[key] = [];
                      bySupplier[key].push(it);
                    });
                    return (
                      <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                        {Object.entries(bySupplier).map(([supplierId, items]) => {
                          const supplier = suppliers.find((s) => s.id === supplierId);
                          return (
                            <div
                              key={supplierId}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                                color: "#5C9A3C",
                                fontSize: 12.5,
                                background: "#FCF1DC",
                                border: "1px solid #E3D3A0",
                                borderRadius: 5,
                                padding: "8px 12px",
                              }}
                            >
                              <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                                <span>
                                  {items.length} item{items.length !== 1 ? "s" : ""} low
                                  {supplier ? ` from ${supplier.name}` : ""}
                                  {supplier?.leadTimeDays ? ` — usually ${supplier.leadTimeDays}d lead time` : ""}
                                </span>
                              </span>
                              {supplier && (
                                <button
                                  onClick={() => createReorderPO(supplier.name, items)}
                                  style={{ background: "#5C9A3C", border: "none", borderRadius: 4, padding: "6px 10px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 11.5, cursor: "pointer", flexShrink: 0 }}
                                >
                                  Create PO
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {grouped.map((g, i) => (
                    <div key={g.category} style={{ marginBottom: i < grouped.length - 1 ? 22 : 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: CATEGORY_COLOR[g.category],
                          marginBottom: 10,
                        }}
                      >
                        {g.category} ({g.items.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {g.items.map((it) => (
                          <InventoryItemCard key={it.id} item={it} onAdjust={adjustInventory} onOpen={setSelectedInventoryId} suppliers={suppliers} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {filtered.length === 0 && (
                    inventory.length === 0 ? (
                      <EmptyState icon={Package} title="No ingredients tracked yet" subtitle="Add grain, hops, or yeast to get started, or bring some in via a purchase order." action={{ label: "Add ingredient", onClick: () => setShowAddInventory(true) }} />
                    ) : (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No ingredients match "{inventoryQuery}".</div>
                    )
                  )}
                </>
              );
            })()}

            {!loadingData && view === "consumables" && (() => {
              const filtered = consumables.filter((it) =>
                it.name.toLowerCase().includes(consumableQuery.trim().toLowerCase())
              );
              const grouped = CONSUMABLE_CATEGORIES.map((cat) => ({
                category: cat,
                items: filtered.filter((it) => it.category === cat),
              })).filter((g) => g.items.length > 0);

              return (
                <>
                  <input
                    type="text"
                    value={consumableQuery}
                    onChange={(e) => setConsumableQuery(e.target.value)}
                    placeholder="Search consumables…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 16,
                    }}
                  />

                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                      data-tour="page-consumables-stocktake"
                      onClick={() => setShowConsumablesStockTake(true)}
                      style={{
                        flex: 1,
                        background: "#EBE8D6",
                        border: "1px solid #C9D1AC",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Start stock take
                    </button>
                    <button
                      onClick={() => setShowConsumablesStockTakeHistory(true)}
                      style={{
                        flex: 1,
                        background: "none",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      Past reports ({stockTakes.filter((st) => st.type === "consumables").length})
                    </button>
                  </div>

                  {consumables.some((it) => it.qty <= it.threshold) && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#5C9A3C",
                        fontSize: 12.5,
                        marginBottom: 14,
                        background: "#FCF1DC",
                        border: "1px solid #E3D3A0",
                        borderRadius: 5,
                        padding: "8px 12px",
                      }}
                    >
                      <AlertTriangle size={14} />
                      {consumables.filter((it) => it.qty <= it.threshold).length} item(s) running low
                    </div>
                  )}

                  {grouped.map((g, i) => (
                    <div key={g.category} style={{ marginBottom: i < grouped.length - 1 ? 22 : 0 }}>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: CATEGORY_COLOR[g.category],
                          marginBottom: 10,
                        }}
                      >
                        {g.category} ({g.items.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {g.items.map((it) => (
                          <InventoryItemCard key={it.id} item={it} onAdjust={adjustConsumable} onOpen={setSelectedConsumableId} suppliers={suppliers} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {filtered.length === 0 && (
                    consumables.length === 0 ? (
                      <EmptyState icon={Box} title="No consumables tracked yet" subtitle="Add cans, lids, boxes, and labels to start tracking packaging stock." action={{ label: "Add consumable", onClick: () => setShowAddConsumable(true) }} />
                    ) : (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No consumables match "{consumableQuery}".</div>
                    )
                  )}
                </>
              );
            })()}

            {!loadingData && view === "packageTypes" && (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {packageTypes.map((pt) => (
                    <PackageTypeCard key={pt.id} packageType={pt} onOpen={setSelectedPackageTypeId} />
                  ))}
                </div>
                {packageTypes.length === 0 && (
                  <EmptyState icon={Layers} title="No package types yet" subtitle="Create one to define which cans, lids, boxes, or labels get used up each time you package a batch." action={{ label: "New package type", onClick: () => setShowAddPackageType(true) }} />
                )}
              </>
            )}

            {!loadingData && view === "customers" && !selectedCustomerId && (
              <CustomersView customers={customers} onOpen={setSelectedCustomerId} />
            )}

            {!loadingData && view === "salesOrders" && !selectedSalesOrderId && (
              <SalesOrdersView salesOrders={salesOrders} customers={customers} onOpen={setSelectedSalesOrderId} />
            )}

            {!loadingData && view === "orders" && (() => {
              const q = poQuery.trim().toLowerCase();
              const matchesPO = (po) => !q || po.poNumber.toLowerCase().includes(q) || po.supplier.toLowerCase().includes(q);
              const draftPOs = purchaseOrders.filter((po) => po.status === "Draft" && matchesPO(po));
              const sentPOs = purchaseOrders.filter((po) => po.status === "Sent" && matchesPO(po));
              const receivedPOs = purchaseOrders.filter((po) => po.status === "Received" && matchesPO(po));
              const noMatches = q && draftPOs.length === 0 && sentPOs.length === 0 && receivedPOs.length === 0;
              return (
                <>
                  {purchaseOrders.length > 0 && (
                    <input
                      type="text"
                      value={poQuery}
                      onChange={(e) => setPoQuery(e.target.value)}
                      placeholder="Search orders by number or supplier…"
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: "#F5F1E4",
                        border: "1px solid #DDE0C8",
                        borderRadius: 5,
                        padding: "10px 12px",
                        color: "#2A3324",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 14,
                        marginBottom: 8,
                      }}
                    />
                  )}
                  {purchaseOrders.length > 0 && (
                    <button
                      onClick={() =>
                        downloadCSV(
                          `purchase-orders-${today()}.csv`,
                          ["PO Number", "Supplier", "Status", "Order date", "Received date", "Delivery cost", "Line count", "Total value"],
                          purchaseOrders.map((po) => [
                            po.poNumber,
                            po.supplier,
                            po.status,
                            po.orderDate,
                            po.receivedDate || "",
                            po.deliveryCost ?? "",
                            po.lines.length,
                            po.lines.reduce((sum, l) => sum + (Number(l.costPerUnit) || 0) * (Number(l.qty) || 0), 0).toFixed(2),
                          ])
                        )
                      }
                      style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 16, display: "block" }}
                    >
                      Export CSV
                    </button>
                  )}
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Draft ({draftPOs.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (sentPOs.length || receivedPOs.length) ? 26 : 0 }}>
                    {draftPOs.map((po) => (
                      <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                    ))}
                    {draftPOs.length === 0 && !noMatches && purchaseOrders.length > 0 && (
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                        No drafts. Start a new order to build one out before sending it to a supplier.
                      </div>
                    )}
                  </div>

                  {sentPOs.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Sent ({sentPOs.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: receivedPOs.length ? 26 : 0 }}>
                        {sentPOs.map((po) => (
                          <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                        ))}
                      </div>
                    </>
                  )}

                  {receivedPOs.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                        Received ({receivedPOs.length})
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {receivedPOs.map((po) => (
                          <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                        ))}
                      </div>
                    </>
                  )}

                  {purchaseOrders.length === 0 && (
                    <EmptyState icon={Truck} title="No purchase orders yet" subtitle="Create one to bring in ingredients with proper lot tracking from day one." action={{ label: "New order", onClick: () => setShowAddPO(true) }} />
                  )}
                  {noMatches && (
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No orders match "{poQuery}".</div>
                  )}
                </>
              );
            })()}

            {!loadingData && view === "recipes" && (() => {
              const activeByFamily = activeRecipesByFamily(recipes);
              const filtered = activeByFamily.filter(
                (r) =>
                  r.name.toLowerCase().includes(recipeQuery.trim().toLowerCase()) ||
                  r.style.toLowerCase().includes(recipeQuery.trim().toLowerCase())
              );
              return (
                <>
                  <input
                    data-tour="page-recipes-search"
                    type="text"
                    value={recipeQuery}
                    onChange={(e) => setRecipeQuery(e.target.value)}
                    placeholder="Search recipes by name or style…"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#F5F1E4",
                      border: "1px solid #DDE0C8",
                      borderRadius: 5,
                      padding: "10px 12px",
                      color: "#2A3324",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 14,
                      marginBottom: 16,
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {filtered.map((r) => (
                      <RecipeCard key={r.id} recipe={r} onOpen={setSelectedRecipeId} />
                    ))}
                    {filtered.length === 0 && (
                      activeByFamily.length === 0 ? (
                        <EmptyState icon={Beaker} title="No recipes yet" subtitle="Add one so you can pull its ingredients in automatically when you start a brew." action={{ label: "New recipe", onClick: () => setShowAddRecipe(true) }} />
                      ) : (
                        <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>No recipes match "{recipeQuery}".</div>
                      )
                    )}
                  </div>
                </>
              );
            })()}

            {!loadingData && view === "recipeBuilder" && (
              <AddRecipeModal
                standalone
                onClose={() => setView("recipes")}
                onAdd={addRecipe}
                onSaveAndBrew={saveAndBrewRecipe}
                inventory={inventory}
                onAddInventoryItem={addInventoryItem}
              />
            )}

            {!loadingData && view === "recipeAnalytics" && (
              <>
                <RecipeAnalyticsView
                  recipes={recipes}
                  batches={batches}
                  onOpenBatch={(id) => {
                    setSelectedId(id);
                    setView("batches");
                  }}
                />
              </>
            )}

            {!loadingData && view === "brewery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sortedTanks(tanks).map((t) => {
                  const occupant = occupyingBatch(batches, t.id);
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        background: "#FFFFFF",
                        border: "1px solid #DDE0C8",
                        borderRadius: 6,
                        padding: "14px 16px",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: 0 }}>
                            {t.name}
                          </h3>
                          {t.type === "Brite Tank" && (
                            <span
                              style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 10,
                                letterSpacing: "0.05em",
                                textTransform: "uppercase",
                                color: "#D4A24C",
                                border: "1px solid #E3D3A0",
                                borderRadius: 3,
                                padding: "2px 6px",
                              }}
                            >
                              Brite
                            </span>
                          )}
                        </div>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
                          {t.capacity}L{occupant ? ` · occupied by ${occupant.name}` : " · empty"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          data-tour="page-brewery-history"
                          onClick={() => setHistoryTankTarget(t)}
                          aria-label={`History for ${t.name}`}
                          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, color: "#5C6B54", cursor: "pointer", padding: 6 }}
                        >
                          <Calendar size={14} />
                        </button>
                        <button
                          onClick={() => setQrTankTarget(t)}
                          aria-label={`QR code for ${t.name}`}
                          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, color: "#5C6B54", cursor: "pointer", padding: 6 }}
                        >
                          <QrCode size={14} />
                        </button>
                        <button
                          onClick={() => setEditTankTarget(t)}
                          style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, color: "#5C6B54", cursor: "pointer", padding: 6 }}
                        >
                          <Settings size={14} />
                        </button>
                        {!occupant && (
                          <button
                            onClick={() => setDeleteTankTarget(t)}
                            style={{ background: "none", border: "1px solid #E3D3A0", borderRadius: 4, color: "#5C9A3C", cursor: "pointer", padding: 6 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {tanks.length === 0 && (
                  <EmptyState icon={Droplet} title="No tanks set up yet" subtitle="Add your fermenters and any Brite Tanks so batches can be assigned to them." action={{ label: "Add tank", onClick: () => setShowAddTank(true) }} />
                )}
              </div>
            )}

            {!loadingData && view === "production" && (
              <>
                <ProductionManagerView
                  tanks={tanks}
                  batches={batches}
                  onOpenBatch={(id) => {
                    setSelectedId(id);
                    setView("batches");
                  }}
                  onScheduleTank={(tankId, startDate) => {
                    setBatchPreset({ tankId, startDate });
                    setShowAdd(true);
                  }}
                  onEditScheduled={setEditScheduledBatchId}
                />
              </>
            )}

            {!loadingData && view === "settings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Account
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Name</div>
                      <div style={{ color: "#2A3324", fontSize: 15, marginTop: 2 }}>{user.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Email</div>
                      <div style={{ color: "#2A3324", fontSize: 15, marginTop: 2 }}>{user.email}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Role</div>
                      <div style={{ color: "#2A3324", fontSize: 15, marginTop: 2, textTransform: "capitalize" }}>{profile?.role || "—"}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Display
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                      Text size
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {[["1", "Normal"], ["1.15", "Large"], ["1.3", "Extra large"]].map(([val, label]) => (
                        <button
                          key={val}
                          onClick={() => setTextScalePersist(val)}
                          style={{
                            flex: 1,
                            background: textScale === val ? "#5C9A3C" : "#F5F1E4",
                            border: `1px solid ${textScale === val ? "#5C9A3C" : "#DDE0C8"}`,
                            borderRadius: 5,
                            padding: "9px 10px",
                            color: textScale === val ? "#16191A" : "#5C6B54",
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: textScale === val ? 600 : 400,
                            fontSize: 13,
                            cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowWhatsNew(true)}
                    style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0, marginTop: 10 }}
                  >
                    What's new in Brewpoint
                  </button>
                  <button
                    onClick={() => setShowWelcomeTour(true)}
                    style={{ display: "block", background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0, marginTop: 8 }}
                  >
                    Take the getting-started tour again
                  </button>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Modules
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
                      <span>
                        <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, color: "#2A3324" }}>Sales & Orders</div>
                        <div style={{ color: "#5C6B54", fontSize: 12, marginTop: 2 }}>
                          Customers and Orders in the sidebar. Turn this off if you sell through something else and don't need it here.
                        </div>
                      </span>
                      <input
                        type="checkbox"
                        checked={salesModuleEnabled}
                        onChange={(e) => toggleSalesModule(e.target.checked)}
                        style={{ width: 18, height: 18, accentColor: "#5C9A3C", cursor: "pointer", flexShrink: 0 }}
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Company
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>Name</div>
                    <div style={{ color: "#2A3324", fontSize: 17, fontFamily: "'Oswald', sans-serif", marginTop: 2 }}>{companyName || "—"}</div>
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginTop: 8 }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                      Logo (optional)
                    </div>
                    <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
                      Upload a logo to show instead of your company name on the Home page. Leave this blank and
                      your company name stays as plain text.
                    </div>
                    {companyLogo && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                        <img src={companyLogo} alt="Company logo" style={{ width: 56, height: 56, objectFit: "contain", background: "#F5F1E4", borderRadius: 6, border: "1px solid #DDE0C8" }} />
                        <button
                          onClick={removeCompanyLogo}
                          style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
                        >
                          Remove logo
                        </button>
                      </div>
                    )}
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        background: "none",
                        border: "1px dashed #C9D1AC",
                        borderRadius: 5,
                        padding: "9px",
                        color: "#5C6B54",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 12.5,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => uploadCompanyLogo(e.target.files && e.target.files[0])}
                        style={{ display: "none" }}
                      />
                      {companyLogo ? "Replace logo" : "Upload logo"}
                    </label>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Xero
                  </div>
                  <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                    {xeroConnection ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <CheckCircle2 size={15} color="#D9A441" />
                          <span style={{ color: "#2A3324", fontSize: 15, fontFamily: "'Oswald', sans-serif" }}>Connected</span>
                        </div>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 12 }}>
                          {xeroConnection.tenant_name}
                          {xeroConnection.connected_by ? ` · connected by ${xeroConnection.connected_by}` : ""}
                        </div>

                        <div style={{ borderTop: "1px solid #DDE0C8", paddingTop: 12, marginBottom: 12 }}>
                          <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
                            Stock sync
                          </div>
                          <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
                            Packaging a batch pushes stock into Xero automatically. This needs one account chosen —
                            used only to net the entry to zero, it won't affect your books.
                          </div>
                          {xeroSettings?.adjustment_account_code ? (
                            <div style={{ color: "#D9A441", fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}>
                              <CheckCircle2 size={13} /> Using "{xeroSettings.adjustment_account_name}"
                            </div>
                          ) : xeroAccounts.length > 0 ? (
                            <select
                              onChange={(e) => {
                                const acc = xeroAccounts.find((a) => a.code === e.target.value);
                                if (acc) saveXeroAdjustmentAccount(acc.code, acc.name);
                              }}
                              defaultValue=""
                              style={{
                                width: "100%",
                                boxSizing: "border-box",
                                background: "#F5F1E4",
                                border: "1px solid #DDE0C8",
                                borderRadius: 4,
                                padding: "9px 10px",
                                color: "#2A3324",
                                fontFamily: "'Inter', sans-serif",
                                fontSize: 13,
                              }}
                            >
                              <option value="" disabled>
                                Choose an account…
                              </option>
                              {xeroAccounts.map((a) => (
                                <option key={a.code} value={a.code}>
                                  {a.name} ({a.code})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <button
                              onClick={loadXeroAccounts}
                              style={{ background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", width: "100%" }}
                            >
                              Load accounts from Xero
                            </button>
                          )}
                        </div>

                        <button
                          onClick={disconnectXero}
                          style={{ background: "none", border: "1px solid #E3D3A0", borderRadius: 5, padding: "9px", color: "#5C9A3C", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", width: "100%" }}
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 12, lineHeight: 1.5 }}>
                          Connect Brewpoint to your Xero account. This is step one of the integration — stock
                          syncing comes next once this connection is confirmed working.
                        </div>
                        <button
                          onClick={() => {
                            setXeroConnecting(true);
                            window.location.href = buildXeroAuthUrl(profile.companyId);
                          }}
                          disabled={xeroConnecting}
                          style={{
                            background: "#13B5EA",
                            border: "none",
                            borderRadius: 5,
                            padding: "10px",
                            color: "#0B2E3A",
                            fontFamily: "'Oswald', sans-serif",
                            fontWeight: 500,
                            fontSize: 14,
                            cursor: "pointer",
                            width: "100%",
                          }}
                        >
                          {xeroConnecting ? "Redirecting to Xero…" : "Connect to Xero"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    <Users size={13} /> Team ({teammates.length})
                  </div>
                  {profile?.role === "owner" && (
                    <div style={{ marginBottom: 10 }}>
                      {!inviteLink ? (
                        <button
                          onClick={createInvite}
                          disabled={creatingInvite}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 7,
                            width: "100%",
                            background: "none",
                            border: "1px dashed #C9D1AC",
                            borderRadius: 5,
                            padding: "10px",
                            color: "#5C6B54",
                            fontFamily: "'Inter', sans-serif",
                            fontSize: 13,
                            cursor: creatingInvite ? "default" : "pointer",
                          }}
                        >
                          <Plus size={14} /> {creatingInvite ? "Creating link…" : "Invite a teammate"}
                        </button>
                      ) : (
                        <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px" }}>
                          <div style={{ color: "#5C6B54", fontSize: 11.5, marginBottom: 6 }}>
                            Share this link — it works once, for one person, and only for your company.
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              readOnly
                              value={inviteLink}
                              onFocus={(e) => e.target.select()}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                background: "#FFFFFF",
                                border: "1px solid #DDE0C8",
                                borderRadius: 4,
                                padding: "8px 10px",
                                color: "#2A3324",
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: 11.5,
                              }}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard?.writeText(inviteLink);
                                showToast("success", "Link copied.");
                              }}
                              style={{ background: "#5C9A3C", border: "none", borderRadius: 4, padding: "0 12px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                            >
                              Copy
                            </button>
                          </div>
                          <button
                            onClick={() => setInviteLink("")}
                            style={{ background: "none", border: "none", color: "#9BA88A", fontFamily: "'Inter', sans-serif", fontSize: 11.5, cursor: "pointer", padding: "6px 0 0" }}
                          >
                            Done
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {teammates.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "10px 14px",
                          background: "#F8F5EA",
                          border: "1px solid #EBE8D6",
                          borderRadius: 5,
                          fontSize: 13.5,
                        }}
                      >
                        <span style={{ color: "#2A3324" }}>
                          {t.name}
                          {t.id === user.id ? " (you)" : ""}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {t.createdAt && (
                            <span style={{ color: "#9BA88A", fontSize: 11 }}>Joined {t.createdAt.slice(0, 10)}</span>
                          )}
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11, textTransform: "uppercase" }}>
                            {t.role}
                          </span>
                          {profile?.role === "owner" && t.id !== user.id && (
                            <button
                              onClick={() => removeTeammate(t)}
                              aria-label={`Remove ${t.name}`}
                              style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: "#9BA88A", fontSize: 12, marginTop: 10 }}>
                    {profile?.role === "owner"
                      ? "Generate an invite link above to add someone — signing up on its own always creates a brand-new company now."
                      : "Only the account owner can invite new teammates."}
                  </div>
                </div>

                <button
                  onClick={() =>
                    downloadJSON(`brewpoint-backup-${today()}.json`, {
                      exportedAt: new Date().toISOString(),
                      company: companyName,
                      batches,
                      recipes,
                      inventory,
                      consumables,
                      packageTypes,
                      purchaseOrders,
                      tanks,
                      suppliers,
                      foodSafetyRecords,
                    })
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    background: "none",
                    border: "1px solid #DDE0C8",
                    borderRadius: 5,
                    padding: "12px",
                    color: "#5C6B54",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13.5,
                    cursor: "pointer",
                  }}
                >
                  <FileText size={15} /> Download full backup
                </button>

                <button
                  onClick={() => supabase.auth.signOut()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 7,
                    background: "none",
                    border: "1px solid #E3D3A0",
                    borderRadius: 5,
                    padding: "12px",
                    color: "#5C9A3C",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 13.5,
                    cursor: "pointer",
                  }}
                >
                  <LogOut size={15} /> Sign out
                </button>

                <button
                  onClick={() => setShowDeleteAccount(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#E3D3A0",
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12.5,
                    cursor: "pointer",
                    padding: "4px 0",
                  }}
                >
                  Delete account
                </button>

                {profile?.role === "owner" && (
                  <button
                    onClick={() => setShowDeleteCompany(true)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#E3D3A0",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12.5,
                      cursor: "pointer",
                      padding: "4px 0",
                    }}
                  >
                    Delete company (removes everything for everyone)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {selected && (
          <BatchDetail
            batch={selected}
            onBack={() => setSelectedId(null)}
            onAdvance={advance}
            onMoveBack={moveStageBack}
            onLogReading={setLogTarget}
            onDeleteReading={deleteReading}
            onEditBrewDayField={setBrewDayFieldTarget}
            onOpenPackaging={setPackagingTarget}
            onUndoPackagingEvent={undoPackagingEvent}
            onDiscardRemaining={setDiscardTarget}
            onAssignTank={setAssignTankTarget}
            onToggleScheduleStep={toggleScheduleStep}
            onDeleteBatch={setDeleteBatchTarget}
            stages={stages}
            onLogDiacetylTest={setDiacetylTestTarget}
            onToggleFault={toggleBatchFault}
            onUploadPhoto={uploadBatchPhoto}
            onDeletePhoto={deleteBatchPhoto}
            onStartTimer={startBrewTimer}
            onStopTimer={stopBrewTimer}
            tanks={tanks}
            onStartRecirculation={setBrewSubStage}
            onOpenVesselTransfer={setVesselTransferTarget}
            onEditSplitTanks={setEditSplitTanksTarget}
            onOpenFermenterTransfer={setFermenterTransferTarget}
            onStartPackaging={setStartPackagingTarget}
            onCancelPackagingRun={cancelPackagingRun}
            onSetCarbonationChecked={setCarbonationChecked}
            onSetBrewDayCheckbox={setBrewDayCheckbox}
            onAddNote={addBatchNote}
            onDeleteNote={deleteBatchNote}
          />
        )}

        {!selected && selectedPO && (
          <PODetail po={selectedPO} onBack={() => setSelectedPOId(null)} onMarkSent={markPOSent} onReceive={receivePO} inventory={inventory} onDelete={deletePO} />
        )}

        {!selected && !selectedPO && selectedRecipe && (
          <RecipeDetail
            recipe={selectedRecipe}
            inventory={inventory}
            onBack={() => setSelectedRecipeId(null)}
            onBrew={(recipe) => {
              setBrewRecipe(recipe);
              setSelectedRecipeId(null);
              setShowAdd(true);
            }}
            onDelete={setDeleteRecipeTarget}
            versions={recipes
              .filter((r) => r.familyId === selectedRecipe.familyId)
              .sort((a, b) => (b.version || 1) - (a.version || 1))}
            onSwitchVersion={setSelectedRecipeId}
            onEdit={setEditRecipeTarget}
            onSetActive={setActiveRecipeVersion}
            onScale={setScaleRecipeTarget}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedCustomerId && !selectedSalesOrderId && selectedInventoryItem && (
          <InventoryItemDetail
            item={selectedInventoryItem}
            onBack={() => setSelectedInventoryId(null)}
            onAdjust={adjustInventory}
            onLogAdjustment={setAdjustTarget}
            suppliers={suppliers}
            onChangeSupplier={updateInventorySupplier}
            onDelete={deleteInventoryItem}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedCustomerId && !selectedSalesOrderId && selectedConsumableItem && (
          <InventoryItemDetail
            item={selectedConsumableItem}
            onBack={() => setSelectedConsumableId(null)}
            onAdjust={adjustConsumable}
            onLogAdjustment={setConsumableAdjustTarget}
            suppliers={suppliers}
            onChangeSupplier={updateConsumableSupplier}
            backLabel="All consumables"
            showCost
            onChangeCost={updateConsumableCost}
            onDelete={deleteConsumable}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedCustomerId && !selectedSalesOrderId && selectedPackageType && (
          <PackageTypeDetail
            packageType={selectedPackageType}
            consumables={consumables}
            onBack={() => setSelectedPackageTypeId(null)}
            onDelete={deletePackageType}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedSalesOrderId && selectedCustomer && (
          <CustomerDetail
            customer={selectedCustomer}
            onBack={() => setSelectedCustomerId(null)}
            onEdit={() => setEditingCustomer(selectedCustomer)}
            onDelete={() => deleteCustomer(selectedCustomer)}
            xeroConnected={!!xeroConnection}
            onLinkXero={openXeroContactLink}
            onUnlinkXero={unlinkCustomerFromXero}
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && !selectedConsumableItem && !selectedPackageType && !selectedCustomerId && selectedSalesOrder && (
          <SalesOrderDetail
            order={selectedSalesOrder}
            customer={customers.find((c) => c.id === selectedSalesOrder.customerId) || null}
            onBack={() => setSelectedSalesOrderId(null)}
            onAdvance={advanceSalesOrderStatus}
            onCancel={cancelSalesOrder}
            onTogglePaid={toggleSalesOrderPaid}
            onDelete={deleteSalesOrder}
          />
        )}
        </div>
      </div>

      {showAdd && (
        <AddBatchModal
          onClose={() => {
            setShowAdd(false);
            setBrewRecipe(null);
            setBatchPreset(null);
          }}
          onAdd={addBatch}
          nextNumber={nextNumber}
          recipes={recipes}
          presetRecipe={brewRecipe}
          tanks={tanks}
          batches={batches}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
          presetTankId={batchPreset ? batchPreset.tankId : null}
          presetStartDate={batchPreset ? batchPreset.startDate : null}
        />
      )}
      {editScheduledBatchId && (() => {
        const editingBatch = batches.find((b) => b.id === editScheduledBatchId);
        if (!editingBatch) return null;
        return (
          <EditScheduledBatchModal
            batch={editingBatch}
            tanks={tanks}
            batches={batches}
            recipes={recipes}
            onSave={updateScheduledBatch}
            onDelete={deleteBatch}
            onClose={() => setEditScheduledBatchId(null)}
          />
        );
      })()}
      {qrTankTarget && <TankQRModal tank={qrTankTarget} onClose={() => setQrTankTarget(null)} />}
      {historyTankTarget && (
        <TankHistoryModal
          tank={historyTankTarget}
          batches={batches}
          onClose={() => setHistoryTankTarget(null)}
          onOpenBatch={(id) => {
            setHistoryTankTarget(null);
            setSelectedId(id);
            setView("batches");
          }}
        />
      )}
      {showHelpGuide && <HelpGuideModal onClose={() => setShowHelpGuide(false)} />}
      {showWelcomeTour && <SpotlightTour steps={TOUR_STEPS} showLogoOnFirst onClose={dismissWelcomeTour} setSidebarOpen={setSidebarOpen} />}
      {pageTourKey && PAGE_TOURS[pageTourKey] && <SpotlightTour steps={PAGE_TOURS[pageTourKey]} onClose={dismissPageTour} setSidebarOpen={setSidebarOpen} />}
      {showWhatsNew && <WhatsNewModal onClose={dismissWhatsNew} entries={CHANGELOG} />}
      {showQuickJump && (
        <QuickJumpModal
          onClose={() => setShowQuickJump(false)}
          batches={batches}
          recipes={recipes}
          purchaseOrders={purchaseOrders}
          tanks={tanks}
          inventory={inventory}
          consumables={consumables}
          suppliers={suppliers}
          foodSafetyRecords={foodSafetyRecords}
          onOpenBatch={(id) => {
            setSelectedId(id);
            setView("batches");
            setShowQuickJump(false);
          }}
          onOpenRecipe={(id) => {
            setSelectedRecipeId(id);
            setView("recipes");
            setShowQuickJump(false);
          }}
          onOpenPO={(id) => {
            setSelectedPOId(id);
            setView("orders");
            setShowQuickJump(false);
          }}
          onOpenTank={() => {
            setView("brewery");
            setShowQuickJump(false);
          }}
          onOpenInventory={(id) => {
            setSelectedInventoryId(id);
            setView("inventory");
            setShowQuickJump(false);
          }}
          onOpenConsumable={(id) => {
            setSelectedConsumableId(id);
            setView("consumables");
            setShowQuickJump(false);
          }}
          onOpenSupplier={(s) => {
            setViewingSupplierDocs(s);
            setShowQuickJump(false);
          }}
          onOpenFoodSafety={() => {
            setView("foodsafety");
            setShowQuickJump(false);
          }}
        />
      )}
      {showAddInventory && (
        <AddInventoryModal
          onClose={() => setShowAddInventory(false)}
          onAdd={addInventoryItem}
          suppliers={suppliers}
          storageKey="brewpoint-last-ingredient-category"
        />
      )}
      {showAddConsumable && (
        <AddInventoryModal
          onClose={() => setShowAddConsumable(false)}
          onAdd={addConsumable}
          suppliers={suppliers}
          categories={CONSUMABLE_CATEGORIES}
          unitOptions={["ea", "box", "roll"]}
          title="New consumable"
          submitLabel="Add to consumables"
          showCost
          storageKey="brewpoint-last-consumable-category"
        />
      )}
      {showAddPackageType && (
        <AddPackageTypeModal onClose={() => setShowAddPackageType(false)} onAdd={addPackageType} consumables={consumables} />
      )}
      {showAddCustomer && (
        <CustomerFormModal onClose={() => setShowAddCustomer(false)} onSave={addCustomer} />
      )}
      {editingCustomer && (
        <CustomerFormModal
          customer={editingCustomer}
          onClose={() => setEditingCustomer(null)}
          onSave={(patch) => updateCustomer(editingCustomer.id, patch)}
        />
      )}
      {showAddSalesOrder && (
        <AddSalesOrderModal
          onClose={() => setShowAddSalesOrder(false)}
          onAdd={addSalesOrder}
          customers={customers}
          availableStock={availableStock}
          nextOrderNumber={nextSalesOrderNumber}
        />
      )}
      {xeroContactLinkTarget && (
        <XeroContactLinkModal
          customer={xeroContactLinkTarget}
          contacts={xeroContacts}
          onClose={() => setXeroContactLinkTarget(null)}
          onLink={linkCustomerToXero}
          onCreate={createXeroContactForCustomer}
        />
      )}
      {showStockTake && (
        <StockTakeModal inventory={inventory} onClose={() => setShowStockTake(false)} onComplete={completeStockTake} />
      )}
      {showStockTakeHistory && (
        <StockTakeHistoryModal
          stockTakes={stockTakes.filter((st) => st.type !== "consumables")}
          onClose={() => setShowStockTakeHistory(false)}
          onOpenReport={(st) => {
            setViewingStockTake(st);
            setShowStockTakeHistory(false);
          }}
        />
      )}
      {viewingStockTake && (
        <StockTakeReportModal stockTake={viewingStockTake} onClose={() => setViewingStockTake(null)} />
      )}
      {showConsumablesStockTake && (
        <StockTakeModal inventory={consumables} itemLabel="item" onClose={() => setShowConsumablesStockTake(false)} onComplete={completeConsumablesStockTake} />
      )}
      {showConsumablesStockTakeHistory && (
        <StockTakeHistoryModal
          stockTakes={stockTakes.filter((st) => st.type === "consumables")}
          onClose={() => setShowConsumablesStockTakeHistory(false)}
          onOpenReport={(st) => {
            setViewingConsumablesStockTake(st);
            setShowConsumablesStockTakeHistory(false);
          }}
        />
      )}
      {viewingConsumablesStockTake && (
        <StockTakeReportModal stockTake={viewingConsumablesStockTake} onClose={() => setViewingConsumablesStockTake(null)} />
      )}
      {activeChecklistTemplate && (
        <FoodSafetyChecklistModal
          template={activeChecklistTemplate}
          onClose={() => setActiveChecklistTemplate(null)}
          onSave={addFoodSafetyRecord}
        />
      )}
      {showCalibrationModal && (
        <CalibrationModal onClose={() => setShowCalibrationModal(false)} onSave={addFoodSafetyRecord} />
      )}
      {showTrainingModal && (
        <TrainingModal onClose={() => setShowTrainingModal(false)} onSave={addFoodSafetyRecord} existingRecords={foodSafetyRecords} />
      )}
      {showIllnessModal && (
        <StaffIllnessModal onClose={() => setShowIllnessModal(false)} onSave={addFoodSafetyRecord} existingRecords={foodSafetyRecords} />
      )}
      {activeNoteModal && (
        <FoodSafetyNoteModal
          category={activeNoteModal.category}
          title={activeNoteModal.title}
          onClose={() => setActiveNoteModal(null)}
          onSave={addFoodSafetyRecord}
        />
      )}
      {viewingStaffTraining && (
        <StaffTrainingRecordModal
          staffName={viewingStaffTraining}
          records={foodSafetyRecords}
          onClose={() => setViewingStaffTraining(null)}
        />
      )}
      {xeroMappingQueue && (
        <XeroMappingModal
          queue={xeroMappingQueue}
          xeroItems={xeroItems}
          onConfirm={confirmXeroMappings}
          onClose={() => setXeroMappingQueue(null)}
        />
      )}
      {diacetylTestTarget && (
        <DiacetylTestModal
          batch={diacetylTestTarget}
          onClose={() => setDiacetylTestTarget(null)}
          onLog={logDiacetylTest}
        />
      )}
      {showSuppliersModal && (
        <SuppliersModal
          suppliers={suppliers}
          onClose={() => setShowSuppliersModal(false)}
          onAddNew={() => {
            setShowSuppliersModal(false);
            setEditingSupplier(null);
            setShowSupplierForm(true);
          }}
          onEdit={(s) => {
            setShowSuppliersModal(false);
            setEditingSupplier(s);
            setShowSupplierForm(true);
          }}
          onDelete={(s) => {
            setShowSuppliersModal(false);
            setDeleteSupplierTarget(s);
          }}
        />
      )}
      {showSupplierForm && (
        <SupplierFormModal
          supplier={editingSupplier}
          onClose={() => {
            setShowSupplierForm(false);
            setShowSuppliersModal(true);
          }}
          onSave={(data) => (editingSupplier ? updateSupplier(editingSupplier.id, data) : addSupplier(data))}
        />
      )}
      {scaleRecipeTarget && (
        <ScaleRecipeModal recipe={scaleRecipeTarget} onClose={() => setScaleRecipeTarget(null)} onScale={scaleRecipe} />
      )}
      {deleteSupplierTarget && (
        <ConfirmDeleteSupplierModal
          supplier={deleteSupplierTarget}
          onClose={() => {
            setDeleteSupplierTarget(null);
            setShowSuppliersModal(true);
          }}
          onConfirm={deleteSupplier}
        />
      )}
      {viewingSupplierDocs && (
        <SupplierDocumentsModal
          supplier={viewingSupplierDocs}
          documents={supplierDocuments.filter((d) => d.supplierId === viewingSupplierDocs.id)}
          onClose={() => setViewingSupplierDocs(null)}
          onUpload={uploadSupplierDocument}
          onDelete={deleteSupplierDocument}
          onOpen={openSupplierDocument}
        />
      )}
      {showAddPO && <AddPOModal onClose={() => setShowAddPO(false)} onAdd={addPO} nextPONumber={nextPONumber} />}
      {showAddRecipe && (
        <AddRecipeModal
          onClose={() => setShowAddRecipe(false)}
          onAdd={addRecipe}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
        />
      )}
      {editRecipeTarget && (
        <AddRecipeModal
          editingRecipe={editRecipeTarget}
          onClose={() => setEditRecipeTarget(null)}
          onAdd={addRecipe}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
        />
      )}
      {showAddTank && <AddTankModal onClose={() => setShowAddTank(false)} onAdd={addTank} />}
      {editTankTarget && (
        <EditTankModal tank={editTankTarget} onClose={() => setEditTankTarget(null)} onSave={updateTank} />
      )}
      {deleteTankTarget && (
        <ConfirmDeleteTankModal tank={deleteTankTarget} onClose={() => setDeleteTankTarget(null)} onConfirm={deleteTank} />
      )}
      {deleteRecipeTarget && (
        <ConfirmDeleteRecipeModal recipe={deleteRecipeTarget} onClose={() => setDeleteRecipeTarget(null)} onConfirm={deleteRecipe} />
      )}
      {deleteBatchTarget && (
        <ConfirmDeleteBatchModal batch={deleteBatchTarget} onClose={() => setDeleteBatchTarget(null)} onConfirm={deleteBatch} />
      )}
      {adjustTarget && (
        <AdjustInventoryModal item={adjustTarget} onClose={() => setAdjustTarget(null)} onSave={adjustInventoryWithNote} />
      )}
      {consumableAdjustTarget && (
        <AdjustInventoryModal item={consumableAdjustTarget} onClose={() => setConsumableAdjustTarget(null)} onSave={adjustConsumableWithNote} />
      )}
      {assignTankTarget && (
        <AssignTankModal batch={assignTankTarget} tanks={tanks} batches={batches} onClose={() => setAssignTankTarget(null)} onSave={assignBatchTank} />
      )}
      {vesselTransferTarget && (
        <VesselTransferModal
          batch={vesselTransferTarget.batch}
          tanks={tanks}
          batches={batches}
          toType={vesselTransferTarget.toType}
          actionLabel={vesselTransferTarget.actionLabel}
          onClose={() => setVesselTransferTarget(null)}
          onSave={(tank) => transferBatchVessel(vesselTransferTarget.batch.id, tank, vesselTransferTarget.brewStage, vesselTransferTarget.newStage)}
        />
      )}
      {editSplitTanksTarget && (
        <EditSplitTanksModal
          batch={editSplitTanksTarget}
          tanks={tanks}
          batches={batches}
          onClose={() => setEditSplitTanksTarget(null)}
          onSave={updateBatchSplitTanks}
        />
      )}
      {fermenterTransferTarget && (
        <TransferToFermenterModal
          batch={fermenterTransferTarget}
          tanks={tanks}
          batches={batches}
          onClose={() => setFermenterTransferTarget(null)}
          onSave={(tanksChosen) => transferToFermenter(fermenterTransferTarget.id, tanksChosen)}
        />
      )}
      {startPackagingTarget && (
        <StartPackagingModal
          batch={startPackagingTarget}
          onClose={() => setStartPackagingTarget(null)}
          onSave={(containerType) => {
            startPackagingRun(startPackagingTarget.id, containerType);
            setStartPackagingTarget(null);
          }}
        />
      )}
      {confirmTarget && (
        <ConfirmDialogModal
          message={confirmTarget.message}
          title={confirmTarget.title}
          confirmLabel={confirmTarget.confirmLabel}
          destructive={confirmTarget.destructive}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => {
            confirmTarget.onConfirm();
            setConfirmTarget(null);
          }}
        />
      )}
      {logTarget && (
        <LogReadingModal batch={logTarget} onClose={() => setLogTarget(null)} onLog={logReading} />
      )}
      {brewDayFieldTarget && (
        <EditBrewDayFieldModal target={brewDayFieldTarget} onClose={() => setBrewDayFieldTarget(null)} onSave={updateBrewDayField} />
      )}
      {packagingTarget && (() => {
        const liveBatch = batches.find((b) => b.id === packagingTarget.id) || packagingTarget;
        return (
          <PackagingModal
            batch={liveBatch}
            onClose={() => setPackagingTarget(null)}
            onSave={logPackagingSession}
            packageTypes={packageTypes}
            onToggleFault={toggleBatchFault}
          />
        );
      })()}
      {discardTarget && (
        <DiscardRemainingModal batch={discardTarget} onClose={() => setDiscardTarget(null)} onConfirm={discardRemaining} />
      )}
      {showDeleteAccount && (
        <DeleteAccountModal onClose={() => setShowDeleteAccount(false)} onConfirm={deleteAccount} />
      )}
      {showDeleteCompany && (
        <DeleteCompanyModal onClose={() => setShowDeleteCompany(false)} onConfirm={deleteCompany} />
      )}
    </div>
  );
}

export default function TankLog() {
  return (
    <BrewpointErrorBoundary>
      <TankLogApp />
    </BrewpointErrorBoundary>
  );
}
