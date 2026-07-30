import React, { useState, useMemo, useEffect } from "react";
import { Plus, Droplet, ChevronLeft, X, TrendingDown, Beaker, Package, Minus, AlertTriangle, Truck, CheckCircle2, Trash2, LogOut, Settings, Users, Home, LayoutGrid } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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
  rowToSupplierDocument,
  supplierDocumentToRow,
} from "./lib/mappers";

const STAGES = ["Brewing", "Primary", "Secondary", "Conditioning", "Packaged"];

const STAGE_COLOR = {
  Brewing: "#8A6A3D",
  Primary: "#5C9A3C",
  Secondary: "#B8925A",
  Conditioning: "#D4A24C",
  Packaged: "#9BA88A",
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

const totalPackagedVolume = (batch) =>
  packagingEvents(batch).reduce((sum, e) => sum + packagedVolume(e), 0);

const remainingVolume = (batch) => {
  const rem = batch.volume - totalPackagedVolume(batch) - packagingDiscarded(batch);
  return Math.max(0, Math.round(rem * 100) / 100);
};

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

function BreworxMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="bp-tank-clip">
          <path d="M9 5 H29 V23 L19 34 L9 23 Z" />
        </clipPath>
      </defs>
      {/* Fermenter tank outline */}
      <path d="M9 5 H29 V23 L19 34 L9 23 Z" stroke="#5C9A3C" strokeWidth="2.2" strokeLinejoin="round" />
      {/* Liquid fill */}
      <g clipPath="url(#bp-tank-clip)">
        <rect x="7" y="16" width="24" height="20" fill="#5C9A3C" opacity="0.32" />
      </g>
      {/* Reading marker calling out the point on the tank */}
      <line x1="29" y1="16" x2="35" y2="10" stroke="#D4A24C" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="35" cy="10" r="3" fill="#D4A24C" />
      <circle cx="35" cy="10" r="6" stroke="#D4A24C" strokeWidth="1.1" opacity="0.5" />
    </svg>
  );
}

const uid = () => Math.random().toString(36).slice(2, 9);

const today = () => new Date().toISOString().slice(0, 10);

const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

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
};

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
  const [notes, setNotes] = useState(supplier ? supplier.notes || "" : "");

  const submit = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), contactName: contactName.trim(), phone: phone.trim(), email: email.trim(), address: address.trim(), notes: notes.trim() });
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
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
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
          {supplier ? "Save changes" : "Add supplier"}
        </button>
      </div>
    </Modal>
  );
}

function SuppliersModal({ suppliers, onClose, onAddNew, onEdit, onDelete }) {
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
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {suppliers.map((s) => (
            <div
              key={s.id}
              style={{
                padding: "10px 12px",
                background: "#FBF6EC",
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
            <div style={{ color: "#9BA88A", fontSize: 13, padding: "10px 2px" }}>No suppliers added yet.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StockTakeModal({ inventory, onClose, onComplete }) {
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
          Walk the brewery and enter what you actually count for each ingredient. Anything left unchanged is
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
          {inventory.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No ingredients to count yet.</div>}
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

function InventoryItemDetail({ item, onBack, onAdjust, onLogAdjustment, suppliers, onChangeSupplier }) {
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
    const history = [...(item.history || [])].reverse();

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
        <ChevronLeft size={16} /> All inventory
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
  const [rows, setRows] = useState([{ id: uid(), name: "Tank 1", capacity: 20 }]);

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
        next.push({ id: uid(), name: `Tank ${next.length + 1}`, capacity: lastCapacity });
      }
      return next;
    });
  };

  const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const submit = () => {
    const clean = rows.filter((r) => r.name.trim());
    if (clean.length === 0) return;
    clean.forEach((r) => onAdd({ id: uid(), name: r.name.trim(), capacity: Number(r.capacity) || 0 }));
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
                display: "grid",
                gridTemplateColumns: "1fr 100px",
                gap: 8,
                background: "#F5F1E4",
                border: "1px solid #DDE0C8",
                borderRadius: 6,
                padding: "10px 10px",
              }}
            >
              <TextField label={`Tank ${i + 1} ID`} value={row.name} onChange={(v) => updateRow(row.id, { name: v })} />
              <NumberField label="Litres" value={row.capacity} onChange={(v) => updateRow(row.id, { capacity: v })} step="1" />
            </div>
          ))}
        </div>

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
          Add {rows.length} tank{rows.length !== 1 ? "s" : ""}
        </button>
      </div>
    </Modal>
  );
}

function EditTankModal({ tank, onClose, onSave }) {
  const [name, setName] = useState(tank.name);
  const [capacity, setCapacity] = useState(tank.capacity);

  const submit = () => {
    if (!name.trim()) return;
    onSave(tank.id, { name: name.trim(), capacity: Number(capacity) || 0 });
    onClose();
  };

  return (
    <Modal title="Edit tank" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Tank ID" value={name} onChange={setName} />
        <NumberField label="Capacity" value={capacity} onChange={setCapacity} step="1" suffix="L" />
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

  const submit = () => {
    const tank = tanks.find((t) => t.id === tankId) || null;
    if (tank && tankIsOccupied(batches, tank.id, batch.id)) return;
    onSave(batch.id, tank);
    onClose();
  };

  return (
    <Modal title={`Assign tank — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Tank</span>
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
            {tanks.map((t) => {
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

function AddInventoryModal({ onClose, onAdd, suppliers }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Grain");
  const [qty, setQty] = useState(10);
  const [unit, setUnit] = useState("kg");
  const [threshold, setThreshold] = useState(5);
  const [supplierId, setSupplierId] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: uid(),
      name: name.trim(),
      category,
      qty: Number(qty) || 0,
      unit,
      threshold: Number(threshold) || 0,
      supplierId: supplierId || null,
    });
    onClose();
  };

  return (
    <Modal title="New inventory item" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Name" value={name} onChange={setName} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORIES} />
          <SelectField label="Unit" value={unit} onChange={setUnit} options={["kg", "g", "L", "ea"]} />
          <NumberField label="Quantity on hand" value={qty} onChange={setQty} step="0.1" suffix={unit} />
          <NumberField label="Low-stock alert at" value={threshold} onChange={setThreshold} step="0.1" suffix={unit} />
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
          Add to inventory
        </button>
      </div>
    </Modal>
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

function AddPOModal({ onClose, onAdd, nextPONumber }) {
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState([{ id: uid(), name: "", category: "Grain", qty: 1, unit: "kg" }]);

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () =>
    setLines((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 1, unit: "kg" }]);

  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const submit = () => {
    const cleanLines = lines.filter((l) => l.name.trim());
    if (!supplier.trim() || cleanLines.length === 0) return;
    onAdd({
      id: uid(),
      poNumber: nextPONumber,
      supplier: supplier.trim(),
      orderDate: today(),
      receivedDate: null,
      status: "Draft",
      lines: cleanLines.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
    });
    onClose();
  };

  return (
    <Modal title="New purchase order" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Supplier" value={supplier} onChange={setSupplier} />

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
                  padding: 4,
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <div style={{ marginBottom: 10 }}>
              <TextField label={`Item ${i + 1}`} value={line.name} onChange={(v) => updateLine(line.id, { name: v })} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <SelectField
                label="Category"
                value={line.category}
                onChange={(v) => updateLine(line.id, { category: v })}
                options={CATEGORIES}
              />
              <SelectField label="Unit" value={line.unit} onChange={(v) => updateLine(line.id, { unit: v })} options={["kg", "g", "L", "ea"]} />
              <NumberField label="Quantity" value={line.qty} onChange={(v) => updateLine(line.id, { qty: v })} step="0.1" suffix={line.unit} />
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
          Create {nextPONumber}
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

function PODetail({ po, onBack, onMarkSent, onReceive, inventory }) {
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
    </div>
  );
}

function RecipeCard({ recipe, onOpen }) {
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
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 12.5, flexShrink: 0 }}>
        OG {recipe.og.toFixed(3)}
      </span>
    </button>
  );
}

function AddRecipeModal({ onClose, onAdd, inventory, onAddInventoryItem, editingRecipe }) {
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
  const [importError, setImportError] = useState("");
  const [schedule, setSchedule] = useState(editingRecipe ? (editingRecipe.schedule || []).map((s) => ({ ...s })) : []);

  const addScheduleStep = () =>
    setSchedule((prev) => [...prev, { id: uid(), use: "Boil", time: 60, name: "", amount: 0, unit: "kg" }]);

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

  const styleMatches =
    style.trim().length === 0
      ? []
      : ALL_STYLES.filter((s) => s.name.toLowerCase().includes(style.trim().toLowerCase())).slice(0, 30);

  const submit = () => {
    const clean = ingredients.filter((l) => l.name.trim());
    if (!name.trim() || clean.length === 0) return;
    const cleanSchedule = schedule
      .filter((s) => s.name.trim())
      .map((s) => ({ ...s, name: s.name.trim(), amount: Number(s.amount) || 0, label: buildScheduleLabel(s.use, s.time, s.name.trim()) }));
    onAdd({
      id: uid(),
      name: name.trim(),
      style: style.trim() || "Unspecified",
      volume: Number(volume) || 0,
      og: Number(og),
      fg: Number(fg),
      ingredients: clean.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
      schedule: cleanSchedule,
      familyId: editingRecipe ? editingRecipe.familyId : null,
    });
    onClose();
  };

  return (
    <Modal title={editingRecipe ? `Save new version — ${editingRecipe.name}` : "New recipe"} onClose={onClose}>
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
        </div>

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
                  padding: 4,
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
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                  <div style={{ flex: 1 }}>
                    <TextField label="What to add" value={s.name} onChange={(v) => updateScheduleStep(s.id, { name: v })} />
                  </div>
                  <div style={{ width: 64, flexShrink: 0 }}>
                    <NumberField label="Amt" value={s.amount} onChange={(v) => updateScheduleStep(s.id, { amount: v })} step="0.01" />
                  </div>
                  <button
                    onClick={() => removeScheduleStep(s.id)}
                    aria-label="Remove schedule step"
                    style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: "0 0 9px" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
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
          {editingRecipe ? "Save as new version" : "Save recipe"}
        </button>
      </div>
    </Modal>
  );
}

function RecipeDetail({ recipe, inventory, onBack, onBrew, onDelete, versions, onSwitchVersion, onEdit, onSetActive }) {
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
            {recipe.schedule.map((s) => (
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
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => e.target.select()}
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
      }}
      onClick={onClose}
    >
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
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>
            {title}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddBatchModal({ onClose, onAdd, nextNumber, recipes, presetRecipe, tanks, batches, inventory, onAddInventoryItem }) {
  const [recipeId, setRecipeId] = useState(presetRecipe ? presetRecipe.id : "");
  const [name, setName] = useState(presetRecipe ? presetRecipe.name : "");
  const [style, setStyle] = useState(presetRecipe ? presetRecipe.style : "");
  const [volume, setVolume] = useState(presetRecipe ? presetRecipe.volume : 20);
  const [og, setOg] = useState(presetRecipe ? presetRecipe.og : 1.05);
  const [fg, setFg] = useState(presetRecipe ? presetRecipe.fg : 1.01);
  const [temp, setTemp] = useState(20);
  const [mashPh, setMashPh] = useState(5.4);
  const [preBoilGravity, setPreBoilGravity] = useState("");
  const [topUpWater, setTopUpWater] = useState("");
  const [tankId, setTankId] = useState("");
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
    !splitMode && tanks.length > 0 && Number(volume) > 0 && !tanks.some((t) => !tankIsOccupied(batches, t.id) && t.capacity >= Number(volume));

  const searchableRecipes = activeRecipesByFamily(recipes);
  const nameMatches =
    name.trim().length === 0
      ? searchableRecipes
      : searchableRecipes.filter((r) => r.name.toLowerCase().includes(name.trim().toLowerCase()));

  const submit = () => {
    if (!name.trim()) return;
    const tank = tanks.find((t) => t.id === tankId) || null;
    if (!splitMode && tank && tankIsOccupied(batches, tank.id)) return;
    let finalSplitTanks = [];
    if (splitMode) {
      finalSplitTanks = splitRows
        .filter((r) => r.tankId && Number(r.volume) > 0)
        .map((r) => {
          const t = tanks.find((tk) => tk.id === r.tankId);
          return { tankId: r.tankId, tankName: t ? t.name : "", volume: Number(r.volume) || 0 };
        });
      if (finalSplitTanks.some((t) => tankIsOccupied(batches, t.tankId))) return;
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
    onAdd({
      id: uid(),
      number: nextNumber,
      name: name.trim(),
      style: style.trim() || "Unspecified",
      volume: Number(volume) || 0,
      og: Number(og),
      fg: Number(fg),
      mashPh: mashPh === "" ? null : Number(mashPh),
      preBoilGravity: preBoilGravity === "" ? null : Number(preBoilGravity),
      topUpWater: topUpWater === "" ? null : Number(topUpWater),
      stage: "Brewing",
      startDate: today(),
      recipeId: activeRecipe ? activeRecipe.id : null,
      recipeName: activeRecipe ? activeRecipe.name : null,
      tankId: splitMode ? null : tank ? tank.id : null,
      tankName: splitMode ? null : tank ? tank.name : null,
      splitTanks: splitMode ? finalSplitTanks : [],
      ingredients: cleanBatchIngredients,
      schedule: [...mashSteps, ...batchSchedule],
      readings: [{ id: uid(), date: today(), gravity: Number(og), temp: Number(temp), note: "Brew day, pitched yeast" }],
    });
    onClose();
  };

  return (
    <Modal title="New Batch" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {tanks.length > 0 && (
          <div>
            {!splitMode ? (
              <>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
                    Tank (optional)
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
                    {tanks.map((t) => {
                      const occupied = tankIsOccupied(batches, t.id);
                      const occupant = occupied ? occupyingBatch(batches, t.id) : null;
                      return (
                        <option key={t.id} value={t.id} disabled={occupied}>
                          {t.name} ({t.capacity}L){occupied ? ` — occupied by ${occupant?.name || "another batch"}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>
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
                            {tanks.map((t) => {
                              const occupied = tankIsOccupied(batches, t.id) || splitRows.some((r) => r.id !== row.id && r.tankId === t.id);
                              const occupant = tankIsOccupied(batches, t.id) ? occupyingBatch(batches, t.id) : null;
                              return (
                                <option key={t.id} value={t.id} disabled={occupied}>
                                  {t.name} ({t.capacity}L){occupant ? ` — occupied by ${occupant.name}` : occupied ? " — already used above" : ""}
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
                            style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", flexShrink: 0 }}
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
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginTop: 4 }}>
          Brew day
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Mash pH" value={mashPh} onChange={setMashPh} step="0.01" />
          <NumberField label="Pre-boil gravity" value={preBoilGravity} onChange={setPreBoilGravity} step="0.001" />
          <NumberField label="Top-up water" value={topUpWater} onChange={setTopUpWater} step="0.1" suffix="L" />
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
                      style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: "6px 0 0", flexShrink: 0 }}
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
          Start batch #{nextNumber}
        </button>
      </div>
    </Modal>
  );
}

function LogReadingModal({ batch, onClose, onLog }) {
  const [gravity, setGravity] = useState(latestReading(batch).gravity);
  const [temp, setTemp] = useState(latestReading(batch).temp);
  const [note, setNote] = useState("");

  const submit = () => {
    onLog(batch.id, { id: uid(), date: today(), gravity: Number(gravity), temp: Number(temp), note: note.trim() });
    onClose();
  };

  return (
    <Modal title={`Log reading — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Gravity" value={gravity} onChange={setGravity} step="0.001" />
          <NumberField label="Temp" value={temp} onChange={setTemp} step="0.5" suffix="°C" />
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

function BrewDayModal({ batch, onClose, onSave }) {
  const [mashPh, setMashPh] = useState(batch.mashPh ?? "");
  const [preBoilGravity, setPreBoilGravity] = useState(batch.preBoilGravity ?? "");
  const [topUpWater, setTopUpWater] = useState(batch.topUpWater ?? "");

  const submit = () => {
    onSave(batch.id, {
      mashPh: mashPh === "" ? null : Number(mashPh),
      preBoilGravity: preBoilGravity === "" ? null : Number(preBoilGravity),
      topUpWater: topUpWater === "" ? null : Number(topUpWater),
    });
    onClose();
  };

  return (
    <Modal title={`Brew day — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <NumberField label="Mash pH" value={mashPh} onChange={setMashPh} step="0.01" />
        <NumberField label="Pre-boil gravity" value={preBoilGravity} onChange={setPreBoilGravity} step="0.001" />
        <NumberField label="Top-up water" value={topUpWater} onChange={setTopUpWater} step="0.1" suffix="L" />
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
          Save brew day details
        </button>
      </div>
    </Modal>
  );
}

function PackagingModal({ batch, onClose, onSave }) {
  const [counts, setCounts] = useState(() => {
    const init = {};
    CONTAINERS.forEach((c) => (init[c.key] = 0));
    return init;
  });

  const remaining = remainingVolume(batch);
  const sessionVolume = CONTAINERS.reduce((sum, c) => sum + (Number(counts[c.key]) || 0) * c.volumeL, 0);
  const diff = Math.round((sessionVolume - remaining) * 100) / 100;
  const leftAfter = Math.max(0, Math.round((remaining - sessionVolume) * 100) / 100);

  const submit = () => {
    const session = {};
    CONTAINERS.forEach((c) => (session[c.key] = Number(counts[c.key]) || 0));
    onSave(batch.id, session);
    onClose();
  };

  return (
    <Modal title={`Log packaging — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Remaining in tank: <span style={{ color: "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>{remaining} L</span>
          {" "}of {batch.volume} L batch
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
          This packaging run
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {CONTAINERS.map((c) => (
            <NumberField
              key={c.key}
              label={c.label}
              value={counts[c.key]}
              onChange={(v) => setCounts((prev) => ({ ...prev, [c.key]: v }))}
              step="1"
            />
          ))}
        </div>
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

function BatchDetail({ batch, onBack, onAdvance, onMoveBack, onLogReading, onDeleteReading, onEditBrewDay, onOpenPackaging, onDeletePackagingEvent, onDiscardRemaining, onAssignTank, onToggleScheduleStep, onDeleteBatch }) {
  const latest = latestReading(batch);
  const pct = attenuation(batch.og, batch.fg, latest.gravity);
  const days = daysBetween(batch.startDate, today());
  const stageIdx = STAGES.indexOf(batch.stage);
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
            {!(batch.splitTanks && batch.splitTanks.length > 0) && (
              <button
                onClick={() => onAssignTank(batch)}
                style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
              >
                Change
              </button>
            )}
          </div>
        </div>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
              {batch.schedule.map((s) => (
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
              ))}
            </div>
          </>
        );
      })()}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Brew day</div>
        <button
          onClick={() => onEditBrewDay(batch)}
          style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
        >
          Edit
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 22 }}>
        {[
          ["Mash pH", batch.mashPh != null ? batch.mashPh.toFixed(2) : "—"],
          ["Pre-boil SG", batch.preBoilGravity != null ? batch.preBoilGravity.toFixed(3) : "—"],
          ["Top-up water", batch.topUpWater != null ? `${batch.topUpWater} L` : "—"],
        ].map(([label, val]) => (
          <div key={label} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#2A3324", marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      {batch.ingredients && batch.ingredients.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Ingredients{batch.recipeName ? ` — ${batch.recipeName}` : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
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
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "center" }}>
        {STAGES.map((s, i) => (
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
            {i < STAGES.length - 1 && <span style={{ flex: 1, height: 1, background: i < stageIdx ? STAGE_COLOR[batch.stage] : "#DDE0C8" }} />}
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
                      onClick={() => onDeletePackagingEvent(batch.id, e.id)}
                      aria-label="Delete packaging run"
                      style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 0, flexShrink: 0 }}
                    >
                      <Trash2 size={13} />
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
                  onClick={() => onOpenPackaging(batch)}
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
                  <Package size={14} /> Log more packaging
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
        {stageIdx < STAGES.length - 1 && (
          <button
            onClick={() => (STAGES[stageIdx + 1] === "Packaged" ? onOpenPackaging(batch) : onAdvance(batch.id))}
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
            {STAGES[stageIdx + 1] === "Packaged" && <Package size={15} />}
            {STAGES[stageIdx + 1] === "Packaged" ? "Package batch" : `Advance to ${STAGES[stageIdx + 1]}`}
          </button>
        )}
      </div>

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
          ← Move back to {STAGES[stageIdx - 1]}
        </button>
      )}

      {chartData.length > 1 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingDown size={13} /> Gravity trend
          </div>
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
            {r.note && <span style={{ flex: 1, color: "#5C6B54", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>}
            {batch.readings.length > 1 && (
              <button
                onClick={() => onDeleteReading(batch.id, r.id)}
                aria-label="Delete reading"
                style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 0, marginLeft: "auto", flexShrink: 0 }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>

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
          marginTop: 26,
        }}
      >
        Delete batch
      </button>
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
                background: "#FBF6EC",
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
            <div style={{ color: "#9BA88A", fontSize: 13, padding: "10px 2px" }}>No documents uploaded yet.</div>
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
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 60,
      }}
    >
      <div
        style={{
          background: "#F8F5EA",
          border: "1px solid #DDE0C8",
          borderBottom: "none",
          borderRadius: "10px 10px 0 0",
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          overflowY: "auto",
          padding: "22px 22px 26px",
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

function FoodSafetyView({ records, onStartChecklist, onStartCalibration, onStartTraining, onStartNote, onOpenStaff, suppliers, onOpenSupplier }) {
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  const categoryLabel = {
    checklist: "Checklist",
    calibration: "Calibration",
    training: "Training",
    water: "Water test",
    recall: "Mock recall",
    incident: "Incident",
  };
  const categoryColor = {
    checklist: "#D9A441",
    calibration: "#D4A24C",
    training: "#5C6B54",
    water: "#9BA88A",
    recall: "#5C9A3C",
    incident: "#5C9A3C",
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
        <button onClick={onStartTraining} style={secondaryBtnStyle}>Log training</button>
        <button onClick={() => onStartNote("water", "Log water test")} style={secondaryBtnStyle}>Water test</button>
        <button onClick={() => onStartNote("recall", "Log mock recall")} style={secondaryBtnStyle}>Mock recall</button>
        <button onClick={() => onStartNote("incident", "Something went wrong")} style={{ ...secondaryBtnStyle, gridColumn: "1 / -1" }}>
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
              </div>
              <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 3 }}>{r.userName}</div>
            </div>
          );
        })}
        {filteredRecords.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
            {records.length === 0
              ? "No food safety records yet — complete a checklist above to get started."
              : "Nothing matches your search."}
          </div>
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

  const stats = [
    ["Fermenting", fermentingBatches.length, STAGE_COLOR.Primary, "batches"],
    ["Conditioning", conditioningBatches.length, STAGE_COLOR.Conditioning, "batches"],
    ["Packaging", inProgressBatches.length, "#D4A24C", "batches"],
    ["Packaged", packagedBatches.length, "#9BA88A", "batches"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ color: "#5C6B54", fontSize: 13, marginBottom: 2 }}>Welcome back to</div>
        {companyLogo ? (
          <img src={companyLogo} alt={companyName || "Company logo"} style={{ maxWidth: 200, maxHeight: 72, objectFit: "contain" }} />
        ) : (
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, color: "#2A3324", margin: 0, fontWeight: 500 }}>
            {companyName || "your brewery"}
          </h1>
        )}
      </div>

      {totalTasks > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#D4A24C", marginBottom: 10 }}>
            <AlertTriangle size={12} /> Needs doing ({totalTasks})
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {stats.map(([label, count, color, goTo]) => (
          <button
            key={label}
            onClick={() => onGoTo(goTo)}
            style={{
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: "12px 10px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color, marginTop: 4 }}>{count}</div>
          </button>
        ))}
      </div>

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
          Nothing brewing yet — head to Fermentation to start your first batch.
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

function AuthScreen() {
  const [mode, setMode] = useState("signin");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (mode === "signup" && !companyName.trim()) {
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
        options: { data: { name: name.trim(), company: companyName.trim() } },
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
            {mode === "signin" ? "Welcome back" : "Start your brewery log"}
          </h1>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "signup" && <TextField label="Company name" value={companyName} onChange={setCompanyName} />}
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

export default function TankLog() {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [justConfirmedEmail, setJustConfirmedEmail] = useState(() => {
    const hash = window.location.hash || "";
    return hash.includes("type=signup") || hash.includes("type=invite") || hash.includes("type=email_change");
  });
  const [loadingData, setLoadingData] = useState(false);
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "settings" ? "settings" : "home";
  });

  useEffect(() => {
    if (window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const [batches, setBatches] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const [brewDayTarget, setBrewDayTarget] = useState(null);
  const [packagingTarget, setPackagingTarget] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [showAddInventory, setShowAddInventory] = useState(false);
  const [selectedInventoryId, setSelectedInventoryId] = useState(null);
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [recipeQuery, setRecipeQuery] = useState("");
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [selectedPOId, setSelectedPOId] = useState(null);
  const [showAddPO, setShowAddPO] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [brewRecipe, setBrewRecipe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [companyName, setCompanyName] = useState("");
  const [companyLogo, setCompanyLogo] = useState("");
  const [xeroConnection, setXeroConnection] = useState(null);
  const [xeroConnecting, setXeroConnecting] = useState(false);
  const [xeroSettings, setXeroSettings] = useState(null);
  const [xeroItemMappings, setXeroItemMappings] = useState([]);
  const [xeroAccounts, setXeroAccounts] = useState([]);
  const [xeroItems, setXeroItems] = useState([]);
  const [xeroMappingQueue, setXeroMappingQueue] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierDocuments, setSupplierDocuments] = useState([]);
  const [showSuppliersModal, setShowSuppliersModal] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [deleteSupplierTarget, setDeleteSupplierTarget] = useState(null);
  const [viewingSupplierDocs, setViewingSupplierDocs] = useState(null);
  const [foodSafetyDisclaimerAcceptedAt, setFoodSafetyDisclaimerAcceptedAt] = useState(null);
  const [teammates, setTeammates] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [showAddTank, setShowAddTank] = useState(false);
  const [stockTakes, setStockTakes] = useState([]);
  const [foodSafetyRecords, setFoodSafetyRecords] = useState([]);
  const [activeChecklistTemplate, setActiveChecklistTemplate] = useState(null);
  const [showCalibrationModal, setShowCalibrationModal] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [activeNoteModal, setActiveNoteModal] = useState(null);
  const [viewingStaffTraining, setViewingStaffTraining] = useState(null);
  const [showStockTake, setShowStockTake] = useState(false);
  const [showStockTakeHistory, setShowStockTakeHistory] = useState(false);
  const [viewingStockTake, setViewingStockTake] = useState(null);
  const [editTankTarget, setEditTankTarget] = useState(null);
  const [deleteTankTarget, setDeleteTankTarget] = useState(null);
  const [deleteRecipeTarget, setDeleteRecipeTarget] = useState(null);
  const [editRecipeTarget, setEditRecipeTarget] = useState(null);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState(null);
  const [assignTankTarget, setAssignTankTarget] = useState(null);

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
      setInventory([]);
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
      // Every account belongs to a company. If this is the very first time
      // this user has ever loaded the app, they won't have a profile row
      // yet — create/join their company now using what they entered at
      // sign-up (stashed in their auth metadata).
      let profileRow = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (!profileRow.data) {
        const meta = session.user.user_metadata || {};
        const { error: joinError } = await supabase.rpc("join_or_create_company", {
          company_name: meta.company || "My Brewery",
          member_name: meta.name || user.email.split("@")[0],
        });
        if (joinError) console.error(joinError);
        profileRow = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      }
      if (cancelled) return;
      if (!profileRow.data) {
        setLoadingData(false);
        return;
      }
      const myProfile = rowToProfile(profileRow.data);
      setProfile(myProfile);

      const [companyRes, teammatesRes, batchesRes, inventoryRes, poRes, recipesRes, tanksRes, stockTakesRes, foodSafetyRes, xeroRes, xeroSettingsRes, xeroMappingsRes, suppliersRes, supplierDocsRes] = await Promise.all([
        supabase.from("companies").select("name, logo_url, food_safety_disclaimer_accepted_at, food_safety_disclaimer_accepted_by").eq("id", myProfile.companyId).single(),
        supabase.from("profiles").select("*").eq("company_id", myProfile.companyId),
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
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
      ]);
      if (cancelled) return;
      if (companyRes.error) console.error(companyRes.error);
      else {
        setCompanyName(companyRes.data.name);
        setCompanyLogo(companyRes.data.logo_url || "");
        setFoodSafetyDisclaimerAcceptedAt(companyRes.data.food_safety_disclaimer_accepted_at || null);
      }
      if (teammatesRes.error) console.error(teammatesRes.error);
      else setTeammates(teammatesRes.data.map(rowToProfile));
      if (batchesRes.error) console.error(batchesRes.error);
      else setBatches(batchesRes.data.map(rowToBatch));
      if (inventoryRes.error) console.error(inventoryRes.error);
      else setInventory(inventoryRes.data.map(rowToInventoryItem));
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
      setLoadingData(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const selected = useMemo(() => batches.find((b) => b.id === selectedId) || null, [batches, selectedId]);
  const nextNumber = useMemo(() => String(Math.max(0, ...batches.map((b) => parseInt(b.number, 10) || 0)) + 1), [batches]);
  const selectedPO = useMemo(() => purchaseOrders.find((p) => p.id === selectedPOId) || null, [purchaseOrders, selectedPOId]);
  const nextPONumber = useMemo(() => {
    const nums = purchaseOrders.map((p) => parseInt((p.poNumber.match(/\d+/) || [0])[0], 10) || 0);
    return `PO-${Math.max(100, ...nums) + 1}`;
  }, [purchaseOrders]);
  const selectedRecipe = useMemo(() => recipes.find((r) => r.id === selectedRecipeId) || null, [recipes, selectedRecipeId]);
  const selectedInventoryItem = useMemo(
    () => inventory.find((it) => it.id === selectedInventoryId) || null,
    [inventory, selectedInventoryId]
  );

  const addBatch = async (b) => {
    const { data, error } = await supabase.from("batches").insert(batchToRow(b, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    setBatches((prev) => [rowToBatch(data), ...prev]);

    if (b.ingredients && b.ingredients.length > 0) {
      for (const ing of b.ingredients) {
        const item = inventory.find((it) => it.name.toLowerCase() === ing.name.toLowerCase());
        if (!item) continue;

        // Draw down lots oldest-first so we know exactly which lot(s) this
        // batch actually consumed from, not just the ingredient in general.
        let remainingToDeduct = ing.qty;
        const lotsUsed = [];
        const updatedLots = (item.lots || []).map((lot) => {
          const currentRemaining = lot.remainingQty ?? lot.qty;
          if (remainingToDeduct <= 0 || currentRemaining <= 0) {
            return { ...lot, remainingQty: currentRemaining };
          }
          const take = Math.round(Math.min(currentRemaining, remainingToDeduct) * 100) / 100;
          remainingToDeduct = Math.round((remainingToDeduct - take) * 100) / 100;
          if (take > 0) lotsUsed.push({ lotNumber: lot.lotNumber, qty: take });
          return { ...lot, remainingQty: Math.round((currentRemaining - take) * 100) / 100 };
        });

        const newQty = Math.max(0, Math.round((item.qty - ing.qty) * 100) / 100);
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
        if (invError) console.error(invError);
        else setInventory((prev) => prev.map((it) => (it.id === item.id ? { ...it, qty: newQty, lots: updatedLots, history: newHistory } : it)));
      }
    }
  };

  const deleteBatch = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
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
        console.error(invError);
        continue;
      }
      nextInventory[i] = { ...item, qty, lots, history: newHistory };
    }
    setInventory(nextInventory);

    const { error } = await supabase.from("batches").delete().eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.filter((b) => b.id !== id));
    setSelectedId(null);
  };

  const addRecipe = async (r) => {
    const familyId = r.familyId || uid();
    const versionsInFamily = recipes.filter((rec) => rec.familyId === familyId);
    const version = versionsInFamily.length > 0 ? Math.max(...versionsInFamily.map((v) => v.version || 1)) + 1 : 1;
    const payload = { ...r, familyId, version, isActive: true };
    const { data, error } = await supabase.from("recipes").insert(recipeToRow(payload, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    const newRecipe = rowToRecipe(data);

    if (versionsInFamily.length > 0) {
      const siblingIds = versionsInFamily.map((v) => v.id);
      const { error: deactivateError } = await supabase.from("recipes").update({ is_active: false }).in("id", siblingIds);
      if (deactivateError) console.error(deactivateError);
    }

    setRecipes((prev) => [newRecipe, ...prev.map((rec) => (rec.familyId === familyId ? { ...rec, isActive: false } : rec))]);
    setSelectedRecipeId(newRecipe.id);
  };

  const setActiveRecipeVersion = async (recipeId, familyId) => {
    const versionsInFamily = recipes.filter((rec) => rec.familyId === familyId);
    const otherIds = versionsInFamily.map((v) => v.id).filter((id) => id !== recipeId);
    const { error: activateError } = await supabase.from("recipes").update({ is_active: true }).eq("id", recipeId);
    if (activateError) return console.error(activateError);
    if (otherIds.length > 0) {
      const { error: deactivateError } = await supabase.from("recipes").update({ is_active: false }).in("id", otherIds);
      if (deactivateError) console.error(deactivateError);
    }
    setRecipes((prev) => prev.map((rec) => (rec.familyId === familyId ? { ...rec, isActive: rec.id === recipeId } : rec)));
  };

  const deleteRecipe = async (id) => {
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) return console.error(error);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setSelectedRecipeId(null);
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
        if (error) return console.error(error);
        setCompanyLogo(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const removeCompanyLogo = async () => {
    const { error } = await supabase.from("companies").update({ logo_url: null }).eq("id", profile.companyId);
    if (error) return console.error(error);
    setCompanyLogo("");
  };

  const acceptFoodSafetyDisclaimer = async () => {
    const acceptedAt = new Date().toISOString();
    const { error } = await supabase
      .from("companies")
      .update({ food_safety_disclaimer_accepted_at: acceptedAt, food_safety_disclaimer_accepted_by: user.name })
      .eq("id", profile.companyId);
    if (error) return console.error(error);
    setFoodSafetyDisclaimerAcceptedAt(acceptedAt);
  };

  const disconnectXero = async () => {
    const { error } = await supabase.from("xero_connections").delete().eq("company_id", profile.companyId);
    if (error) return console.error(error);
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
    if (data.error) return console.error(data.error);
    setXeroAccounts(data.accounts || []);
  };

  const saveXeroAdjustmentAccount = async (code, name) => {
    const { error } = await supabase
      .from("xero_settings")
      .upsert({ company_id: profile.companyId, adjustment_account_code: code, adjustment_account_name: name });
    if (error) return console.error(error);
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
        console.error(error);
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
        console.error(error);
        continue;
      }
      nextInventory[idx] = { ...item, qty: line.countedQty, history: newHistory };
    }
    setInventory(nextInventory);

    const record = { id: uid(), date, userName: user.name, lines };
    const { data, error: stError } = await supabase
      .from("stock_takes")
      .insert(stockTakeToRow(record, user.id, profile.companyId))
      .select()
      .single();
    if (stError) return console.error(stError);
    setStockTakes((prev) => [rowToStockTake(data), ...prev]);
  };

  const addFoodSafetyRecord = async (record) => {
    const payload = { id: uid(), userName: user.name, ...record };
    const { data, error } = await supabase
      .from("food_safety_records")
      .insert(foodSafetyRecordToRow(payload, user.id, profile.companyId))
      .select()
      .single();
    if (error) return console.error(error);
    setFoodSafetyRecords((prev) => [rowToFoodSafetyRecord(data), ...prev]);
  };

  const addSupplier = async (supplier) => {
    const payload = { id: uid(), ...supplier };
    const { data, error } = await supabase
      .from("suppliers")
      .insert(supplierToRow(payload, profile.companyId))
      .select()
      .single();
    if (error) return console.error(error);
    setSuppliers((prev) => [...prev, rowToSupplier(data)].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const updateSupplier = async (id, patch) => {
    const supplier = suppliers.find((s) => s.id === id);
    if (!supplier) return;
    const updated = { ...supplier, ...patch };
    const { error } = await supabase
      .from("suppliers")
      .update(supplierToRow(updated, profile.companyId))
      .eq("id", id);
    if (error) return console.error(error);
    setSuppliers((prev) => prev.map((s) => (s.id === id ? updated : s)).sort((a, b) => a.name.localeCompare(b.name)));
  };

  const deleteSupplier = async (id) => {
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) return console.error(error);
    setSuppliers((prev) => prev.filter((s) => s.id !== id));
    setSupplierDocuments((prev) => prev.filter((d) => d.supplierId !== id));
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
    return { success: true };
  };

  const deleteSupplierDocument = async (doc) => {
    await supabase.storage.from("supplier-documents").remove([doc.filePath]);
    const { error } = await supabase.from("supplier_documents").delete().eq("id", doc.id);
    if (error) return console.error(error);
    setSupplierDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  };

  const openSupplierDocument = async (doc) => {
    const { data, error } = await supabase.storage.from("supplier-documents").createSignedUrl(doc.filePath, 60);
    if (error) {
      console.error(error);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const addTank = async (t) => {
    const { data, error } = await supabase.from("tanks").insert(tankToRow(t, profile.companyId)).select().single();
    if (error) return console.error(error);
    setTanks((prev) => [rowToTank(data), ...prev]);
  };

  const updateTank = async (id, patch) => {
    const { error } = await supabase.from("tanks").update({ name: patch.name, capacity: patch.capacity }).eq("id", id);
    if (error) return console.error(error);
    setTanks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const deleteTank = async (id) => {
    const { error } = await supabase.from("tanks").delete().eq("id", id);
    if (error) return console.error(error);
    setTanks((prev) => prev.filter((t) => t.id !== id));
  };

  const assignBatchTank = async (batchId, tank) => {
    const { error } = await supabase
      .from("batches")
      .update({ tank_id: tank ? tank.id : null, tank_name: tank ? tank.name : null })
      .eq("id", batchId);
    if (error) return console.error(error);
    setBatches((prev) =>
      prev.map((b) => (b.id === batchId ? { ...b, tankId: tank ? tank.id : null, tankName: tank ? tank.name : null } : b))
    );
  };

  const addInventoryItem = async (item) => {
    const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(item, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    setInventory((prev) => [rowToInventoryItem(data), ...prev]);
  };

  const updateInventorySupplier = async (id, supplierId) => {
    const { error } = await supabase.from("inventory_items").update({ supplier_id: supplierId }).eq("id", id);
    if (error) return console.error(error);
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
    if (error) return console.error(error);
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
    if (error) return console.error(error);
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty, history: newHistory } : it)));
  };

  const addPO = async (po) => {
    const { data, error } = await supabase.from("purchase_orders").insert(poToRow(po, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    setPurchaseOrders((prev) => [rowToPO(data), ...prev]);
  };

  const markPOSent = async (id) => {
    const { error } = await supabase.from("purchase_orders").update({ status: "Sent" }).eq("id", id);
    if (error) return console.error(error);
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Sent" } : p)));
  };

  const receivePO = async (id, lotNumbers) => {
    const po = purchaseOrders.find((p) => p.id === id);
    if (!po) return;

    let nextInventory = [...inventory];
    const finalizedLines = [];
    for (const line of po.lines) {
      const lotNumber = (lotNumbers && lotNumbers[line.id] && lotNumbers[line.id].trim()) || "no lot #";
      finalizedLines.push({ ...line, lotNumber });
      const idx = nextInventory.findIndex((it) => it.name.toLowerCase() === line.name.toLowerCase());
      const lotEntry = { id: uid(), lotNumber, qty: line.qty, remainingQty: line.qty, date: today(), poNumber: po.poNumber };
      const historyEntry = { id: uid(), date: new Date().toISOString(), user: user.name, type: "received", delta: line.qty, note: `${po.poNumber} — ${po.supplier}` };

      if (idx >= 0) {
        const item = nextInventory[idx];
        const newQty = Math.round((item.qty + line.qty) * 100) / 100;
        const newLots = [...(item.lots || []), lotEntry];
        const newHistory = [...(item.history || []), historyEntry];
        const { error } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots, history: newHistory }).eq("id", item.id);
        if (error) {
          console.error(error);
          continue;
        }
        nextInventory[idx] = { ...item, qty: newQty, lots: newLots, history: newHistory };
      } else {
        const newItem = { id: uid(), name: line.name, category: line.category, qty: line.qty, unit: line.unit, threshold: 0, lots: [lotEntry], history: [historyEntry] };
        const { data, error } = await supabase.from("inventory_items").insert(inventoryItemToRow(newItem, user.id, profile.companyId)).select().single();
        if (error) {
          console.error(error);
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
    if (poError) return console.error(poError);
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Received", receivedDate: today(), lines: finalizedLines } : p)));
  };

  const advance = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const idx = STAGES.indexOf(batch.stage);
    if (idx >= STAGES.length - 1) return;
    const nextStage = STAGES[idx + 1];
    const { error } = await supabase.from("batches").update({ stage: nextStage }).eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stage: nextStage } : b)));
  };

  const moveStageBack = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const idx = STAGES.indexOf(batch.stage);
    if (idx <= 0) return;
    const prevStage = STAGES[idx - 1];
    const { error } = await supabase.from("batches").update({ stage: prevStage }).eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, stage: prevStage } : b)));
  };

  const logReading = async (id, reading) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const readings = [...batch.readings, reading];
    const { error } = await supabase.from("batches").update({ readings }).eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, readings } : b)));
  };

  const deleteReading = async (batchId, readingId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch || batch.readings.length <= 1) return;
    const readings = batch.readings.filter((r) => r.id !== readingId);
    const { error } = await supabase.from("batches").update({ readings }).eq("id", batchId);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, readings } : b)));
  };

  const updateBrewDay = async (id, patch) => {
    const { error } = await supabase
      .from("batches")
      .update({ mash_ph: patch.mashPh, pre_boil_gravity: patch.preBoilGravity, top_up_water: patch.topUpWater })
      .eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const toggleScheduleStep = async (batchId, stepId) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return;
    const newSchedule = (batch.schedule || []).map((s) =>
      s.id === stepId ? { ...s, done: !s.done, doneAt: !s.done ? new Date().toISOString() : null } : s
    );
    const { error } = await supabase.from("batches").update({ schedule: newSchedule }).eq("id", batchId);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, schedule: newSchedule } : b)));
  };

  const logPackagingSession = async (id, sessionCounts) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const events = packagingEvents(batch);
    const newEvent = { id: uid(), date: today(), ...sessionCounts };
    const newPackaging = { events: [...events, newEvent], discarded: packagingDiscarded(batch) };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged" }).eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging, stage: "Packaged" } : b)));
    syncPackagingToXero(batch, sessionCounts);
  };

  const deletePackagingEvent = async (id, eventId) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const events = packagingEvents(batch).filter((e) => e.id !== eventId);
    const newPackaging = { events, discarded: packagingDiscarded(batch) };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging }).eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, packaging: newPackaging } : b)));
  };

  const discardRemaining = async (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const events = packagingEvents(batch);
    const newDiscarded = packagingDiscarded(batch) + remainingVolume(batch);
    const newPackaging = { events, discarded: newDiscarded };
    const { error } = await supabase.from("batches").update({ packaging: newPackaging, stage: "Packaged" }).eq("id", id);
    if (error) return console.error(error);
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

  const fermentingBatches = batches.filter((b) => ["Brewing", "Primary", "Secondary"].includes(b.stage));
  const conditioningBatches = batches.filter((b) => b.stage === "Conditioning");
  const inProgressBatches = batches.filter((b) => b.stage === "Packaged" && remainingVolume(b) > 0);
  const packagedBatches = batches.filter((b) => b.stage === "Packaged" && remainingVolume(b) === 0);

  if (justConfirmedEmail) {
    return <EmailConfirmedScreen onContinue={() => setJustConfirmedEmail(false)} />;
  }

  if (session === undefined) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F1E4", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>Loading…</span>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
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

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <div
          style={{
            width: 210,
            flexShrink: 0,
            borderRight: "1px solid #DDE0C8",
            padding: "24px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#5C9A3C", padding: "0 6px" }}>
            <BreworxMark size={26} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Brewpoint
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[
              ["home", "Home"],
              ["batches", "Fermentation"],
              ["packaged", "Packaged"],
              ["inventory", "Inventory"],
              ["orders", "Purchase Orders"],
              ["recipes", "Recipes"],
              ["brewery", "Brewery"],
              ["foodsafety", "Food Safety"],
              ["settings", "Settings"],
            ].map(([key, label]) => {
              const isCurrent = view === key && !selected && !selectedPO && !selectedRecipe && !selectedInventoryItem;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setView(key);
                    setSelectedId(null);
                    setSelectedPOId(null);
                    setSelectedRecipeId(null);
                    setSelectedInventoryId(null);
                  }}
                  style={{
                    textAlign: "left",
                    background: isCurrent ? "#FFFFFF" : "none",
                    border: "none",
                    borderLeft: `2px solid ${isCurrent ? "#5C9A3C" : "transparent"}`,
                    borderRadius: 4,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
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

        <div style={{ flex: 1, minWidth: 0, padding: "24px 22px 60px" }}>
        {!selected && !selectedPO && !selectedRecipe && !selectedInventoryItem && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
              {view !== "settings" && view !== "home" && view !== "packaged" && view !== "foodsafety" && (
                <button
                  onClick={() => {
                    if (view === "batches") setShowAdd(true);
                    else if (view === "inventory") setShowAddInventory(true);
                    else if (view === "orders") setShowAddPO(true);
                    else if (view === "recipes") setShowAddRecipe(true);
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
                  {view === "batches" ? "New batch" : view === "inventory" ? "New item" : view === "orders" ? "New order" : view === "recipes" ? "New recipe" : "New tank"}
                </button>
              )}
            </div>

            {loadingData && (
              <div style={{ color: "#9BA88A", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", padding: "20px 4px" }}>
                Loading your brewery…
              </div>
            )}

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
              <FoodSafetyView
                records={foodSafetyRecords}
                onStartChecklist={setActiveChecklistTemplate}
                onStartCalibration={() => setShowCalibrationModal(true)}
                onStartTraining={() => setShowTrainingModal(true)}
                onStartNote={(category, title) => setActiveNoteModal({ category, title })}
                onOpenStaff={setViewingStaffTraining}
                suppliers={suppliers}
                onOpenSupplier={setViewingSupplierDocs}
              />
            )}
            {!loadingData && view === "foodsafety" && !foodSafetyDisclaimerAcceptedAt && (
              <FoodSafetyDisclaimerModal onAccept={acceptFoodSafetyDisclaimer} />
            )}

            {!loadingData && view === "batches" && (
              <>
                <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                  Fermenting ({fermentingBatches.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (conditioningBatches.length || inProgressBatches.length || packagedBatches.length) ? 26 : 0 }}>
                  {fermentingBatches.map((b) => (
                    <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                  ))}
                  {fermentingBatches.length === 0 && (
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                      No batches fermenting right now. Start one to get going.
                    </div>
                  )}
                </div>

                {conditioningBatches.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                      Conditioning ({conditioningBatches.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (inProgressBatches.length || packagedBatches.length) ? 26 : 0 }}>
                      {conditioningBatches.map((b) => (
                        <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                      ))}
                    </div>
                  </>
                )}

                {inProgressBatches.length > 0 && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#D4A24C", marginBottom: 10 }}>
                      <Package size={12} /> Packaging in progress ({inProgressBatches.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: packagedBatches.length ? 26 : 0 }}>
                      {inProgressBatches.map((b) => (
                        <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                      ))}
                    </div>
                  </>
                )}

                {packagedBatches.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                      Packaged ({packagedBatches.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {packagedBatches.map((b) => (
                        <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

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
                      Past reports ({stockTakes.length})
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
                      marginBottom: 16,
                    }}
                  />

                  {inventory.some((it) => it.qty <= it.threshold) && (
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
                      {inventory.filter((it) => it.qty <= it.threshold).length} item(s) running low
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
                          <InventoryItemCard key={it.id} item={it} onAdjust={adjustInventory} onOpen={setSelectedInventoryId} suppliers={suppliers} />
                        ))}
                      </div>
                    </div>
                  ))}

                  {filtered.length === 0 && (
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                      {inventory.length === 0
                        ? "No ingredients tracked yet. Add grain, hops, or yeast to get started."
                        : `No ingredients match "${inventoryQuery}".`}
                    </div>
                  )}
                </>
              );
            })()}

            {!loadingData && view === "orders" && (() => {
              const draftPOs = purchaseOrders.filter((po) => po.status === "Draft");
              const sentPOs = purchaseOrders.filter((po) => po.status === "Sent");
              const receivedPOs = purchaseOrders.filter((po) => po.status === "Received");
              return (
                <>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
                    Draft ({draftPOs.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (sentPOs.length || receivedPOs.length) ? 26 : 0 }}>
                    {draftPOs.map((po) => (
                      <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                    ))}
                    {draftPOs.length === 0 && (
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
                    <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                      No purchase orders yet. Create one to bring in ingredients with lot tracking.
                    </div>
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
                      <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                        {activeByFamily.length === 0
                          ? "No recipes yet. Add one so you can assign its ingredients when you start a brew."
                          : `No recipes match "${recipeQuery}".`}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {!loadingData && view === "brewery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tanks.map((t) => {
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
                        <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: 0 }}>
                          {t.name}
                        </h3>
                        <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: 3 }}>
                          {t.capacity}L{occupant ? ` · occupied by ${occupant.name}` : " · empty"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
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
                  <div style={{ color: "#9BA88A", fontSize: 13.5, padding: "20px 4px" }}>
                    No tanks set up yet. Add your fermenters and conditioning vessels so batches can be assigned to them.
                  </div>
                )}
              </div>
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
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", fontSize: 11, textTransform: "uppercase" }}>
                          {t.role}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: "#9BA88A", fontSize: 12, marginTop: 10 }}>
                    Anyone who signs up using "{companyName}" as their company name joins this team automatically.
                  </div>
                </div>

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
              </div>
            )}
          </>
        )}

        {selected && (
          <BatchDetail
            batch={selected}
            onBack={() => setSelectedId(null)}
            onAdvance={advance}
            onMoveBack={moveStageBack}
            onLogReading={setLogTarget}
            onDeleteReading={deleteReading}
            onEditBrewDay={setBrewDayTarget}
            onOpenPackaging={setPackagingTarget}
            onDeletePackagingEvent={deletePackagingEvent}
            onDiscardRemaining={setDiscardTarget}
            onAssignTank={setAssignTankTarget}
            onToggleScheduleStep={toggleScheduleStep}
            onDeleteBatch={setDeleteBatchTarget}
          />
        )}

        {!selected && selectedPO && (
          <PODetail po={selectedPO} onBack={() => setSelectedPOId(null)} onMarkSent={markPOSent} onReceive={receivePO} inventory={inventory} />
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
          />
        )}

        {!selected && !selectedPO && !selectedRecipe && selectedInventoryItem && (
          <InventoryItemDetail
            item={selectedInventoryItem}
            onBack={() => setSelectedInventoryId(null)}
            onAdjust={adjustInventory}
            onLogAdjustment={setAdjustTarget}
            suppliers={suppliers}
            onChangeSupplier={updateInventorySupplier}
          />
        )}
        </div>
      </div>

      {showAdd && (
        <AddBatchModal
          onClose={() => {
            setShowAdd(false);
            setBrewRecipe(null);
          }}
          onAdd={addBatch}
          nextNumber={nextNumber}
          recipes={recipes}
          presetRecipe={brewRecipe}
          tanks={tanks}
          batches={batches}
          inventory={inventory}
          onAddInventoryItem={addInventoryItem}
        />
      )}
      {showAddInventory && <AddInventoryModal onClose={() => setShowAddInventory(false)} onAdd={addInventoryItem} suppliers={suppliers} />}
      {showStockTake && (
        <StockTakeModal inventory={inventory} onClose={() => setShowStockTake(false)} onComplete={completeStockTake} />
      )}
      {showStockTakeHistory && (
        <StockTakeHistoryModal
          stockTakes={stockTakes}
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
      {assignTankTarget && (
        <AssignTankModal batch={assignTankTarget} tanks={tanks} batches={batches} onClose={() => setAssignTankTarget(null)} onSave={assignBatchTank} />
      )}
      {logTarget && (
        <LogReadingModal batch={logTarget} onClose={() => setLogTarget(null)} onLog={logReading} />
      )}
      {brewDayTarget && (
        <BrewDayModal batch={brewDayTarget} onClose={() => setBrewDayTarget(null)} onSave={updateBrewDay} />
      )}
      {packagingTarget && (
        <PackagingModal batch={packagingTarget} onClose={() => setPackagingTarget(null)} onSave={logPackagingSession} />
      )}
      {discardTarget && (
        <DiscardRemainingModal batch={discardTarget} onClose={() => setDiscardTarget(null)} onConfirm={discardRemaining} />
      )}
      {showDeleteAccount && (
        <DeleteAccountModal onClose={() => setShowDeleteAccount(false)} onConfirm={deleteAccount} />
      )}
    </div>
  );
}
