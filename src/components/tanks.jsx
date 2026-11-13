import { useState } from "react";
import { Plus, Droplet, Package, Trash2 } from "lucide-react";
import { StagePill } from "./cards";
import { BackdateField, Modal, NumberField, SelectField, TextField } from "./ui";
import { formatHistoryStamp } from "../lib/brewing";
import { latestReading } from "../lib/config";
import { CLEAN_STAGE_COLOR, STAGE_COLOR, batchTankIds, occupyingBatch, remainingVolume, sortedTanks, tankIsOccupied, uid } from "../lib/production";
import { daysBetween, today } from "../lib/utils";

export function AddTankModal({ onClose, onAdd, barrelAgingEnabled = true }) {
  const [countInput, setCountInput] = useState("1");
  const [rows, setRows] = useState([{ id: uid(), name: "Tank 1", capacity: 20, type: "Fermenter" }]);
  const [saving, setSaving] = useState(false);
  const tankTypeOptions = barrelAgingEnabled
    ? ["Mash Tun", "Kettle", "Fermenter", "Brite Tank", "Barrel", "Aging Tank"]
    : ["Mash Tun", "Kettle", "Fermenter", "Brite Tank"];

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
    await Promise.all(clean.map((r) => onAdd({ id: uid(), name: r.name.trim(), capacity: Number(r.capacity) || 0, type: r.type || "Fermenter", barrelSource: r.type === "Barrel" ? r.barrelSource || "Bourbon/Whiskey" : null })));
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
                options={tankTypeOptions}
              />
              {row.type === "Barrel" && (
                <SelectField
                  label="What did it hold before?"
                  value={row.barrelSource || "Bourbon/Whiskey"}
                  onChange={(v) => updateRow(row.id, { barrelSource: v })}
                  options={["Bourbon/Whiskey", "Red Wine", "White Wine", "Sherry", "Rum", "Virgin Oak", "Other"]}
                />
              )}
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

export function EditTankModal({ tank, onClose, onSave, barrelAgingEnabled = true }) {
  const [name, setName] = useState(tank.name);
  const [capacity, setCapacity] = useState(tank.capacity);
  const [type, setType] = useState(tank.type || "Fermenter");
  const [barrelSource, setBarrelSource] = useState(tank.barrelSource || "Bourbon/Whiskey");
  // Keep the option visible if this tank already is one, even if the
  // module's since been switched off — don't strand an existing barrel.
  const showBarrelTypes = barrelAgingEnabled || tank.type === "Barrel" || tank.type === "Aging Tank";
  const tankTypeOptions = showBarrelTypes
    ? ["Mash Tun", "Kettle", "Fermenter", "Brite Tank", "Barrel", "Aging Tank"]
    : ["Mash Tun", "Kettle", "Fermenter", "Brite Tank"];

  const submit = () => {
    if (!name.trim()) return;
    onSave(tank.id, { name: name.trim(), capacity: Number(capacity) || 0, type, barrelSource: type === "Barrel" ? barrelSource : null });
    onClose();
  };

  return (
    <Modal title="Edit tank" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Tank ID" value={name} onChange={setName} />
        <NumberField label="Capacity" value={capacity} onChange={setCapacity} step="1" suffix="L" />
        <SelectField label="Type" value={type} onChange={setType} options={tankTypeOptions} />
        {type === "Barrel" && (
          <SelectField
            label="What did it hold before?"
            value={barrelSource}
            onChange={setBarrelSource}
            options={["Bourbon/Whiskey", "Red Wine", "White Wine", "Sherry", "Rum", "Virgin Oak", "Other"]}
          />
        )}
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

export function ConfirmDeleteBatchModal({ batch, onClose, onConfirm }) {
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

export function ConfirmDeleteRecipeModal({ recipe, onClose, onConfirm }) {
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

export function ConfirmDeleteSupplierModal({ supplier, onClose, onConfirm }) {
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

export function ConfirmDeleteTankModal({ tank, onClose, onConfirm }) {
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

export function AssignTankModal({ batch, tanks, batches, onClose, onSave }) {
  const rack = batch._mode === "rack";
  const [tankId, setTankId] = useState(rack ? "" : batch.tankId || "");
  const [brewStage, setBrewStage] = useState(batch.brewStage || "");
  const selectedTank = tanks.find((t) => t.id === tankId) || null;

  // A full tank can still be picked: whatever's in it swaps into this
  // batch's current tank (or comes off a tank if this batch has none).
  // Only for cellar vessels — swapping something into a mash tun or kettle
  // makes no sense — and not for split batches, which have their own editor.
  const isCellar = (t) => t && t.type !== "Mash Tun" && t.type !== "Kettle";
  const currentTank = tanks.find((t) => t.id === batch.tankId) || null;
  const swapCandidate = (t) => {
    if (!t || t.id === batch.tankId || !tankIsOccupied(batches, t.id, batch.id)) return null;
    const occ = occupyingBatch(batches, t.id, batch.id);
    if (!occ || (occ.splitTanks && occ.splitTanks.length > 0)) return null;
    if (!isCellar(t) || (currentTank && !isCellar(currentTank))) return null;
    return occ;
  };
  const occupantHere = selectedTank && selectedTank.id !== batch.tankId && tankIsOccupied(batches, selectedTank.id, batch.id);
  const swapWith = swapCandidate(selectedTank);
  const blocked = occupantHere && !swapWith;
  const volumeOf = (b) => { const r = remainingVolume(b); return r > 0 ? r : Number(b.volume) || 0; };
  const overCap = [];
  if (selectedTank && volumeOf(batch) > Number(selectedTank.capacity || 0) && Number(selectedTank.capacity) > 0) overCap.push(`${batch.name} (${Math.round(volumeOf(batch))}L) is more than ${selectedTank.name} holds (${selectedTank.capacity}L)`);
  if (swapWith && currentTank && volumeOf(swapWith) > Number(currentTank.capacity || 0) && Number(currentTank.capacity) > 0) overCap.push(`${swapWith.name} (${Math.round(volumeOf(swapWith))}L) is more than ${currentTank.name} holds (${currentTank.capacity}L)`);

  const submit = () => {
    if (blocked || (rack && !selectedTank)) return;
    const finalBrewStage = selectedTank?.type === "Mash Tun" ? brewStage || "Mashing" : selectedTank?.type === "Kettle" ? "Kettle" : null;
    onSave(batch.id, selectedTank, finalBrewStage, swapWith ? { batchId: swapWith.id, tank: currentTank } : null);
    onClose();
  };

  return (
    <Modal title={`${rack ? "Rack to another tank" : "Assign tank"} — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rack && (
          <div style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.45 }}>
            Pick the secondary tank. {currentTank ? `${currentTank.name} is freed up for cleaning, ` : ""}the racking is logged on today's date (same as ticking "Racked off the lees").
          </div>
        )}
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
            <option value="">{rack ? "Choose a tank…" : "Unassigned"}</option>
            {sortedTanks(tanks).filter((t) => !rack || (t.id !== batch.tankId && t.type !== "Mash Tun" && t.type !== "Kettle")).map((t) => {
              const occupied = tankIsOccupied(batches, t.id, batch.id);
              const occupant = occupied ? occupyingBatch(batches, t.id, batch.id) : null;
              const canSwap = occupied && !!swapCandidate(t);
              return (
                <option key={t.id} value={t.id} disabled={occupied && !canSwap}>
                  {t.name} ({t.type}, {t.capacity}L){occupied ? ` — ${occupant?.name || "another batch"}${canSwap ? (currentTank ? " (swap)" : " (move it off)") : ""}` : ""}
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
        {swapWith && (
          <div style={{ background: "#F3EEDB", border: "1px solid #E3D9B5", borderRadius: 5, padding: "10px 12px", fontSize: 13, color: "#2A3324", lineHeight: 1.45 }}>
            {selectedTank.name} has <b>{swapWith.name}</b> in it.{" "}
            {currentTank
              ? <>Saving swaps them: {batch.name} goes into {selectedTank.name} and {swapWith.name} moves into {currentTank.name}.</>
              : <>Saving moves {batch.name} in and takes {swapWith.name} off the tank (it'll show as unassigned until you give it one).</>}
          </div>
        )}
        {blocked && <div style={{ color: "#B5523B", fontSize: 12 }}>{selectedTank.name} can't be swapped — move what's in it from its own batch page.</div>}
        {overCap.map((m) => <div key={m} style={{ color: "#B5523B", fontSize: 12 }}>Heads up: {m}.</div>)}
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
          {rack ? (swapWith ? "Rack & swap" : "Rack") : swapWith ? (currentTank ? "Swap tanks" : "Move in") : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// The split-batch equivalent of AssignTankModal — a batch spread across
// several tanks doesn't fit a single tankId, so it gets its own editor for
// changing which tanks (and volumes) it's actually sitting in.
export function EditSplitTanksModal({ batch, tanks, batches, onClose, onSave }) {
  const [rows, setRows] = useState(
    batch.tankId ? [{ id: uid(), tankId: batch.tankId, volume: batch.volume }] : [{ id: uid(), tankId: "", volume: batch.volume }]
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
    <Modal title={`Split into tanks — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5 }}>
          Add a second tank to split this batch — each one becomes its own fully independent batch from this point on, sharing today's brew-day history but nothing after.
        </div>
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
export function TransferToFermenterModal({ batch, tanks, batches, onClose, onSave }) {
  const fermenters = tanks.filter((t) => t.type === "Fermenter");
  const target = remainingVolume(batch);
  const [rows, setRows] = useState([{ id: uid(), tankId: "", volume: target }]);
  const [date, setDate] = useState(today());

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
    onSave(final, date);
    onClose();
  };

  return (
    <Modal title={`Transfer to fermenter — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 12px", lineHeight: 1.5 }}>
          Filling a tank that already has another batch in it, as a second brew day for the same beer? Don't transfer here — go to that batch instead and use "+ Add another brew day," which pulls this one's numbers in without needing the tank freed up first.
        </div>
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
        <BackdateField value={date} onChange={setDate} label="Transfer date" />
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
export function VesselTransferModal({ batch, tanks, batches, toType, actionLabel, onClose, onSave }) {
  const available = tanks.filter((t) => t.type === toType);
  const [tankId, setTankId] = useState("");
  const [date, setDate] = useState(today());

  const submit = () => {
    const tank = available.find((t) => t.id === tankId);
    if (!tank || tankIsOccupied(batches, tank.id, batch.id)) return;
    onSave(tank, date);
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
        <BackdateField value={date} onChange={setDate} label="Transfer date" />
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

// The first half of a packaging run — just picking cans or kegs and marking
// a start time. The actual counts get entered later, in PackagingModal,
// once the run is genuinely finished.
// Every batch that's used this tank, and every cleaning step logged against
// it, in one place — the point is spotting patterns (a tank with repeat
// faults, or one that keeps skipping straight to "Sanitised" without the
// steps in between) rather than just looking up "what's in it right now."
export function TankHistoryModal({ tank, batches, onClose, onOpenBatch }) {
  const history = [...(tank.history || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  // The history log only gets an entry when a batch is started in the app,
  // so batches added any other way (imported, backdated) would be missing.
  // Anything assigned to this tank but not in the log is added from the
  // batch itself, dated to its brew day.
  const loggedIds = new Set(history.filter((h) => h.type === "batch").map((h) => h.batchId));
  const derivedEntries = batches
    .filter((b) => !loggedIds.has(b.id) && b.startDate && batchTankIds(b).includes(tank.id))
    .map((b) => ({ id: `derived-${b.id}`, type: "batch", date: new Date(`${b.startDate}T09:00:00`).toISOString(), batchId: b.id, batchName: b.name, batchNumber: b.number }));
  const batchEntries = [...history.filter((h) => h.type === "batch"), ...derivedEntries].sort((a, b) => new Date(b.date) - new Date(a.date));
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

      {tab === "clean" && cleanEntries.some((h) => h.reconstructed) && (
        <div style={{ color: "#5C6B54", fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
          Entries marked "reconstructed" were added afterwards from brew and packaging dates, not logged at the time.
        </div>
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
                  {h.reconstructed && <span style={{ color: "#9BA88A", fontSize: 11.5, fontStyle: "italic" }}>· reconstructed</span>}
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

// Big, at-a-glance tank visualization for the Home page — same fermenter
// silhouette as the small Tank component used in batch cards, scaled up with
// a gradient fill and an animated liquid surface for a "real tank" feel.
// A compact vessel graphic for the Brew Day cards — same steel-and-fill
// visual language as the full tank cards, just squat and flat-bottomed
// (mash tuns/kettles aren't conical) and small enough to sit as an icon.
// A real barrel silhouette, not a relabeled tank — bulged sides, flat ends,
// hoop bands. Fermenting shows small bubbles escaping the bunghole (active,
// visible); resting/aging shows just one slow wisp every few seconds —
// the stillness itself is the signal that nothing needs doing.
export function BarrelVesselIcon({ fermenting, size = 100, uid: idSeed = "barrel" }) {
  const woodId = `barrel-wood-${idSeed}`;
  const bodyPath = "M30 10 H90 C100 10 105 40 105 95 C105 150 100 180 90 180 H30 C20 180 15 150 15 95 C15 40 20 10 30 10 Z";
  const bubbles = fermenting ? [0, 1, 2].map((i) => ({ delay: i * 0.9, dur: 2.2 + (i % 2) * 0.4 })) : [];

  return (
    <svg width={size} height={size * 1.9} viewBox="0 0 120 190" fill="none">
      <defs>
        <linearGradient id={woodId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8A5A34" />
          <stop offset="50%" stopColor="#B4794A" />
          <stop offset="100%" stopColor="#8A5A34" />
        </linearGradient>
      </defs>
      <path d={bodyPath} fill={`url(#${woodId})`} stroke="#5C3B20" strokeWidth="2" strokeLinejoin="round" />
      {/* Stave lines — just enough to read as wood grain, not literal planks */}
      {[42, 60, 78].map((x) => (
        <line key={x} x1={x} y1="14" x2={x} y2="176" stroke="#6B4527" strokeWidth="1" opacity="0.35" />
      ))}
      {/* Hoop bands */}
      <rect x="16" y="28" width="88" height="9" rx="2" fill="#3A2A1A" opacity="0.85" />
      <rect x="14" y="152" width="92" height="9" rx="2" fill="#3A2A1A" opacity="0.85" />
      {/* Bunghole */}
      <circle cx="60" cy="60" r="4" fill="#2A1D12" />
      {fermenting &&
        bubbles.map((b, i) => (
          <circle key={i} cx={60 + (i - 1) * 6} r="2" fill="#E8D9A0" opacity="0.8">
            <animate attributeName="cy" from="58" to="6" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.8;0.8;0" dur={`${b.dur}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
          </circle>
        ))}
      {!fermenting && (
        <circle cx="60" r="1.6" fill="#E8D9A0" opacity="0.5">
          <animate attributeName="cy" from="56" to="20" dur="6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.5;0" dur="6s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

// Aging tanks are stainless, not wood — same flat-bottomed cylinder body
// used elsewhere for Brite Tanks, but in the Aging stage's own colour so
// it never gets confused with an active brite tank at a glance.
export function AgingTankVesselIcon({ size = 100, uid: idSeed = "agingtank" }) {
  const gradId = `agingtank-grad-${idSeed}`;
  const bodyPath = "M10 20 Q10 10 20 10 H100 Q110 10 110 20 V180 Q110 190 100 190 H20 Q10 190 10 180 Z";

  return (
    <svg width={size} height={size * 1.9} viewBox="0 0 120 200" fill="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A48CC7" />
          <stop offset="100%" stopColor="#6F5290" />
        </linearGradient>
      </defs>
      <path d={bodyPath} stroke="#8E6FB5" strokeWidth="2.1" strokeLinejoin="round" />
      <path d={bodyPath} fill={`url(#${gradId})`} opacity="0.85" />
      <rect x="16.5" y="18" width="3" height="21" rx="1.2" fill="#FFFFFF" opacity="0.3" />
      <circle cx="60" r="1.6" fill="#F0E6FA" opacity="0.5">
        <animate attributeName="cy" from="185" to="20" dur="7s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.5;0" dur="7s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

export function BrewDayVesselIcon({ isKettle, recirculating, uid: idSeed, size = 42 }) {
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

export function TankWallCard({ tank, batch, scheduledBatch, onOpen, onQuickLog, onCycleClean, onSetCleanStage, readOnly }) {
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
          {scheduledBatch && (
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "#9B8F6F", background: "#FBF8F0", border: "1px dashed #C9BD98", borderRadius: 10, padding: "2px 8px", marginTop: 2 }}>
              Scheduled: {scheduledBatch.name} · {scheduledBatch.startDate}
            </span>
          )}
          <button
            onClick={() => !readOnly && onCycleClean(tank.id)}
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
          {scheduledBatch && (
            <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "#9B8F6F", background: "#FBF8F0", border: "1px dashed #C9BD98", borderRadius: 10, padding: "2px 8px", marginTop: 3 }}>
              Scheduled: {scheduledBatch.name} · {scheduledBatch.startDate}
            </span>
          )}
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
              onClick={() => !readOnly && onSetCleanStage(tank.id, "Acid clean")}
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
              onClick={() => !readOnly && onSetCleanStage(tank.id, "Caustic clean")}
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
            onClick={() => !readOnly && onCycleClean(tank.id)}
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
      {!empty && !readOnly && (
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
        onClick={() => batch && onOpen && onOpen(batch.id)}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          cursor: batch && onOpen ? "pointer" : "default",
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
              {latest && latest.gravity != null && <span>SG {latest.gravity.toFixed(3)}</span>}
              <span>{days}d</span>
            </div>
          </div>
        )}
      </button>
    </div>
  );
}
