import { areNamesSimilar } from "./config";
import { uid } from "./production";

// --- Recipe calculation engine ---------------------------------------------
// Formulas adapted to metric units (kg, L, g) from the standard brewing
// references: Tinseth (IBU), Morey (SRM), and the common gravity-points model
// for OG. These are estimates, same as any brewing software — real mash
// efficiency and hop utilization vary batch to batch.

// OG from the grain bill. Each grain ingredient may carry a `potential`
// field — the standard points-per-pound-per-gallon (PPG) figure every
// maltster publishes (roughly 37-38 for a standard base malt, lower for
// specialty/crystal malts). Converted internally to metric.
export function calcOG(ingredients, batchVolumeL, efficiencyPct) {
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
export function calcSRM(ingredients, batchVolumeL) {
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
export function calcIBU(schedule, batchVolumeL, og) {
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

export function calcFG(og, attenuationPct) {
  if (!og || !attenuationPct) return null;
  return og - (og - 1) * (Number(attenuationPct) / 100);
}

export function calcABV(og, fg) {
  if (!og || !fg) return null;
  return (og - fg) * 131.25;
}

// Checks a batch's actual measured OG/FG (from its own readings) against
// its recipe's target range — the automatic half of quality control,
// catching a batch that's drifted from spec even if nobody happened to
// notice while logging the reading. OG is checked once fermentation has
// genuinely started; FG only once it's likely finished (past Primary),
// since a single early reading isn't a real final gravity yet.
export function batchSpecDeviations(batch, recipe) {
  if (!recipe || !batch.readings || batch.readings.length === 0) return [];
  const deviations = [];

  const measuredOg = batch.readings[0]?.gravity;
  if (measuredOg != null && recipe.og != null) {
    const tolerance = recipe.ogTolerance ?? 0.003;
    if (Math.abs(measuredOg - recipe.og) > tolerance) {
      deviations.push({ metric: "OG", target: recipe.og, tolerance, actual: measuredOg, direction: measuredOg > recipe.og ? "high" : "low" });
    }
  }

  const fermentationLikelyDone = ["Brite Tank", "Aging", "Packaged"].includes(batch.stage) || batch.readings.length >= 2;
  if (fermentationLikelyDone) {
    const measuredFg = batch.readings[batch.readings.length - 1]?.gravity;
    if (measuredFg != null && recipe.fg != null) {
      const tolerance = recipe.fgTolerance ?? 0.003;
      if (Math.abs(measuredFg - recipe.fg) > tolerance) {
        deviations.push({ metric: "FG", target: recipe.fg, tolerance, actual: measuredFg, direction: measuredFg > recipe.fg ? "high" : "low" });
      }
    }
  }

  return deviations;
}

// --- Water chemistry ---------------------------------------------------
// ppm contributed per gram of salt dissolved per litre of water, derived
// from each salt's molecular weight and ion content.
export const SALT_CONTRIBUTIONS = {
  gypsum: { label: "Gypsum (CaSO4)", ca: 232.8, so4: 558.0 },
  calciumChloride: { label: "Calcium Chloride (CaCl2)", ca: 272.6, cl: 482.3 },
  epsomSalt: { label: "Epsom Salt (MgSO4)", mg: 98.6, so4: 389.8 },
  tableSalt: { label: "Table Salt (NaCl)", na: 393.4, cl: 606.7 },
  bakingSoda: { label: "Baking Soda (NaHCO3)", na: 273.7, hco3: 726.4 },
  chalk: { label: "Chalk (CaCO3)", ca: 400.5, hco3: 733.3 }, // reported as HCO3-equivalent alkalinity; dissolves poorly outside the mash
};

export const WATER_PROFILE_PRESETS = {
  "RO / Distilled": { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 },
  "Balanced / Pale Ale": { ca: 75, mg: 5, na: 10, cl: 75, so4: 100, hco3: 50 },
  "Hoppy / IPA": { ca: 100, mg: 5, na: 10, cl: 50, so4: 200, hco3: 25 },
  "Malty / Stout": { ca: 100, mg: 10, na: 15, cl: 100, so4: 50, hco3: 150 },
  "Pilsner": { ca: 40, mg: 5, na: 5, cl: 15, so4: 15, hco3: 25 },
};

export function calcResultingWaterProfile(sourceWater, saltGrams, batchVolumeL) {
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
export function calcResidualAlkalinity(waterProfile) {
  const hco3 = waterProfile.hco3 || 0;
  const ca = waterProfile.ca || 0;
  const mg = waterProfile.mg || 0;
  const alkalinityAsCaCO3 = hco3 * 0.8202; // HCO3 to CaCO3-equivalent
  return alkalinityAsCaCO3 - (ca / 1.4 + mg / 1.7);
}


export function formatHistoryStamp(dateStr) {
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
export function seedBatches() {
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
export const BJCP_STYLES = [
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
export const BA_STYLES = [
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
export const ALL_STYLES = [
  ...BJCP_STYLES.flatMap((g) => g.styles.map((s) => ({ name: s, source: "BJCP" }))),
  ...BA_STYLES.flatMap((g) => g.styles.map((s) => ({ name: s, source: "BA" }))),
];

// Reference libraries of common malts, hops, and yeast strains from major
// suppliers worldwide, used to auto-fill the brewing-science fields (potential,
// colour, alpha acid, attenuation) when building a recipe. Figures are typical
// published values for each product — treat them as a solid starting point,
// not an exact spec sheet; edit them if you have the maltster's own numbers.
export const MALT_LIBRARY = {
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

export const HOP_LIBRARY = {
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

export const YEAST_LIBRARY = {
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

export const MALT_LIBRARY_FLAT = Object.entries(MALT_LIBRARY).flatMap(([company, items]) => items.map((i) => ({ ...i, company })));
export const HOP_LIBRARY_FLAT = Object.entries(HOP_LIBRARY).flatMap(([region, items]) => items.map((i) => ({ ...i, company: region })));
export const YEAST_LIBRARY_FLAT = Object.entries(YEAST_LIBRARY).flatMap(([company, items]) => items.map((i) => ({ ...i, company })));

// Parses a BeerXML file (the open interchange format exported by Brewfather,
// BeerSmith, and most other brewing software) into the shape this app's
// recipe form expects. Returns null if the file doesn't look like BeerXML.
// BeerXML amounts for fermentables/hops/misc are always in kilograms.
export function buildScheduleLabel(use, time, name) {
  if (use === "Dry Hop") return `Dry hop — day ${time ?? "?"}: add ${name}`;
  if (use === "Boil") return `Boil, ${time ?? "?"} min remaining: add ${name}`;
  if (use === "Mash") return time != null && time !== "" ? `Mash, ${time} min: add ${name}` : `Mash: add ${name}`;
  if (use === "First Wort") return `First wort: add ${name}`;
  return `${use || "Add"}${time != null && time !== "" ? `, ${time} min` : ""}: add ${name}`;
}

export function parseBeerXML(xmlText) {
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
  // Exact match first (safest); fall back to the same fuzzy similarity
  // check used elsewhere, since BeerXML names are often more verbose or
  // differently ordered than the library's ("Weyermann Pilsner" vs
  // "Weyermann Pilsner Malt"). Never guesses across categories.
  const findLibraryMatch = (name, library) => {
    const q = name.trim().toLowerCase();
    return library.find((it) => it.name.trim().toLowerCase() === q) || library.find((it) => areNamesSimilar(name, it.name)) || null;
  };
  const collect = (containerTag, itemTag, category, unit, qtyFn) => {
    const container = recipeEl.getElementsByTagName(containerTag)[0];
    if (!container) return;
    Array.from(container.getElementsByTagName(itemTag)).forEach((el) => {
      const itemName = text(el, "NAME") || itemTag;
      const entry = { id: uid(), name: itemName, category, qty: qtyFn(el), unit };
      // The file's own figures are specific to what that recipe actually
      // used, so they're more accurate than a generic library default —
      // read them directly first, and only fall back to library matching
      // when the file itself doesn't provide them (some exports omit it).
      if (category === "Grain") {
        const yieldPct = num(el, "YIELD");
        const colorL = num(el, "COLOR");
        if (yieldPct != null) entry.potential = Math.round((yieldPct / 100) * 46 * 10) / 10;
        if (colorL != null) entry.colorLovibond = colorL;
        if (entry.potential != null || entry.colorLovibond != null) entry.libSourced = false;
        if (entry.potential == null || entry.colorLovibond == null) {
          const match = findLibraryMatch(itemName, MALT_LIBRARY_FLAT);
          if (match) {
            if (entry.potential == null) entry.potential = match.potential;
            if (entry.colorLovibond == null) entry.colorLovibond = match.colorLovibond;
            entry.libSourced = true;
          }
        }
      } else if (category === "Hops") {
        const alpha = num(el, "ALPHA");
        if (alpha != null) {
          entry.alphaAcid = alpha;
          entry.libSourced = false;
        } else {
          const match = findLibraryMatch(itemName, HOP_LIBRARY_FLAT);
          if (match) { entry.alphaAcid = match.alphaAcid; entry.libSourced = true; }
        }
      } else if (category === "Yeast") {
        const atten = num(el, "ATTENUATION");
        if (atten != null) {
          entry.attenuation = atten;
          entry.libSourced = false;
        } else {
          const match = findLibraryMatch(itemName, YEAST_LIBRARY_FLAT);
          if (match) { entry.attenuation = match.attenuation; entry.libSourced = true; }
        }
      }
      ingredients.push(entry);
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

export function attenuation(og, fg, current) {
  if (og === fg) return 0;
  const pct = ((og - current) / (og - fg)) * 100;
  return Math.min(100, Math.max(0, pct));
}

// Standard SRM-to-color reference chart (1-40), the same approximation used
// across most homebrew calculators — purely decorative, not scientific.
export const SRM_COLORS = [
  "#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123", "#F8A600", "#F39C00", "#EA8F00",
  "#E58500", "#DE7C00", "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100", "#B54C00",
  "#B04500", "#A63E00", "#A13700", "#9B3200", "#952D00", "#8E2900", "#882300", "#821E00",
  "#7B1A00", "#771900", "#6C1400", "#661100", "#600F00", "#5A0E00", "#550C00", "#4F0B00",
  "#4A0900", "#450800", "#400706", "#3B0607", "#360607", "#310505", "#2C0403", "#270403",
];
export function srmToHex(srm) {
  if (srm == null || isNaN(srm)) return null;
  const idx = Math.max(1, Math.min(40, Math.round(srm))) - 1;
  return SRM_COLORS[idx];
}
