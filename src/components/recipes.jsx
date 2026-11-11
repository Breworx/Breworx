import { useState, Suspense } from "react";
import { Plus, ChevronLeft, TrendingUp, Beaker, AlertTriangle, CheckCircle2, Trash2, FileText } from "lucide-react";
// Charts: recharts is imported directly. Lazy-loading each piece separately
// (as this used to) breaks recharts — a chart only draws children it
// recognises by type, so lazy-wrapped bars, lines and axes were skipped and
// every chart rendered as an empty frame.
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ConfirmDialogModal, EmptyState, LockedField, Modal, NumberField, SelectField, TextField } from "./ui";
import { ALL_STYLES, HOP_LIBRARY_FLAT, MALT_LIBRARY_FLAT, SALT_CONTRIBUTIONS, WATER_PROFILE_PRESETS, YEAST_LIBRARY_FLAT, attenuation, buildScheduleLabel, calcABV, calcFG, calcIBU, calcOG, calcResidualAlkalinity, calcResultingWaterProfile, calcSRM, parseBeerXML, srmToHex } from "../lib/brewing";
import { CATEGORIES, CATEGORY_COLOR, areNamesSimilar, latestReading } from "../lib/config";
import { PRODUCT_TYPES } from "../lib/excise";
import { COMMON_FAULTS, FAULT_SEVERITY_COLOR, activeRecipesByFamily, batchTankSummary, compareScheduleItems, currentFaults, formatQty, recipeDemandForecast, sameItemName, uid } from "../lib/production";
import { daysBetween } from "../lib/utils";

export function RecipeCard({ recipe, onOpen }) {
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

export function AddRecipeModal({ onClose, onAdd, inventory, onAddInventoryItem, editingRecipe, standalone = false, onSaveAndBrew }) {
  const [name, setName] = useState(editingRecipe ? editingRecipe.name : "");
  const [style, setStyle] = useState(editingRecipe ? editingRecipe.style : "");
  const [productType, setProductType] = useState(editingRecipe ? editingRecipe.productType || "Beer" : "Beer");
  const [styleFocused, setStyleFocused] = useState(false);
  const [volume, setVolume] = useState(editingRecipe ? editingRecipe.volume : 20);
  const [og, setOg] = useState(editingRecipe ? editingRecipe.og : 1.05);
  const [fg, setFg] = useState(editingRecipe ? editingRecipe.fg : 1.01);
  const [ogTolerance, setOgTolerance] = useState(editingRecipe?.ogTolerance ?? 0.003);
  const [fgTolerance, setFgTolerance] = useState(editingRecipe?.fgTolerance ?? 0.003);
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

  // Catches the near-misses the exact/substring match above doesn't —
  // different spelling, extra words, that sort of thing. Shown separately
  // so it reads as "maybe you meant one of these" rather than a real match.
  const similarMatches = (query) => {
    const q = query.trim();
    if (q.length < 3) return [];
    const exact = new Set(ingredientMatches(q).map((it) => it.id));
    return inventory.filter((it) => !exact.has(it.id) && areNamesSimilar(q, it.name)).slice(0, 5);
  };

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
      ogTolerance: Number(ogTolerance) || 0.003,
      fgTolerance: Number(fgTolerance) || 0.003,
      ingredients: clean.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
      schedule: cleanSchedule,
      familyId: editingRecipe ? editingRecipe.familyId : null,
      efficiency: Number(efficiency) || 72,
      boilTime: Number(boilTime) || 60,
      waterChemistry: showWaterChemistry ? { sourceWater, targetPreset: targetWaterPreset, saltGrams } : null,
      productType,
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
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Product type (for excise classification)</div>
          <select
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          >
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Batch volume" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          <NumberField label="Target OG" value={og} onChange={setOg} step="0.001" />
          <NumberField label="Target FG" value={fg} onChange={setFg} step="0.001" />
          <NumberField label="OG tolerance (±)" value={ogTolerance} onChange={setOgTolerance} step="0.001" />
          <NumberField label="FG tolerance (±)" value={fgTolerance} onChange={setFgTolerance} step="0.001" />
          <NumberField label="Boil time" value={boilTime} onChange={setBoilTime} step="5" suffix="min" />
          <NumberField label="Mash efficiency" value={efficiency} onChange={setEfficiency} step="1" suffix="%" />
        </div>
        <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: -8 }}>
          A batch whose measured OG or FG falls outside this range shows up as a spec deviation in Quality Control.
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
                  {similarMatches(line.name).length > 0 && (
                    <>
                      <div style={{ padding: "6px 10px", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", background: "#F5F1E4" }}>
                        Similar — double check before adding new
                      </div>
                      {similarMatches(line.name).map((it) => (
                        <button
                          key={`similar-${it.id}`}
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
                    </>
                  )}
                  {line.name.trim().length > 0 &&
                    !inventory.some((it) => sameItemName(it.name, line.name)) && (
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
              <SelectField label="Category" value={line.category} onChange={(v) => updateLine(line.id, { category: v, ...(v === "Juice" ? { unit: "L" } : {}) })} options={CATEGORIES} />
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
                ogTolerance: Number(ogTolerance) || 0.003,
                fgTolerance: Number(fgTolerance) || 0.003,
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

export function ScaleRecipeModal({ recipe, onClose, onScale }) {
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

// Shown after saving a recipe (if anything's new) or on demand from an
// existing recipe's own page — same modal either way, since the check
// itself is identical: recipe's ingredient list against what's already
// in Inventory.
export function MissingIngredientsModal({ missing, sourceLabel, inventory, onClose, onAdd, onMatch }) {
  const [decisions, setDecisions] = useState(() => {
    const initial = {};
    missing.forEach((m) => {
      initial[m.name] = "add";
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);

  const setDecision = (name, value) => setDecisions((prev) => ({ ...prev, [name]: value }));

  const submit = async () => {
    setSaving(true);
    for (const m of missing) {
      const decision = decisions[m.name];
      if (decision === "skip") continue;
      if (decision === "add") {
        await onAdd({ id: uid(), name: m.name, category: m.category, qty: 0, unit: m.unit, threshold: 0 });
      } else {
        const matchedItem = inventory.find((it) => it.id === decision);
        if (matchedItem) await onMatch(m.name, matchedItem);
      }
    }
    setSaving(false);
    onClose();
  };

  const pillStyle = (active, activeColor) => ({
    background: active ? activeColor : "#FFFFFF",
    border: `1px solid ${active ? activeColor : "#DDE0C8"}`,
    borderRadius: 20,
    padding: "5px 12px",
    color: active ? "#FFFFFF" : "#5C6B54",
    fontSize: 12,
    fontFamily: "'Inter', sans-serif",
    cursor: "pointer",
  });

  return (
    <Modal title="New ingredients found" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          {sourceLabel} uses {missing.length} ingredient{missing.length !== 1 ? "s" : ""} not yet matched to your Inventory. Where something similar already exists, match to it instead of creating a duplicate.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {missing.map((m) => {
            const similar = inventory.filter((it) => areNamesSimilar(m.name, it.name)).slice(0, 4);
            const decision = decisions[m.name];
            return (
              <div key={m.name} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "#2A3324", fontSize: 13.5, fontWeight: 500 }}>{m.name}</span>
                  <span style={{ color: "#9BA88A", fontSize: 11.5 }}>{m.category}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button onClick={() => setDecision(m.name, "add")} style={pillStyle(decision === "add", "#5C9A3C")}>
                    + Add as new
                  </button>
                  {similar.map((it) => (
                    <button key={it.id} onClick={() => setDecision(m.name, it.id)} style={pillStyle(decision === it.id, "#8E6FB5")}>
                      Match: {it.name}
                    </button>
                  ))}
                  <button onClick={() => setDecision(m.name, "skip")} style={pillStyle(decision === "skip", "#9BA88A")}>
                    Skip
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={submit}
          disabled={saving}
          style={{ background: saving ? "#E8E4D4" : "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: saving ? "#A3AC94" : "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, cursor: saving ? "default" : "pointer" }}
        >
          {saving ? "Saving…" : "Done"}
        </button>
      </div>
    </Modal>
  );
}

export function RecipeDetail({ recipe, inventory, onBack, onBrew, onDelete, versions, onSwitchVersion, onEdit, onSetActive, onScale, onCheckIngredients }) {
  const shortages = recipe.ingredients.filter((ing) => {
    const stock = inventory.find((it) => sameItemName(it.name, ing.name));
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
          const stock = inventory.find((it) => sameItemName(it.name, ing.name));
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
        onClick={() => onCheckIngredients(recipe)}
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
        Check ingredients against inventory
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

      {onDelete && (
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
      )}

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
export function RecipeAnalyticsView({ recipes, batches, salesOrders, onOpenBatch, isOwner }) {
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
        {(() => {
          const forecast = recipeDemandForecast(recipes, batches, salesOrders || []);
          const flagged = forecast.filter((f) => f.needsAttention);
          if (flagged.length === 0) return null;
          return (
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 4 }}>
                Running low, nothing brewing
              </div>
              <div style={{ color: "#9BA88A", fontSize: 11.5, marginBottom: 10 }}>
                Based on recent sales pace, these will likely run out before a fresh batch could be brewed and ready.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {flagged.map((f) => (
                  <div key={f.recipe.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6 }}>
                    <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>{f.recipe.name}</span>
                    <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                      ~{Math.max(0, Math.round(f.daysOfStockRemaining))} days of stock left
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

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
    .filter((b) => b.recipeId && familyRecipeIds.has(b.recipeId) && b.og != null)
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
              {isOwner && metricRow("Ingredient cost", (r) => r.batch.ingredientCost, (v) => `$${v.toFixed(2)}`)}
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
                      {isOwner && batch.ingredientCost > 0 && <span>${batch.ingredientCost.toFixed(0)}</span>}
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
