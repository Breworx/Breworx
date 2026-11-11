import React, { useState, useEffect, useRef } from "react";
import { Plus, X, Package, AlertTriangle, Trash2, Box } from "lucide-react";
import { cleanProductName } from "../lib/brewPlanner";
import { TrendChart } from "./quality";
import { BackdateField, ConfirmDialogModal, Modal, NumberField, SelectField, StageDateModal, TextField, stampForDate } from "./ui";
import { buildScheduleLabel, formatHistoryStamp } from "../lib/brewing";
import { latestReading } from "../lib/config";
import { PRODUCT_TYPES } from "../lib/excise";
import { CANS_PER_CASE, COMMON_FAULTS, CONTAINERS, FAULT_SEVERITY_COLOR, activeRecipesByFamily, currentFaults, currentFaultsList, occupyingBatch, remainingVolume, sameItemName, sortedTanks, tankIsOccupied, uid } from "../lib/production";
import { today } from "../lib/utils";

// A single-field rename, reusable anywhere an item's name was locked in
// at creation and never editable again — a typo shouldn't be permanent.
// For stock that came in outside the normal PO flow — a lot number
// entered directly against the item, so it still shows up in
// traceability without needing a paper trail through Purchase Orders.
// For breweries that fill one big tank across multiple brew days and
// blend as they go — stays one batch, one final beer, just built up in
// more than one pass. Adds to the batch's running volume and ingredient
// list rather than creating a second batch record.
export function AddBrewDayModal({ onClose, onSave, mergeableBatches, onMerge, targetBatch, onStartNewToMerge }) {
  const [date, setDate] = useState(today());
  const [volume, setVolume] = useState("");
  const [og, setOg] = useState("");
  const [lines, setLines] = useState([{ id: uid(), name: "", qty: "", unit: "kg" }]);

  const addLine = () => setLines((prev) => [...prev, { id: uid(), name: "", qty: "", unit: "kg" }]);
  const updateLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const submit = () => {
    const cleanLines = lines.filter((l) => l.name.trim() && Number(l.qty) > 0);
    if (!volume || Number(volume) <= 0) return;
    onSave({
      date,
      volume: Number(volume),
      og: og === "" ? null : Number(og),
      ingredients: cleanLines.map((l) => ({ name: l.name.trim(), qty: Number(l.qty), unit: l.unit, category: "Grain" })),
    });
    onClose();
  };

  return (
    <Modal title="Add another brew day" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          For blending multiple brew days into the same tank — this adds to the batch's total volume and ingredients, it doesn't create a separate batch.
        </div>
        {(mergeableBatches?.length > 0 || onStartNewToMerge) && (
          <div>
            {mergeableBatches && mergeableBatches.length > 0 && (
              <>
                <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>
                  Already tracking this as its own batch? Pull its numbers straight in instead of retyping them:
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: onStartNewToMerge ? 6 : 0 }}>
                  {mergeableBatches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        onMerge(b.id);
                        onClose();
                      }}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        background: "#EAF2E4",
                        border: "1px solid #8FB86C",
                        borderRadius: 6,
                        padding: "10px 12px",
                        color: "#3F6B32",
                        fontFamily: "'Inter', sans-serif",
                        fontSize: 13,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span>{b.name} <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }}>#{b.number}</span></span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>{b.volume}L</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {onStartNewToMerge && (
              <button
                onClick={() => {
                  onStartNewToMerge();
                  onClose();
                }}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "none",
                  border: "1px dashed #8FB86C",
                  borderRadius: 6,
                  padding: "10px 12px",
                  color: "#3F6B32",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                + Not brewed yet — start a new batch to merge in later
              </button>
            )}
            <div style={{ color: "#9BA88A", fontSize: 11.5, margin: "10px 0", textAlign: "center" }}>— or enter it manually below —</div>
          </div>
        )}
        <TextField label="Brew day date" type="date" value={date} onChange={setDate} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <NumberField label="Volume added" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          </div>
          <div style={{ flex: 1 }}>
            <NumberField label="OG (optional)" value={og} onChange={setOg} step="0.001" />
          </div>
        </div>
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Ingredients used this brew day</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {lines.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={l.name}
                  onChange={(e) => updateLine(l.id, { name: e.target.value })}
                  placeholder="Ingredient"
                  style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                />
                <input
                  type="number"
                  step="0.01"
                  value={l.qty}
                  onChange={(e) => updateLine(l.id, { qty: e.target.value })}
                  placeholder="Qty"
                  style={{ width: 70, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "center" }}
                />
                <select
                  value={l.unit}
                  onChange={(e) => updateLine(l.id, { unit: e.target.value })}
                  style={{ width: 64, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 4px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12 }}
                >
                  {["kg", "g", "L", "mL", "ea"].map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <button onClick={() => removeLine(l.id)} aria-label="Remove" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addLine}
            style={{ marginTop: 8, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", width: "100%", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
          >
            + Add ingredient
          </button>
        </div>
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save brew day
        </button>
      </div>
    </Modal>
  );
}

// A searchable recipe picker — type to filter, tap to select. Used
// anywhere a plain dropdown of recipes would otherwise force scrolling
// through the full list to find one.
export function RecipeSearchField({ recipes, value, onSelect, label = "Recipe (optional)" }) {
  const current = recipes.find((r) => r.id === value);
  const [query, setQuery] = useState(current ? `${current.name} (${current.style})` : "");
  const [focused, setFocused] = useState(false);
  const matches = query.trim().length === 0 ? recipes : recipes.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, position: "relative" }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onSelect("");
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search recipes…"
          style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", paddingRight: value ? 32 : 10, color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
        />
        {value && (
          <button
            onMouseDown={() => {
              onSelect("");
              setQuery("");
            }}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
            aria-label="Clear recipe"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {focused && matches.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 220, overflowY: "auto" }}>
          {matches.map((r) => (
            <button
              key={r.id}
              onMouseDown={() => {
                onSelect(r.id);
                setQuery(`${r.name} (${r.style})`);
                setFocused(false);
              }}
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "8px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
            >
              {r.name} <span style={{ color: "#9BA88A" }}>({r.style})</span>
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

export function AddSplitTankIngredientModal({ tankName, inventory, onClose, onSave }) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());

  const matches = inventory.filter((it) => it.name.toLowerCase().includes(query.trim().toLowerCase()));

  const pick = (it) => {
    setName(it.name);
    setQuery(it.name);
    setUnit(it.unit);
    setFocused(false);
  };

  const submit = () => {
    if (!name.trim() || !qty || Number(qty) <= 0) return;
    onSave({ name: name.trim(), qty: Number(qty), unit, note: note.trim(), date });
    onClose();
  };

  return (
    <Modal title={`Add ingredient — ${tankName}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ position: "relative" }}>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Ingredient (e.g. Citra hops, raspberry puree)</div>
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setName(e.target.value);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
          {focused && matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 180, overflowY: "auto" }}>
              {matches.map((it) => (
                <button
                  key={it.id}
                  onMouseDown={() => pick(it)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "8px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                >
                  {it.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <NumberField label="Quantity" value={qty} onChange={setQty} step="0.01" />
          </div>
          <div style={{ width: 90 }}>
            <SelectField label="Unit" value={unit} onChange={setUnit} options={["kg", "g", "L", "mL", "ea"]} />
          </div>
        </div>
        <BackdateField value={date} onChange={setDate} label="Date added" />
        <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. Dry hop, day 5" />
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Add
        </button>
      </div>
    </Modal>
  );
}

export function AddBatchModal({ onClose, onAdd, nextNumber: beerNextNumber, nextCiderNumber, recipes, presetRecipe, tanks, batches, inventory, onAddInventoryItem, presetTankId, presetStartDate, presetName, yeastHarvests, onUseHarvest, presetProductType }) {
  const startType = presetRecipe ? presetRecipe.productType || "Beer" : presetProductType || "Beer";
  const numberFor = (type) => (type === "Cider/Perry" && nextCiderNumber ? nextCiderNumber : beerNextNumber);
  const [numberType, setNumberType] = useState(startType);
  const nextNumber = numberFor(numberType);
  const mashTuns = tanks.filter((t) => t.type === "Mash Tun");
  const tankChoices = mashTuns.length > 0 ? mashTuns : tanks;
  const [recipeId, setRecipeId] = useState(presetRecipe ? presetRecipe.id : "");
  const [name, setName] = useState(presetName || (presetRecipe ? presetRecipe.name : ""));
  const [style, setStyle] = useState(presetRecipe ? presetRecipe.style : "");
  const [productType, setProductType] = useState(presetRecipe ? presetRecipe.productType || "Beer" : presetProductType || "Beer");
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
  // Cider gets the next F number, everything else the next beer number —
  // switch it when the product type changes, unless it was typed by hand.
  useEffect(() => {
    if (productType === numberType) return;
    const oldAuto = numberFor(numberType);
    const newAuto = numberFor(productType);
    setBatchNumber((cur) => (cur === oldAuto ? newAuto : cur));
    setNumberType(productType);
  }, [productType]);
  const [plannedDays, setPlannedDays] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splitRows, setSplitRows] = useState([{ id: uid(), tankId: "", volume: "" }]);
  const [nameFocused, setNameFocused] = useState(false);
  const [batchIngredients, setBatchIngredients] = useState(
    presetRecipe ? presetRecipe.ingredients.map((i) => ({ ...i })) : []
  );
  const [selectedHarvestId, setSelectedHarvestId] = useState("");
  const [batchSchedule, setBatchSchedule] = useState(
    presetRecipe ? (presetRecipe.schedule || []).map((s) => ({ ...s, done: false, doneAt: null })) : []
  );

  const activeRecipe = recipes.find((r) => r.id === recipeId) || null;

  // How far the ingredients and hop schedule have been scaled from the
  // recipe's own amounts. Scaling multiplies what's in the form now, so
  // any edits or extra rows are kept and scaled along with everything else.
  const [scaleFactor, setScaleFactor] = useState(1);
  const recipeVolume = activeRecipe ? Number(activeRecipe.volume) || 0 : 0;
  const scaleTo = (targetVolume) => {
    const target = Number(targetVolume);
    if (!recipeVolume || !(target > 0)) return;
    const next = target / recipeVolume;
    const step = next / scaleFactor;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    setBatchIngredients((prev) => prev.map((ing) => ({ ...ing, qty: r3((Number(ing.qty) || 0) * step) })));
    setBatchSchedule((prev) => prev.map((s) => (s.amount == null || s.amount === "" ? s : { ...s, amount: r3((Number(s.amount) || 0) * step) })));
    setScaleFactor(next);
    setVolume(target);
  };

  const applyRecipe = (id) => {
    setRecipeId(id);
    const r = recipes.find((rec) => rec.id === id);
    if (r) {
      setName(r.name);
      setStyle(r.style);
      setProductType(r.productType || "Beer");
      setVolume(r.volume);
      setOg(r.og);
      setFg(r.fg);
      setBatchIngredients(r.ingredients.map((i) => ({ ...i })));
      setBatchSchedule((r.schedule || []).map((s) => ({ ...s, done: false, doneAt: null })));
      setScaleFactor(1);
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
    const item = inventory.find((it) => sameItemName(it.name, ingName));
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
    const newBatchId = uid();
    await onAdd({
      id: newBatchId,
      number: batchNumber.trim() || nextNumber,
      name: name.trim(),
      style: style.trim() || "Unspecified",
      productType,
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
      pitchedYeastHarvestId: selectedHarvestId || null,
    });
    if (selectedHarvestId) await onUseHarvest(selectedHarvestId, newBatchId);
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
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Product type</span>
          <select
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          >
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Volume" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          <NumberField label="Pitch temp" value={temp} onChange={setTemp} step="0.5" suffix="°C" />
          <NumberField label="Original gravity" value={og} onChange={setOg} step="0.001" />
          <NumberField label="Target FG" value={fg} onChange={setFg} step="0.001" />
        </div>
        {activeRecipe && recipeVolume > 0 && (() => {
          const vol = Number(volume) || 0;
          const scaledVol = Math.round(recipeVolume * scaleFactor * 1000) / 1000;
          const inStep = Math.abs(vol - scaledVol) < 0.001;
          const factorText = (f) => `×${Math.round(f * 100) / 100}`;
          const chip = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 999, padding: "6px 12px", fontSize: 12.5, color: "#2A3324", cursor: "pointer", fontFamily: "'Inter', sans-serif" };
          return (
            <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6 }}>Scale batch</div>
              <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.45, marginBottom: 8 }}>
                {inStep
                  ? scaleFactor === 1
                    ? `Recipe amounts, for ${recipeVolume}L. Change the volume above or pick a size to scale ingredients and hop additions.`
                    : `Ingredients and hop additions scaled to ${scaledVol}L (${factorText(scaleFactor)} the recipe's ${recipeVolume}L).`
                  : `Volume is ${vol}L but ingredients are still for ${scaledVol}L.`}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {!inStep && vol > 0 && (
                  <button type="button" onClick={() => scaleTo(vol)} style={{ ...chip, background: "#5C9A3C", border: "1px solid #5C9A3C", color: "#16191A", fontWeight: 500 }}>
                    Scale to {vol}L ({factorText(vol / recipeVolume)})
                  </button>
                )}
                {[0.5, 2].map((f) => (
                  <button key={f} type="button" onClick={() => scaleTo(recipeVolume * f)} style={chip}>
                    {factorText(f)} · {Math.round(recipeVolume * f * 10) / 10}L
                  </button>
                ))}
                {scaleFactor !== 1 && (
                  <button type="button" onClick={() => scaleTo(recipeVolume)} style={chip}>
                    Back to recipe ({recipeVolume}L)
                  </button>
                )}
              </div>
            </div>
          );
        })()}
        {(yeastHarvests || []).filter((h) => !h.used).length > 0 && (
          <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              Pitching yeast — reuse a harvest instead of fresh, if you'd like
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button
                onClick={() => setSelectedHarvestId("")}
                style={{
                  background: !selectedHarvestId ? "#5C9A3C" : "#FFFFFF",
                  border: `1px solid ${!selectedHarvestId ? "#5C9A3C" : "#DDE0C8"}`,
                  borderRadius: 20,
                  padding: "6px 12px",
                  color: !selectedHarvestId ? "#16191A" : "#5C6B54",
                  fontSize: 12,
                  fontFamily: "'Inter', sans-serif",
                  cursor: "pointer",
                }}
              >
                Fresh yeast
              </button>
              {yeastHarvests
                .filter((h) => !h.used)
                .sort((a, b) => b.generation - a.generation)
                .map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setSelectedHarvestId(h.id);
                      setBatchIngredients((prev) => {
                        const hasYeastLine = prev.some((ing) => ing.category === "Yeast");
                        return hasYeastLine
                          ? prev.map((ing) => (ing.category === "Yeast" ? { ...ing, name: h.strainName } : ing))
                          : [...prev, { id: uid(), name: h.strainName, category: "Yeast", qty: 1, unit: "ea" }];
                      });
                    }}
                    style={{
                      background: selectedHarvestId === h.id ? "#8E6FB5" : "#FFFFFF",
                      border: `1px solid ${selectedHarvestId === h.id ? "#8E6FB5" : "#DDE0C8"}`,
                      borderRadius: 20,
                      padding: "6px 12px",
                      color: selectedHarvestId === h.id ? "#FFFFFF" : "#5C6B54",
                      fontSize: 12,
                      fontFamily: "'Inter', sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    {h.strainName} — Gen {h.generation} ({h.amount}{h.unit})
                  </button>
                ))}
            </div>
          </div>
        )}
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
                            !inventory.some((it) => sameItemName(it.name, ing.name)) && (
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
                  {(() => {
                    const matchedItem = inventory.find((it) => sameItemName(it.name, ing.name));
                    const availableLots = matchedItem ? (matchedItem.lots || []).filter((l) => (l.remainingQty ?? l.qty) > 0) : [];
                    if (availableLots.length <= 1) return null;
                    return (
                      <select
                        value={ing.preferredLotId || ""}
                        onChange={(e) => updateBatchIngredient(ing.id, { preferredLotId: e.target.value || null })}
                        style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "6px 8px", marginTop: 6, color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 11.5 }}
                      >
                        <option value="">Use oldest lot first (default)</option>
                        {availableLots.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.lotNumber} — {l.remainingQty ?? l.qty} {ing.unit} left
                          </option>
                        ))}
                      </select>
                    );
                  })()}
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

export function DiacetylTestModal({ batch, onClose, onLog }) {
  const [result, setResult] = useState(null);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today());

  const submit = () => {
    if (!result) return;
    onLog(batch.id, { id: uid(), date: stampForDate(date), result, notes: notes.trim() });
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
        <BackdateField value={date} onChange={setDate} label="Test date" />
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

// One tank side's own gravity/temp history — split batches genuinely
// diverge between tanks even though they started from the same wort,
// so each side gets its own independent chart and log, not a single
// shared one that would silently mix two different fermentations.
// Same "quality checklist" pattern as the shared one below, scoped to
// one tank side's own faults — one side developing diacetyl doesn't
// mean the other has, even from the same wort.
export function SplitTankFaultsSection({ tank, batch, onToggleFault }) {
  const faults = tank.faults || [];
  const active = currentFaultsList(faults);
  const history = [...faults].sort((a, b) => (a.date < b.date ? 1 : -1));
  const hasHistory = new Set(history.map((f) => f.fault)).size < history.length;

  return (
    <div style={{ border: "1px solid #EBE8D6", borderRadius: 5, padding: "12px 14px", background: "#F8F5EA", marginBottom: 12 }}>
      <div style={{ color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif", fontWeight: 600, marginBottom: 10 }}>{tank.tankName} ({tank.volume}L)</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {COMMON_FAULTS.map((fault) => {
          const existing = active.find((f) => f.fault === fault);
          const severity = existing ? existing.severity : null;
          const isToday = existing && existing.date === today();
          const color = severity ? FAULT_SEVERITY_COLOR[severity] : "#9BA88A";
          return (
            <button
              key={fault}
              onClick={() => onToggleFault(batch.id, fault, tank.tankId)}
              title={existing && !isToday ? `Last noted ${formatHistoryStamp(existing.date)} — tap to reassess today` : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: severity ? `${color}22` : "#FFFFFF",
                border: `1px solid ${severity ? color : "#DDE0C8"}`,
                borderRadius: 20,
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: 11.5,
                color: severity ? color : "#5C6B54",
                fontFamily: "'Inter', sans-serif",
              }}
            >
              {fault}
              {severity && (
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em" }}>
                  {severity.toUpperCase()}
                  {!isToday ? "*" : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hasHistory && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 11.5, fontFamily: "'Inter', sans-serif" }}>View full fault history</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {history.map((f) => (
              <div key={f.id || `${f.fault}-${f.date}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "4px 8px", background: "#FFFFFF", border: "1px solid #EBE8D6", borderRadius: 4 }}>
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
}

// Same idea as the faults section above — one tank's own note log,
// since an observation about one side of a split isn't necessarily
// true of the other.
export function SplitTankNotesSection({ tank, batch, onAddNote, onDeleteNote }) {
  const [text, setText] = useState("");
  const [noteDate, setNoteDate] = useState(today());
  const notes = tank.notes || [];

  const submit = () => {
    if (!text.trim()) return;
    onAddNote(batch.id, text.trim(), tank.tankId, noteDate);
    setText("");
    setNoteDate(today());
  };

  return (
    <div style={{ border: "1px solid #EBE8D6", borderRadius: 5, padding: "12px 14px", background: "#F8F5EA", marginBottom: 12 }}>
      <div style={{ color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif", fontWeight: 600, marginBottom: 10 }}>{tank.tankName} ({tank.volume}L)</div>
      <div style={{ display: "flex", gap: 8, marginBottom: notes.length > 0 ? 10 : 0 }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note…"
          style={{ flex: 1, boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
        />
        <button onClick={submit} style={{ background: "#5C9A3C", border: "none", borderRadius: 4, padding: "8px 14px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}>
          Add
        </button>
      </div>
      {(text.trim() || noteDate < today()) && <div style={{ marginBottom: 10 }}><BackdateField value={noteDate} onChange={setNoteDate} label="Note date" /></div>}
      {notes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {[...notes].reverse().map((n) => (
            <div key={n.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 10px", background: "#FFFFFF", border: "1px solid #EBE8D6", borderRadius: 4, fontSize: 12.5 }}>
              <span style={{ color: "#2A3324", flex: 1 }}>{n.text}</span>
              <span style={{ color: "#9BA88A", fontSize: 11, flexShrink: 0 }}>{formatHistoryStamp(n.date)}</span>
              <button onClick={() => onDeleteNote(batch.id, n.id, tank.tankId)} aria-label="Delete note" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SplitTankReadingsSection({ tank, batch, onLogReading, onDeleteReading }) {
  const readings = tank.readings || [];
  const chartData = readings.map((r) => ({ date: r.date.slice(5), gravity: r.gravity, temp: r.temp }));

  return (
    <div style={{ border: "1px solid #EBE8D6", borderRadius: 5, padding: "12px 14px", background: "#F8F5EA", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>{tank.tankName} ({tank.volume}L)</span>
        <button
          onClick={() => onLogReading(batch, tank.tankId, tank.tankName)}
          style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
        >
          + Log reading
        </button>
      </div>

      {chartData.length > 1 && (
        <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 10px 8px", marginBottom: 10 }}>
          <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8, marginLeft: 6 }}>Gravity trend</div>
          <TrendChart points={chartData} valueKey="gravity" color="#5C9A3C" formatValue={(v) => v.toFixed(3)} />
        </div>
      )}

      {readings.length === 0 ? (
        <div style={{ color: "#9BA88A", fontSize: 12.5 }}>No readings yet for this tank.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {[...readings].reverse().map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 10px", background: "#FFFFFF", border: "1px solid #EBE8D6", borderRadius: 4, fontSize: 12 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", width: 52, flexShrink: 0 }}>{r.date.slice(5)}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324", width: 52, flexShrink: 0 }}>{r.gravity.toFixed(3)}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", width: 38, flexShrink: 0 }}>{r.temp}°C</span>
              {r.ph != null && <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", flexShrink: 0 }}>pH {r.ph.toFixed(2)}</span>}
              {r.note && <span style={{ flex: 1, color: "#5C6B54", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>}
              <button
                onClick={() => onDeleteReading(batch.id, r.id, tank.tankId)}
                aria-label="Delete reading"
                style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4, marginLeft: "auto", flexShrink: 0 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LogReadingModal({ batch, tankId, tankName, onClose, onLog }) {
  const [gravity, setGravity] = useState(latestReading(batch, tankId).gravity);
  const [temp, setTemp] = useState(latestReading(batch, tankId).temp);
  const [ph, setPh] = useState(latestReading(batch, tankId).ph ?? "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());

  const submit = () => {
    onLog(batch.id, { id: uid(), date, gravity: Number(gravity), temp: Number(temp), ph: ph === "" ? null : Number(ph), note: note.trim() }, tankId);
    onClose();
  };

  return (
    <Modal title={tankId ? `Log reading — ${batch.name} (${tankName})` : `Log reading — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Gravity" value={gravity} onChange={setGravity} step="0.001" />
          <NumberField label="Temp" value={temp} onChange={setTemp} step="0.5" suffix="°C" />
          <NumberField label="pH (optional)" value={ph} onChange={setPh} step="0.01" />
        </div>
        <BackdateField value={date} onChange={setDate} label="Reading date" />
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

export function EditBrewDayFieldModal({ target, onClose, onSave }) {
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

export function StartPackagingModal({ batch, onClose, onSave }) {
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

// The other tanks the same brew went into — a split brew is separate
// batches, linked by splitGroupId (or, for older splits, the same name and
// brew day) — that still have beer in them.
export function sisterTankBatches(batch, batches) {
  if (!batch) return [];
  return batches.filter((b) => {
    if (b.id === batch.id || b.mergedIntoBatchId || remainingVolume(b) <= 0) return false;
    if (batch.splitGroupId && b.splitGroupId === batch.splitGroupId) return true;
    return !!batch.startDate && b.startDate === batch.startDate && cleanProductName(b.name).toLowerCase() === cleanProductName(batch.name).toLowerCase();
  });
}

// One packaging run that empties the first tank and carries on from the
// second: whole containers go to the first tank while it still has (about)
// a container's worth left, the rest to the second. The container filled
// from both tanks is counted on the second; whatever was left of the first
// tank went into it, so the first is closed off with no excise lost overall.
export function splitPackagingRun(counts, firstRemainingL) {
  const first = {};
  const second = {};
  let left = firstRemainingL;
  [...CONTAINERS].sort((a, b) => b.volumeL - a.volumeL).forEach((c) => {
    const n = Number(counts[c.key]) || 0;
    const toFirst = Math.max(0, Math.min(n, Math.floor((left + c.volumeL / 2) / c.volumeL)));
    first[c.key] = toFirst;
    second[c.key] = n - toFirst;
    left -= toFirst * c.volumeL;
  });
  return { first, second, firstLeftL: Math.max(0, Math.round(left * 100) / 100) };
}

export function PackagingModal({ batch, onClose, onSave, packageTypes, onToggleFault, sisters = [] }) {
  const [carryOnId, setCarryOnId] = useState("");
  const containerFilter = batch.packagingRun?.containerType || null;
  const relevantContainers = containerFilter ? CONTAINERS.filter((c) => c.key.startsWith(containerFilter === "cans" ? "cans" : "kegs")) : CONTAINERS;
  const [counts, setCounts] = useState(() => {
    const init = {};
    CONTAINERS.forEach((c) => (init[c.key] = 0));
    return init;
  });
  // Cans go in as full cases of 24 plus any loose cans; saved as a can count.
  const [canCases, setCanCases] = useState(0);
  const [looseCans, setLooseCans] = useState(0);
  const caseCans = (Number(canCases) || 0) * CANS_PER_CASE;
  const totalCans = caseCans + (Number(looseCans) || 0);
  const effective = { ...counts, cans330: totalCans };
  // Cans deduct cans and lids automatically when there's a can package type;
  // it can still be changed or set to none.
  const [packageTypeSelections, setPackageTypeSelections] = useState(() => {
    const can = (packageTypes || []).filter((pt) => /\bcans?\b/i.test(pt.name));
    return can.length === 1 ? { cans330: can[0].id } : {};
  });
  const [date, setDate] = useState(today());
  const activeFaults = currentFaults(batch);

  const sister = sisters.find((b) => b.id === carryOnId) || null;
  const ownRemaining = remainingVolume(batch);
  const remaining = sister ? Math.round((ownRemaining + remainingVolume(sister)) * 100) / 100 : ownRemaining;
  const sessionVolume = CONTAINERS.reduce((sum, c) => sum + (Number(effective[c.key]) || 0) * c.volumeL, 0);
  const diff = Math.round((sessionVolume - remaining) * 100) / 100;
  const leftAfter = Math.max(0, Math.round((remaining - sessionVolume) * 100) / 100);
  const preview = sister ? splitPackagingRun(effective, ownRemaining) : null;
  const describe = (c) => CONTAINERS.filter((x) => c[x.key] > 0).map((x) => `${c[x.key]} × ${x.shortLabel}`).join(", ") || "nothing";

  const submit = () => {
    const session = {};
    CONTAINERS.forEach((c) => (session[c.key] = Number(effective[c.key]) || 0));
    onSave(batch.id, session, packageTypeSelections, date, sister ? { sisterId: sister.id } : null);
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
          Remaining in tank: <span style={{ color: "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>{ownRemaining} L</span>
          {" "}of {batch.volume} L batch
        </div>
        {sisters.length > 0 && (
          <div style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#2A3324", cursor: "pointer" }}>
              <input type="checkbox" checked={!!sister} onChange={(e) => setCarryOnId(e.target.checked ? sisters[0].id : "")} style={{ width: 18, height: 18, accentColor: "#5C9A3C", flexShrink: 0 }} />
              Carry on from the other tank of this brew when this one runs out
            </label>
            {sister && sisters.length > 1 && (
              <select value={carryOnId} onChange={(e) => setCarryOnId(e.target.value)} style={{ width: "100%", marginTop: 8, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 9px", fontSize: 13, color: "#2A3324" }}>
                {sisters.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.tankName || "tank"} ({remainingVolume(b)} L)</option>)}
              </select>
            )}
            {sister && (
              <div style={{ fontSize: 12, color: "#5C6B54", marginTop: 6, lineHeight: 1.5 }}>
                Enter everything this run filled. {batch.tankName || "This tank"} ({ownRemaining} L) is emptied first, then {sister.name}{sister.tankName ? ` in ${sister.tankName}` : ""} ({remainingVolume(sister)} L).
              </div>
            )}
          </div>
        )}
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>
          This packaging run
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {relevantContainers.map((c) =>
            c.key === "cans330" ? (
              <React.Fragment key={c.key}>
                <NumberField label={`Cases (${CANS_PER_CASE} × 330ml)`} value={canCases} onChange={setCanCases} step="1" />
                <NumberField label="Loose cans (330ml)" value={looseCans} onChange={setLooseCans} step="1" />
              </React.Fragment>
            ) : (
              <NumberField
                key={c.key}
                label={c.label}
                value={counts[c.key]}
                onChange={(v) => setCounts((prev) => ({ ...prev, [c.key]: v }))}
                step="1"
              />
            )
          )}
        </div>
        {totalCans > 0 && (
          <div style={{ color: "#5C6B54", fontSize: 12.5, marginTop: -6 }}>
            = <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324" }}>{totalCans}</span> cans
            {Number(canCases) > 0 && Number(looseCans) > 0 ? ` (${caseCans} in cases + ${Number(looseCans)} loose)` : ""}
          </div>
        )}

        {packageTypes.length > 0 &&
          relevantContainers.filter((c) => Number(effective[c.key]) > 0).map((c) => (
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
        {preview && sessionVolume > 0 && (
          <div style={{ fontSize: 12.5, color: "#2A3324", background: "#EBF3E4", border: "1px solid #9BC48A", borderRadius: 6, padding: "9px 11px", lineHeight: 1.55 }}>
            <div><strong>{batch.name}</strong>: {describe(preview.first)} — tank emptied{preview.firstLeftL > 0 ? ` (last ${preview.firstLeftL} L went into the shared container)` : ""}</div>
            <div><strong>{sister.name}</strong>: {describe(preview.second)}</div>
          </div>
        )}
        <BackdateField value={date} onChange={setDate} label="Packaging date" />
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

export function DiscardRemainingModal({ batch, onClose, onConfirm }) {
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

// Simple, ephemeral countdown timers for brew day — mash rest, boil,
// whirlpool/recirculation. Nothing here is saved; it's meant to be watched
// live while standing at the kettle, not referenced later.
export const BREW_TIMER_PRESETS = [
  { label: "Mash", minutes: 60 },
  { label: "Boil", minutes: 60 },
  { label: "Whirlpool / recirc", minutes: 15 },
];

export function BrewDayTimers({ timers, onStart, onStop }) {
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

// PSI <-> Bar, for showing a quick equivalent alongside whichever unit was
// actually set — doesn't force everything into one unit, just makes the
// other one visible at a glance.
export const psiToBar = (psi) => psi / 14.5038;
export const barToPsi = (bar) => bar * 14.5038;

// Ticking logs who did it and when; unticking undoes just that — the most
// recent tick, not the whole history. That's what makes it safe to redo:
// a genuine second hop dump later the same day is just another tick, and
// past entries stay put in the log regardless of today's checkbox state.
export function DumpLogCheckbox({ label, log, onLog, onUndo }) {
  const [pulsing, setPulsing] = useState(false);
  const [pickDate, setPickDate] = useState(false);
  const latest = log && log.length > 0 ? log[log.length - 1] : null;
  const latestIsToday = latest && (latest.at || "").slice(0, 10) === today();

  const handleTick = () => {
    onLog();
    setPulsing(true);
    setTimeout(() => setPulsing(false), 500);
  };

  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", color: "#5C6B54", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
        <input
          type="checkbox"
          checked={pulsing}
          onChange={(e) => e.target.checked && handleTick()}
          style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
        />
        {label}
        {latest && (
          <span style={{ color: "#9BA88A", fontSize: 11.5 }}>
            — {formatHistoryStamp(latest.at)} by {latest.user}
          </span>
        )}
        {latestIsToday && !pulsing && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onUndo();
            }}
            style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif", padding: 0 }}
          >
            Undo
          </button>
        )}
        <button
          onClick={(e) => { e.preventDefault(); setPickDate(true); }}
          style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 11, textDecoration: "underline", fontFamily: "'Inter', sans-serif", padding: 0 }}
        >
          Other date
        </button>
      </label>
      {pickDate && <StageDateModal title={`${label} — which day?`} confirmLabel="Log it" onClose={() => setPickDate(false)} onConfirm={(d) => onLog(d)} />}
      {log && log.length > 0 && (
        <details style={{ marginTop: 4, marginLeft: 23 }}>
          <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 11, fontFamily: "'Inter', sans-serif" }}>
            History ({log.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
            {[...log].reverse().map((e) => (
              <div key={e.id} style={{ fontSize: 11.5, color: "#5C6B54" }}>
                {formatHistoryStamp(e.at)} — {e.user}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
