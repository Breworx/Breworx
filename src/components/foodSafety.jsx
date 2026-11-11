import { useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, CheckCircle2, Users, FileText } from "lucide-react";
import { secondaryBtnStyle, traceLot } from "./traceability";
import { BackdateField, EmptyState, Modal, NumberField, SelectField, TextField } from "./ui";
import { formatHistoryStamp } from "../lib/brewing";
import { monthLabelFromKey } from "../lib/excise";
import { uid } from "../lib/production";
import { addDays, daysBetween, today } from "../lib/utils";

// Checklist items drawn from the actual MPI National Programme 3 (Dec 2025)
// guidance — the "Do" requirements for the cards relevant to a brewery.
export const FOOD_SAFETY_CHECKLISTS = {
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
  // Not on a schedule: run it whenever a label is new, changed or reprinted.
  // Drawn from MPI's "A guide to alcoholic drinks — what's in it and how to
  // label it" (Food Standards Code 1.2 / 2.7.1). Conditional items are worded
  // so ticking means "done, or doesn't apply to this product".
  label: {
    label: "Label compliance — packaged beer & cider",
    frequency: "label",
    onDemand: true,
    requiresProduct: true,
    items: [
      "Name or description is accurate (if it doesn't meet the Code's beer/cider definition, it uses a different description, e.g. \"cider with raspberry\")",
      "Alcohol content shown as X% Alc/Vol, and the beer is within ±0.3% of the label ABV",
      "Standard drinks correct (0.789 × ABV × litres, to 1 decimal place — 330ml at 5% = 1.3), on each can and the outer pack",
      "Pregnancy warning label (official FSANZ design) on every container and the outer pack",
      "Net contents in mL or L, at least 2 mm high, near the product name",
      "Lot/batch ID on the pack, unique to this batch",
      "NZ business name and physical address (a PO Box, website or email alone isn't enough)",
      "Best Before date shown (needed if shelf life is under 2 years)",
      "Storage instructions included if needed to last to Best Before (e.g. \"Keep refrigerated\") — or not needed",
      "Allergens declared: added sulphites ≥10 mg/kg and any added allergen (milk/lactose, nuts, egg, etc.) — or none apply (barley/wheat in beer and isinglass are exempt)",
      "Ingredient list included if the product falls outside the standard beer/cider definition — or not needed",
      "No nutrition or health claims (e.g. \"low carb\", \"gluten free\") unless a nutrition information panel is included",
      "No \"low alcohol\" wording (not allowed over 1.15%)",
      "All text in English, legible and true",
    ],
  },
};

export const TRAINING_TOPICS = [
  "Hand washing & personal hygiene",
  "Cleaning and sanitising",
  "Sourcing, receiving and tracing food",
  "Fermentation / pH monitoring to keep product safe",
  "Allergen awareness",
  "Taking action when something goes wrong",
  "Recall procedure",
  "Other",
];

export function FoodSafetyChecklistModal({ template, onClose, onSave }) {
  const [checked, setChecked] = useState(() => template.items.map(() => false));
  const [notes, setNotes] = useState("");
  const [completedBy, setCompletedBy] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [date, setDate] = useState(today());
  const [product, setProduct] = useState("");

  const toggle = (i) => setChecked((prev) => prev.map((c, idx) => (idx === i ? !c : c)));
  const allChecked = checked.every(Boolean);
  const hasFailures = !allChecked;
  const canSubmit = completedBy.trim() && (!template.requiresProduct || product.trim()) && (!hasFailures || correctiveAction.trim());

  const submit = () => {
    if (!canSubmit) return;
    onSave({
      category: "checklist",
      frequency: template.frequency,
      date,
      // Label checks record which product/label was checked; topic is the
      // free-text column already on food_safety_records.
      topic: template.requiresProduct ? product.trim() : null,
      items: template.items.map((label, i) => ({ label, checked: checked[i] })),
      notes: notes.trim(),
      completedBy: completedBy.trim(),
      correctiveAction: hasFailures ? correctiveAction.trim() : null,
      correctiveActionResolved: !hasFailures,
    });
    onClose();
  };

  return (
    <Modal title={template.label} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {template.requiresProduct && (
          <>
            <TextField label="Product / label (required)" value={product} onChange={setProduct} placeholder="e.g. Bunny Hop 330ml can, Nov 2026 reprint" />
            <div style={{ fontSize: 12, color: "#5C6B54", lineHeight: 1.45 }}>
              Run this whenever a label is new, changed or reprinted. Tick an item if it's on the label, or if it doesn't apply to this product. Based on MPI's labelling guide for alcoholic drinks. Check MPI for anything unusual, and note the energy statement becomes mandatory from 13 August 2028.
            </div>
          </>
        )}
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
        {hasFailures && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "10px 12px" }}>
            <AlertTriangle size={15} color="#7A3E1D" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: "#7A3E1D", lineHeight: 1.4 }}>
              One or more items aren't checked. Record what's being done about it below — this becomes an open corrective action until it's resolved.
            </div>
          </div>
        )}
        {hasFailures && (
          <TextField label="Corrective action (required)" value={correctiveAction} onChange={setCorrectiveAction} placeholder="What's being done about the failed item(s)?" />
        )}
        <TextField label="Completed by (required)" value={completedBy} onChange={setCompletedBy} placeholder="Your name" />
        <BackdateField value={date} onChange={setDate} label="Date completed" />
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? (allChecked ? "#5C9A3C" : "#D9A441") : "#E8E4D4",
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
          {allChecked ? "Complete checklist" : "Save with open corrective action"}
        </button>
      </div>
    </Modal>
  );
}

// Grounded in how barrel programs actually track this — desirable character
// varies by what the vessel used to hold, off-flavours are the same
// handful of real risks regardless. Free text covers everything these
// don't (Brett phases especially move through a lot of ground).
export const TASTING_TAGS = {
  Character: ["Vanilla", "Oak", "Coconut", "Bourbon/Whiskey", "Vinous/Wine", "Sherry", "Tannin", "Spice/Clove", "Brett/Funk", "Sour/Tart", "Earthy", "Caramel"],
  "Off-flavors": ["Oxidation", "Over-oaked", "Acetic/Vinegar", "Mouldy", "Solventy", "Mousy"],
};

export function HarvestYeastModal({ defaultStrainName, onClose, onSave }) {
  const [strainName, setStrainName] = useState(defaultStrainName || "");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("L");
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!strainName.trim() || !amount || Number(amount) <= 0) return;
    onSave({ strainName: strainName.trim(), amount: Number(amount), unit, notes: notes.trim() });
    onClose();
  };

  return (
    <Modal title="Harvest yeast" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Strain" value={strainName} onChange={setStrainName} placeholder="e.g. US-05, WLP001" />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <NumberField label="Amount collected" value={amount} onChange={setAmount} step="0.1" />
          </div>
          <div style={{ width: 90 }}>
            <SelectField label="Unit" value={unit} onChange={setUnit} options={["L", "mL", "kg", "g"]} />
          </div>
        </div>
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Slurry condition, how it was washed, anything worth remembering" />
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save harvest
        </button>
      </div>
    </Modal>
  );
}

export function TopUpModal({ onClose, onSave }) {
  const [date, setDate] = useState(today());
  const [volume, setVolume] = useState("");
  const [note, setNote] = useState("");

  const submit = () => {
    const v = Number(volume);
    if (!v || v <= 0) return;
    onSave({ date, volume: v, note: note.trim() || null });
    onClose();
  };

  return (
    <Modal title="Log a top-up" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <NumberField label="Volume added" value={volume} onChange={setVolume} step="0.1" suffix="L" />
        <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="Where it came from, anything worth remembering" />
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save top-up
        </button>
      </div>
    </Modal>
  );
}

export const SENSORY_CATEGORIES = [
  { key: "appearance", label: "Appearance" },
  { key: "aroma", label: "Aroma" },
  { key: "flavor", label: "Flavor" },
  { key: "mouthfeel", label: "Mouthfeel" },
  { key: "overall", label: "Overall" },
];

// A proper multi-taster scoresheet, separate from the quick tag-based
// tasting log above — that one's for jotting down a fault or a note in
// passing, this is for tracking quality consistency over time across
// several people's independent scores on the same batch.
export function SensoryScoreModal({ onClose, onSave }) {
  const [tasterName, setTasterName] = useState("");
  const [date, setDate] = useState(today());
  const [scores, setScores] = useState(() => {
    const init = {};
    SENSORY_CATEGORIES.forEach((c) => (init[c.key] = 0));
    return init;
  });
  const [notes, setNotes] = useState("");

  const setScore = (key, value) => setScores((prev) => ({ ...prev, [key]: value }));
  const canSubmit = tasterName.trim() && SENSORY_CATEGORIES.every((c) => scores[c.key] > 0);

  const submit = () => {
    if (!canSubmit) return;
    onSave({ tasterName: tasterName.trim(), date, scores, notes: notes.trim() });
    onClose();
  };

  return (
    <Modal title="Score this batch" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Taster name" value={tasterName} onChange={setTasterName} />
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        {SENSORY_CATEGORIES.map((c) => (
          <div key={c.key}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6 }}>{c.label}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setScore(c.key, n)}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    background: scores[c.key] >= n ? "#5C9A3C" : "#F5F1E4",
                    border: `1px solid ${scores[c.key] >= n ? "#5C9A3C" : "#DDE0C8"}`,
                    borderRadius: 5,
                    color: scores[c.key] >= n ? "#16191A" : "#9BA88A",
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14, resize: "vertical" }}
          />
        </label>
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
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          Save score
        </button>
      </div>
    </Modal>
  );
}

// Objective, instrument-measured data — pH, dissolved oxygen, CO2
// volumes — tracked alongside the sensory score above, not replacing
// it. Any field can be left blank if that particular instrument wasn't
// used for this reading.
export function LabMeasurementModal({ onClose, onSave }) {
  const [date, setDate] = useState(today());
  const [measuredBy, setMeasuredBy] = useState("");
  const [gravity, setGravity] = useState("");
  const [ph, setPh] = useState("");
  const [dissolvedOxygen, setDissolvedOxygen] = useState("");
  const [co2Volumes, setCo2Volumes] = useState("");
  const [notes, setNotes] = useState("");

  const canSubmit = measuredBy.trim() && (gravity !== "" || ph !== "" || dissolvedOxygen !== "" || co2Volumes !== "");

  const submit = () => {
    if (!canSubmit) return;
    onSave({
      date,
      measuredBy: measuredBy.trim(),
      gravity: gravity === "" ? null : Number(gravity),
      ph: ph === "" ? null : Number(ph),
      dissolvedOxygen: dissolvedOxygen === "" ? null : Number(dissolvedOxygen),
      co2Volumes: co2Volumes === "" ? null : Number(co2Volumes),
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <Modal title="Log lab measurement" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>Instrument readings — leave anything not measured blank.</div>
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <TextField label="Measured by (required)" value={measuredBy} onChange={setMeasuredBy} placeholder="Your name" />
        <NumberField label="Gravity (SG)" value={gravity} onChange={setGravity} step="0.001" />
        <NumberField label="pH" value={ph} onChange={setPh} step="0.01" />
        <NumberField label="Dissolved oxygen (ppb)" value={dissolvedOxygen} onChange={setDissolvedOxygen} step="1" />
        <NumberField label="CO2 (volumes)" value={co2Volumes} onChange={setCo2Volumes} step="0.1" />
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14, resize: "vertical" }}
          />
        </label>
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
            cursor: canSubmit ? "pointer" : "default",
          }}
        >
          Save measurement
        </button>
      </div>
    </Modal>
  );
}

export function TastingLogModal({ onClose, onSave }) {
  const [date, setDate] = useState(today());
  const [tags, setTags] = useState(() => new Set());
  const [notes, setNotes] = useState("");

  const toggleTag = (tag) =>
    setTags((prev) => {
      const next = new Set(prev);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return next;
    });

  const submit = () => {
    onSave({ date, tags: [...tags], notes: notes.trim() });
    onClose();
  };

  return (
    <Modal title="Log a tasting" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        {Object.entries(TASTING_TAGS).map(([group, groupTags]) => (
          <div key={group}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 6 }}>{group}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {groupTags.map((tag) => {
                const active = tags.has(tag);
                const isOff = group === "Off-flavors";
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    style={{
                      background: active ? (isOff ? "#FBE5D2" : "#EBF3E4") : "#F5F1E4",
                      border: `1px solid ${active ? (isOff ? "#E3B37A" : "#5C9A3C") : "#DDE0C8"}`,
                      borderRadius: 20,
                      padding: "6px 12px",
                      color: active ? (isOff ? "#7A3E1D" : "#2A3324") : "#5C6B54",
                      fontFamily: "'Inter', sans-serif",
                      fontSize: 12.5,
                      cursor: "pointer",
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Anything the tags don't cover…" />
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save tasting note
        </button>
      </div>
    </Modal>
  );
}

export const PEST_ACTIVITY_OPTIONS = [
  ["none", "None", "#5C9A3C"],
  ["light", "Light", "#D9A441"],
  ["medium", "Medium", "#E08A3C"],
  ["heavy", "Heavy", "#B5502F"],
];

export function PestStationsModal({ stations, records, onClose, onAdd, onUpdate }) {
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState("bait");
  const [expandedStationId, setExpandedStationId] = useState(null);

  const submit = () => {
    if (!label.trim()) return;
    onAdd({ id: uid(), label: label.trim(), location: location.trim(), type, active: true });
    setLabel("");
    setLocation("");
  };

  const historyFor = (stationId) =>
    (records || []).filter((r) => r.category === "Pest control" && r.stationId === stationId).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Modal title="Pest control stations" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          A numbered register — check the same physical points every time, so there's a real record of where and when, not just "checked for pests."
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {stations.map((s) => {
            const history = historyFor(s.id);
            const expanded = expandedStationId === s.id;
            // Monthly cadence — direct advice from a food safety inspector,
            // not a fixed MPI number, so treat 30 days as the threshold.
            const overdue = s.active && (history.length === 0 || daysBetween(history[0].date, today()) > 30);
            return (
              <div key={s.id} style={{ background: s.active ? "#F8F5EA" : "#F5F1E4", border: `1px solid ${overdue ? "#E3B37A" : "#EBE8D6"}`, borderRadius: 5, opacity: s.active ? 1 : 0.55 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px" }}>
                  <button
                    onClick={() => setExpandedStationId(expanded ? null : s.id)}
                    style={{ flex: 1, background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
                  >
                    <div style={{ color: "#2A3324", fontSize: 13.5 }}>{s.label}</div>
                    {s.location && <div style={{ color: "#9BA88A", fontSize: 11.5 }}>{s.location}</div>}
                    {overdue && (
                      <div style={{ color: "#B5502F", fontSize: 11 }}>
                        {history.length === 0 ? "Never checked" : `Overdue — last checked ${formatHistoryStamp(history[0].date)}`}
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => setExpandedStationId(expanded ? null : s.id)}
                    style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 20, padding: "4px 10px", color: "#5C6B54", fontSize: 11, fontFamily: "'Inter', sans-serif", cursor: "pointer" }}
                  >
                    History ({history.length})
                  </button>
                  <button
                    onClick={() => onUpdate(s.id, { active: !s.active })}
                    style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 20, padding: "4px 10px", color: "#5C6B54", fontSize: 11, fontFamily: "'Inter', sans-serif", cursor: "pointer" }}
                  >
                    {s.active ? "Retire" : "Reactivate"}
                  </button>
                </div>
                {expanded && (
                  <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {history.length === 0 ? (
                      <div style={{ color: "#9BA88A", fontSize: 12 }}>No checks logged for this station yet.</div>
                    ) : (
                      history.map((r) => {
                        const level = PEST_ACTIVITY_OPTIONS.find(([key]) => key === r.pestActivity);
                        return (
                          <div key={r.id} style={{ padding: "8px 10px", background: "#FFFFFF", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9BA88A" }}>{formatHistoryStamp(r.date)}</span>
                              {level && (
                                <span style={{ fontSize: 11, color: level[2], border: `1px solid ${level[2]}`, borderRadius: 20, padding: "1px 8px" }}>
                                  {level[1]}
                                </span>
                              )}
                              <span style={{ fontSize: 11.5, color: "#9BA88A" }}>{r.completedBy}</span>
                            </div>
                            {r.notes && <div style={{ fontSize: 12, color: "#5C6B54" }}>{r.notes}</div>}
                            {r.correctiveAction && (
                              <div style={{ fontSize: 12, color: r.correctiveActionResolved ? "#5C9A3C" : "#B5502F", marginTop: 3 }}>
                                Action: {r.correctiveAction}{!r.correctiveActionResolved && " (open)"}
                              </div>
                            )}
                            {r.photoUrl && (
                              <img src={r.photoUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, marginTop: 5 }} />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {stations.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>No stations added yet.</div>}
        </div>

        <div style={{ borderTop: "1px solid #EBE8D6", paddingTop: 14 }}>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 8 }}>Add a station</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TextField label="Label (e.g. Station 1)" value={label} onChange={setLabel} />
            <TextField label="Location" value={location} onChange={setLocation} placeholder="e.g. Loading dock door" />
            <SelectField label="Type" value={type} onChange={setType} options={["bait", "trap", "other"]} />
            <button
              onClick={submit}
              style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "10px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, cursor: "pointer" }}
            >
              Add station
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// A real MPI-recognised verifier's actual visit — distinct from the
// internal audit (your own self-review) and from the mock recall's draft
// notification to the verifier. Findings that need action feed into the
// same open-corrective-action tracking as everything else in Food Safety.
// A real customer complaint, tied to a specific batch where possible —
// feeds the same traceability data the mock recall already uses, so a
// pattern across complaints (same batch, same lot) is easy to spot later.
export function LogComplaintModal({ batches, onClose, onSave }) {
  const [customerName, setCustomerName] = useState("");
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState("");
  const [batchQuery, setBatchQuery] = useState("");
  const [batchFocused, setBatchFocused] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [hasAction, setHasAction] = useState(false);
  const [correctiveAction, setCorrectiveAction] = useState("");

  const batchMatches = batchQuery.trim()
    ? batches.filter((b) => b.name.toLowerCase().includes(batchQuery.trim().toLowerCase()) || (b.number || "").toLowerCase().includes(batchQuery.trim().toLowerCase())).slice(0, 8)
    : [];
  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  const submit = () => {
    if (!customerName.trim() || !description.trim()) return;
    if (hasAction && !correctiveAction.trim()) return;
    onSave({
      category: "Complaint",
      date,
      completedBy: customerName.trim(),
      notes: description.trim(),
      batchId: selectedBatchId || null,
      batchName: selectedBatch ? selectedBatch.name : null,
      correctiveAction: hasAction ? correctiveAction.trim() : null,
      correctiveActionResolved: !hasAction,
    });
    onClose();
  };

  return (
    <Modal title="Log a customer complaint" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Customer / complainant name" value={customerName} onChange={setCustomerName} />
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <TextField label="What happened" value={description} onChange={setDescription} placeholder="What they reported" />
        <div style={{ position: "relative" }}>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Batch involved (optional, but worth linking if known)</div>
          <input
            type="text"
            value={selectedBatch ? selectedBatch.name : batchQuery}
            onChange={(e) => {
              setBatchQuery(e.target.value);
              setSelectedBatchId("");
            }}
            onFocus={() => setBatchFocused(true)}
            onBlur={() => setTimeout(() => setBatchFocused(false), 150)}
            placeholder="Search by batch name or number"
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
          {batchFocused && !selectedBatch && batchMatches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, marginTop: 2, maxHeight: 180, overflowY: "auto" }}>
              {batchMatches.map((b) => (
                <button
                  key={b.id}
                  onMouseDown={() => {
                    setSelectedBatchId(b.id);
                    setBatchFocused(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #EBE8D6", padding: "9px 10px", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                >
                  {b.name} <span style={{ color: "#9BA88A" }}>#{b.number}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Any corrective action taken?</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              [false, "No action needed"],
              [true, "Yes"],
            ].map(([val, label]) => (
              <button
                key={label}
                onClick={() => setHasAction(val)}
                style={{
                  background: hasAction === val ? (val ? "#D9A441" : "#5C9A3C") : "#F5F1E4",
                  border: `1px solid ${hasAction === val ? (val ? "#D9A441" : "#5C9A3C") : "#DDE0C8"}`,
                  borderRadius: 20,
                  padding: "6px 14px",
                  color: hasAction === val ? "#16191A" : "#5C6B54",
                  fontSize: 12.5,
                  fontFamily: "'Inter', sans-serif",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {hasAction && (
          <TextField
            label="Corrective action (required)"
            value={correctiveAction}
            onChange={setCorrectiveAction}
            placeholder="What was done in response"
          />
        )}
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export function LogVerifierVisitModal({ onClose, onSave, onUploadPhoto }) {
  const [verifierName, setVerifierName] = useState("");
  const [date, setDate] = useState(today());
  const [findings, setFindings] = useState("");
  const [hasNonConformance, setHasNonConformance] = useState(false);
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [nextVisitDue, setNextVisitDue] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handlePhotoSelect = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    const url = await onUploadPhoto(file);
    setUploadingPhoto(false);
    if (url) setPhotoUrl(url);
  };

  const submit = () => {
    if (!verifierName.trim()) return;
    if (hasNonConformance && !correctiveAction.trim()) return;
    onSave({
      category: "Verifier visit",
      date,
      completedBy: verifierName.trim(),
      notes: findings.trim(),
      dueDate: nextVisitDue || null,
      photoUrl,
      correctiveAction: hasNonConformance ? correctiveAction.trim() : null,
      correctiveActionResolved: !hasNonConformance,
    });
    onClose();
  };

  return (
    <Modal title="Log a verifier visit" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Verifier name" value={verifierName} onChange={setVerifierName} placeholder="Your recognised MPI verifier" />
        <TextField label="Visit date" type="date" value={date} onChange={setDate} />
        <TextField label="Findings / notes" value={findings} onChange={setFindings} placeholder="What they checked, general comments" />
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Any non-conformances raised?</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              [false, "None"],
              [true, "Yes"],
            ].map(([val, label]) => (
              <button
                key={label}
                onClick={() => setHasNonConformance(val)}
                style={{
                  background: hasNonConformance === val ? (val ? "#B5502F" : "#5C9A3C") : "#F5F1E4",
                  border: `1px solid ${hasNonConformance === val ? (val ? "#B5502F" : "#5C9A3C") : "#DDE0C8"}`,
                  borderRadius: 20,
                  padding: "6px 14px",
                  color: hasNonConformance === val ? "#FFFFFF" : "#5C6B54",
                  fontSize: 12.5,
                  fontFamily: "'Inter', sans-serif",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {hasNonConformance && (
          <TextField
            label="Corrective action (required)"
            value={correctiveAction}
            onChange={setCorrectiveAction}
            placeholder="What you'll do to address it"
          />
        )}
        <TextField label="Next visit due (optional)" type="date" value={nextVisitDue} onChange={setNextVisitDue} />
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Visit report (optional)</div>
          {photoUrl ? (
            <div style={{ position: "relative", width: 90 }}>
              <img src={photoUrl} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #DDE0C8" }} />
              <button
                onClick={() => setPhotoUrl(null)}
                aria-label="Remove"
                style={{ position: "absolute", top: -6, right: -6, background: "#B5502F", border: "none", borderRadius: "50%", width: 20, height: 20, color: "#FFFFFF", cursor: "pointer", fontSize: 12, lineHeight: "20px", padding: 0 }}
              >
                ×
              </button>
            </div>
          ) : (
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F5F1E4", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "9px 14px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: uploadingPhoto ? "default" : "pointer" }}
            >
              {uploadingPhoto ? "Uploading…" : "+ Add a photo or scan"}
              <input type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoSelect(e.target.files?.[0])} disabled={uploadingPhoto} style={{ display: "none" }} />
            </label>
          )}
        </div>
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export function LogContractorVisitModal({ onClose, onSave, onUploadPhoto }) {
  const [contractorName, setContractorName] = useState("");
  const [date, setDate] = useState(today());
  const [findings, setFindings] = useState("");
  const [nextVisitDue, setNextVisitDue] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handlePhotoSelect = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    const url = await onUploadPhoto(file);
    setUploadingPhoto(false);
    if (url) setPhotoUrl(url);
  };

  const submit = () => {
    if (!contractorName.trim()) return;
    onSave({
      category: "Pest control — contractor visit",
      date,
      completedBy: contractorName.trim(),
      notes: findings.trim(),
      dueDate: nextVisitDue || null,
      photoUrl,
      correctiveActionResolved: true,
    });
    onClose();
  };

  return (
    <Modal title="Log a contractor visit" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Contractor / company" value={contractorName} onChange={setContractorName} placeholder="e.g. Rentokil" />
        <TextField label="Visit date" type="date" value={date} onChange={setDate} />
        <TextField label="Findings / recommendations" value={findings} onChange={setFindings} placeholder="What they found, anything actioned or recommended" />
        <TextField label="Next visit due (optional)" type="date" value={nextVisitDue} onChange={setNextVisitDue} />
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Visit report (optional)</div>
          {photoUrl ? (
            <div style={{ position: "relative", width: 90 }}>
              <img src={photoUrl} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #DDE0C8" }} />
              <button
                onClick={() => setPhotoUrl(null)}
                aria-label="Remove"
                style={{ position: "absolute", top: -6, right: -6, background: "#B5502F", border: "none", borderRadius: "50%", width: 20, height: 20, color: "#FFFFFF", cursor: "pointer", fontSize: 12, lineHeight: "20px", padding: 0 }}
              >
                ×
              </button>
            </div>
          ) : (
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F5F1E4", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "9px 14px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: uploadingPhoto ? "default" : "pointer" }}
            >
              {uploadingPhoto ? "Uploading…" : "+ Add a photo or scan"}
              <input type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoSelect(e.target.files?.[0])} disabled={uploadingPhoto} style={{ display: "none" }} />
            </label>
          )}
        </div>
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export function LogPestCheckModal({ stations, onClose, onSave, onUploadPhoto, onCreateReminder }) {
  const [stationId, setStationId] = useState("");
  const [date, setDate] = useState(today());
  const [activity, setActivity] = useState("none");
  const [baitReplaced, setBaitReplaced] = useState(false);
  const [notes, setNotes] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [completedBy, setCompletedBy] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [remindAgain, setRemindAgain] = useState(true);

  const activeStations = stations.filter((s) => s.active);
  const needsAction = activity !== "none";

  const handlePhotoSelect = async (file) => {
    if (!file) return;
    setUploadingPhoto(true);
    const url = await onUploadPhoto(file);
    setUploadingPhoto(false);
    if (url) setPhotoUrl(url);
  };

  const submit = () => {
    if (!completedBy.trim()) return;
    if (needsAction && !correctiveAction.trim()) return;
    const station = activeStations.find((s) => s.id === stationId);
    const noteParts = [
      station ? `${station.label} — ${station.location || ""}.` : "General sighting.",
      baitReplaced ? "Bait replaced." : "",
      notes.trim(),
    ].filter(Boolean);
    onSave({
      category: "Pest control",
      date,
      stationId: station ? station.id : null,
      pestActivity: activity,
      notes: noteParts.join(" "),
      completedBy: completedBy.trim(),
      correctiveAction: needsAction ? correctiveAction.trim() : null,
      correctiveActionResolved: !needsAction,
      photoUrl,
    });
    if (remindAgain) {
      const what = station ? station.label : "pest stations";
      onCreateReminder(`Check ${what}`, addDays(date, 7));
    }
    onClose();
  };

  return (
    <Modal title="Log a pest check" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Station (or leave as General for an ad-hoc sighting)</div>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          >
            <option value="">General sighting</option>
            {activeStations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.location ? ` — ${s.location}` : ""}
              </option>
            ))}
          </select>
        </div>
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Activity level</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PEST_ACTIVITY_OPTIONS.map(([key, label, color]) => (
              <button
                key={key}
                onClick={() => setActivity(key)}
                style={{
                  background: activity === key ? color : "#F5F1E4",
                  border: `1px solid ${activity === key ? color : "#DDE0C8"}`,
                  borderRadius: 20,
                  padding: "6px 12px",
                  color: activity === key ? "#16191A" : "#5C6B54",
                  fontSize: 12.5,
                  fontFamily: "'Inter', sans-serif",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={baitReplaced}
            onChange={(e) => setBaitReplaced(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
          />
          <span style={{ color: "#5C6B54", fontSize: 13 }}>Bait replaced</span>
        </label>
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Anything else worth noting" />
        {needsAction && (
          <TextField
            label="Corrective action (required — something was found)"
            value={correctiveAction}
            onChange={setCorrectiveAction}
            placeholder="What was done about it"
          />
        )}
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Photo evidence (optional)</div>
          {photoUrl ? (
            <div style={{ position: "relative", width: 90 }}>
              <img src={photoUrl} alt="" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 6, border: "1px solid #DDE0C8" }} />
              <button
                onClick={() => setPhotoUrl(null)}
                aria-label="Remove photo"
                style={{ position: "absolute", top: -6, right: -6, background: "#B5502F", border: "none", borderRadius: "50%", width: 20, height: 20, color: "#FFFFFF", cursor: "pointer", fontSize: 12, lineHeight: "20px", padding: 0 }}
              >
                ×
              </button>
            </div>
          ) : (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#F5F1E4",
                border: "1px dashed #C9D1AC",
                borderRadius: 5,
                padding: "9px 14px",
                color: "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: uploadingPhoto ? "default" : "pointer",
              }}
            >
              {uploadingPhoto ? "Uploading…" : "+ Add a photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handlePhotoSelect(e.target.files?.[0])}
                disabled={uploadingPhoto}
                style={{ display: "none" }}
              />
            </label>
          )}
        </div>
        <TextField label="Completed by" value={completedBy} onChange={setCompletedBy} placeholder="Your name" />
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={remindAgain}
            onChange={(e) => setRemindAgain(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: "#5C9A3C", cursor: "pointer" }}
          />
          <span style={{ color: "#5C6B54", fontSize: 13 }}>Remind me to check again in 7 days</span>
        </label>
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

export function CalibrationModal({ onClose, onSave }) {
  const [equipmentName, setEquipmentName] = useState("");
  const [date, setDate] = useState(today());
  const [result, setResult] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [completedBy, setCompletedBy] = useState("");

  const submit = () => {
    if (!equipmentName.trim() || !completedBy.trim()) return;
    onSave({
      category: "calibration",
      date,
      equipmentName: equipmentName.trim(),
      result: result.trim(),
      dueDate: dueDate || null,
      completedBy: completedBy.trim(),
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
        <TextField label="Completed by (required)" value={completedBy} onChange={setCompletedBy} placeholder="Your name" />
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

// General preventive maintenance — pump servicing, boiler checks, that
// kind of thing. Deliberately separate from calibration above, which is
// a food-safety accuracy requirement, not equipment upkeep — same
// underlying record type, different purpose.
export function MaintenanceModal({ onClose, onSave }) {
  const [equipmentName, setEquipmentName] = useState("");
  const [date, setDate] = useState(today());
  const [workDone, setWorkDone] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [completedBy, setCompletedBy] = useState("");

  const submit = () => {
    if (!equipmentName.trim() || !completedBy.trim()) return;
    onSave({
      category: "maintenance",
      date,
      equipmentName: equipmentName.trim(),
      result: workDone.trim(),
      dueDate: dueDate || null,
      completedBy: completedBy.trim(),
    });
    onClose();
  };

  return (
    <Modal title="Log equipment maintenance" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Equipment (e.g. mash pump, glycol chiller, boiler)" value={equipmentName} onChange={setEquipmentName} />
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <TextField label="Work done (e.g. serviced, seals replaced)" value={workDone} onChange={setWorkDone} />
        <TextField label="Next service due (optional)" type="date" value={dueDate} onChange={setDueDate} />
        <TextField label="Completed by (required)" value={completedBy} onChange={setCompletedBy} placeholder="Your name" />
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
          Save maintenance record
        </button>
      </div>
    </Modal>
  );
}

export function TrainingModal({ onClose, onSave, existingRecords }) {
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

export const ILLNESS_SYMPTOMS = [
  "Vomiting",
  "Diarrhoea",
  "Jaundice (yellowing of skin/eyes)",
  "Fever",
  "Sore throat with fever",
  "Infected wound, boil, or cut with pus",
];
export const ILLNESS_STATUS_OPTIONS = ["Excluded from food handling", "Restricted duties", "Monitoring", "Cleared to return"];

export function StaffIllnessModal({ onClose, onSave, existingRecords }) {
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

export function FoodSafetyNoteModal({ category, title, onClose, onSave }) {
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

export function SupplierFormModal({ supplier, onClose, onSave }) {
  const [name, setName] = useState(supplier ? supplier.name : "");
  const [contactName, setContactName] = useState(supplier ? supplier.contactName || "" : "");
  const [phone, setPhone] = useState(supplier ? supplier.phone || "" : "");
  const [email, setEmail] = useState(supplier ? supplier.email || "" : "");
  const [address, setAddress] = useState(supplier ? supplier.address || "" : "");
  const [leadTimeDays, setLeadTimeDays] = useState(supplier?.leadTimeDays ?? "");
  const [notes, setNotes] = useState(supplier ? supplier.notes || "" : "");
  const [approved, setApproved] = useState(supplier ? supplier.approved || false : false);
  const [approvedNotes, setApprovedNotes] = useState(supplier ? supplier.approvedNotes || "" : "");
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
      approved,
      approvedNotes: approvedNotes.trim(),
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
        <div>
          <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 6 }}>Approved supplier</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              [false, "Not yet approved"],
              [true, "Approved"],
            ].map(([val, label]) => (
              <button
                key={label}
                onClick={() => setApproved(val)}
                style={{
                  background: approved === val ? (val ? "#5C9A3C" : "#F5F1E4") : "#F5F1E4",
                  border: `1px solid ${approved === val ? (val ? "#5C9A3C" : "#DDE0C8") : "#DDE0C8"}`,
                  borderRadius: 20,
                  padding: "6px 14px",
                  color: approved === val && val ? "#16191A" : "#5C6B54",
                  fontSize: 12.5,
                  fontFamily: "'Inter', sans-serif",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {approved && (
          <TextField
            label="How verified (optional)"
            value={approvedNotes}
            onChange={setApprovedNotes}
            placeholder="e.g. sighted their food safety certification, 12 Aug 2026"
          />
        )}
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

export function SupplierDocumentsModal({ supplier, documents, onClose, onUpload, onDelete, onOpen }) {
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
                {onDelete && (
                  <button onClick={() => onDelete(doc)} style={{ background: "none", border: "none", color: "#B5502F", cursor: "pointer", fontSize: 12.5, padding: 0 }}>
                    Delete
                  </button>
                )}
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

export function StaffTrainingRecordModal({ staffName, records, onClose }) {
  const trainingRecords = records
    .filter((r) => r.category === "training" && r.staffName === staffName)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const topicsCovered = [...new Set(trainingRecords.map((r) => r.topic))];
  const outstandingTopics = TRAINING_TOPICS.filter((t) => t !== "Other" && !topicsCovered.includes(t));

  // Most recent record per topic — refresher due once it's over a year old.
  const latestByTopic = {};
  trainingRecords.forEach((r) => {
    if (!latestByTopic[r.topic] || r.date > latestByTopic[r.topic]) latestByTopic[r.topic] = r.date;
  });
  const isDueForRefresher = (topic) => latestByTopic[topic] && daysBetween(latestByTopic[topic], today()) > 365;

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
          {trainingRecords.map((r) => {
            const isLatestForTopic = latestByTopic[r.topic] === r.date;
            return (
              <div
                key={r.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  background: "#F8F5EA",
                  border: `1px solid ${isLatestForTopic && isDueForRefresher(r.topic) ? "#E3B37A" : "#EBE8D6"}`,
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#2A3324" }}>{r.topic}</div>
                  {r.trainedBy && <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>by {r.trainedBy}</div>}
                  {isLatestForTopic && isDueForRefresher(r.topic) && (
                    <div style={{ color: "#B5502F", fontSize: 10.5, marginTop: 2 }}>Due for refresher — over a year ago</div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54", fontSize: 12 }}>{r.date}</div>
                  <div style={{ fontSize: 10.5, color: r.staffConfirmed ? "#D9A441" : "#5C9A3C", marginTop: 2 }}>
                    {r.staffConfirmed ? "confirmed" : "not confirmed"}
                  </div>
                </div>
              </div>
            );
          })}
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

export function FoodSafetyDisclaimerModal({ onAccept }) {
  const [confirmed, setConfirmed] = useState(false);

  return createPortal(
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
    </div>,
    document.body
  );
}

// A clean, print-ready report — built for handing to an inspector or
// auditor, not for reading on screen. Uses the browser's own print/Save-as-
// PDF rather than a PDF library, so there's nothing extra to load or break.
export function FoodSafetyAuditReport({ records, monthFilter, companyName, onClose, periodLabelOverride, closeLabel = "Close" }) {
  const categoryLabel = {
    checklist: "Checklist",
    calibration: "Calibration",
    maintenance: "Equipment maintenance",
    training: "Training",
    water: "Water test",
    recall: "Mock recall",
    incident: "Incident",
    illness: "Staff sickness",
    "Pest control": "Pest control",
    "Pest control — contractor visit": "Pest control (contractor)",
    "Internal audit": "Internal audit",
    "Verifier visit": "Verifier visit",
    "Complaint": "Customer complaint",
  };
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  // Records typed in from paper keep the date they happened, but the
  // report is upfront that they were entered afterwards — an auditor
  // trusts a transcribed log far more when it says so.
  const enteredLater = (r) => !!r.createdAt && !!r.date && r.createdAt.slice(0, 10) > r.date;
  const transferredCount = records.filter(enteredLater).length;
  const openCorrectiveActions = records.filter((r) => r.correctiveAction && !r.correctiveActionResolved);
  const periodLabel = periodLabelOverride || (monthFilter ? monthLabelFromKey(monthFilter) : "All records");
  const counts = {};
  records.forEach((r) => {
    counts[r.category] = (counts[r.category] || 0) + 1;
  });

  const recordDetail = (r) => {
    if (r.category === "checklist") {
      const total = (r.items || []).length;
      const done = (r.items || []).filter((i) => i.checked).length;
      return `${r.frequency === "label" ? `Label check${r.topic ? `: ${r.topic}` : ""} — ` : ""}${done}/${total} items checked${r.completedBy ? ` — completed by ${r.completedBy}` : ""}${r.correctiveAction ? ` — corrective action: ${r.correctiveAction} (${r.correctiveActionResolved ? "resolved" : "OPEN"})` : ""}`;
    }
    if (r.category === "calibration") {
      return `${r.equipmentName || ""} — ${r.result || "no result recorded"}${r.dueDate ? ` — next due ${r.dueDate}` : ""}${r.completedBy ? ` — completed by ${r.completedBy}` : ""}`;
    }
    if (r.category === "training") {
      return `${r.staffName || ""} — ${r.topic || ""}${r.trainedBy ? ` — trained by ${r.trainedBy}` : ""}${r.staffConfirmed ? " — confirmed by staff member" : ""}`;
    }
    if (r.category === "illness") return `${r.staffName || ""}${r.notes ? ` — ${r.notes}` : ""}`;
    return r.notes || "";
  };

  return createPortal(
    <div id="audit-report-print" style={{ position: "fixed", inset: 0, zIndex: 200, background: "#F5F1E4", overflowY: "auto" }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #audit-report-print, #audit-report-print * { visibility: visible; }
          #audit-report-print { position: absolute; top: 0; left: 0; width: 100%; background: #FFFFFF; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ position: "sticky", top: 0, background: "#F5F1E4", borderBottom: "1px solid #DDE0C8", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 1 }}>
        <button
          onClick={onClose}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 13.5 }}
        >
          <X size={16} /> {closeLabel}
        </button>
        <button
          onClick={() => window.print()}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 16px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
        >
          Print / Save as PDF
        </button>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "36px 28px 60px", color: "#1A1F16" }}>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5C6B54" }}>
          {companyName || "Brewery"}
        </div>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, fontWeight: 500, margin: "4px 0 6px" }}>Food Safety Audit Report</h1>
        <div style={{ fontSize: 13, color: "#5C6B54", marginBottom: 28 }}>
          Period: {periodLabel} · Generated {today()}
        </div>
        {transferredCount > 0 && (
          <div style={{ fontSize: 12.5, color: "#5C6B54", marginTop: -18, marginBottom: 24 }}>
            {transferredCount} record{transferredCount === 1 ? " was" : "s were"} transferred from written logs and entered after the date shown. Original paper records are kept on file.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 28, pageBreakInside: "avoid" }}>
          {Object.entries(counts).map(([cat, n]) => (
            <div key={cat} style={{ border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ fontSize: 20, fontFamily: "'JetBrains Mono', monospace" }}>{n}</div>
              <div style={{ fontSize: 11, color: "#5C6B54" }}>{categoryLabel[cat] || cat}</div>
            </div>
          ))}
        </div>

        {openCorrectiveActions.length > 0 && (
          <div style={{ marginBottom: 28, pageBreakInside: "avoid" }}>
            <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 500, borderBottom: "1px solid #DDE0C8", paddingBottom: 6, marginBottom: 10 }}>
              Open corrective actions ({openCorrectiveActions.length})
            </h2>
            {openCorrectiveActions.map((r) => (
              <div key={r.id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #F0EDE0" }}>
                <strong>{r.date}</strong> — {r.correctiveAction}
                <span style={{ color: "#B5502F" }}> (open {daysBetween(r.date, today())} days)</span>
              </div>
            ))}
          </div>
        )}

        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, fontWeight: 500, borderBottom: "1px solid #DDE0C8", paddingBottom: 6, marginBottom: 10 }}>
          Full record log ({sorted.length})
        </h2>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {sorted.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: "1px solid #F0EDE0", fontSize: 12.5, pageBreakInside: "avoid" }}>
              <div style={{ width: 78, flexShrink: 0, fontFamily: "'JetBrains Mono', monospace", color: "#5C6B54" }}>{r.date}</div>
              <div style={{ width: 90, flexShrink: 0, color: "#5C6B54" }}>{categoryLabel[r.category] || r.category}</div>
              <div style={{ flex: 1 }}>
                {recordDetail(r)}
                {enteredLater(r) && <span style={{ color: "#5C6B54", fontStyle: "italic" }}> — transferred from written record, entered {r.createdAt.slice(0, 10)}</span>}
              </div>
            </div>
          ))}
          {sorted.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13, padding: "12px 0" }}>No records in this period.</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function FoodSafetyView({ records, onStartChecklist, onStartCalibration, onStartMaintenance, onStartTraining, onStartIllness, onStartNote, onOpenStaff, suppliers, onOpenSupplier, onResolveCorrectiveAction, companyName, onLogPestCheck, onManagePestStations, pestStations, onLogContractorVisit, onStartMockRecall, onStartInternalAudit, onLogVerifierVisit, onLogComplaint, onShareWithAuditor }) {
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [showAuditReport, setShowAuditReport] = useState(false);

  const categoryLabel = {
    checklist: "Checklist",
    calibration: "Calibration",
    maintenance: "Equipment maintenance",
    training: "Training",
    water: "Water test",
    recall: "Mock recall",
    incident: "Incident",
    illness: "Staff sickness",
    "Pest control": "Pest control",
    "Pest control — contractor visit": "Pest control (contractor)",
    "Internal audit": "Internal audit",
    "Verifier visit": "Verifier visit",
    "Complaint": "Customer complaint",
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

  // Overdue/open-items dashboard — the bit that makes this feel like a real
  // audit tool rather than just a log. A checklist is "overdue" once it's
  // past its frequency window since the last completed one of that type;
  // a corrective action stays open until explicitly marked resolved;
  // calibration checks its most recent record's due date (re-calibrating
  // clears an old overdue one automatically, since only the latest counts).
  const CHECKLIST_WINDOW_DAYS = { daily: 1, weekly: 7, monthly: 31 };
  const daysSince = (dateStr) => Math.floor((new Date(today()) - new Date(dateStr)) / 86400000);
  const overdueChecklists = Object.entries(FOOD_SAFETY_CHECKLISTS)
    .filter(([, template]) => !template.onDemand)
    .map(([key, template]) => {
      const matching = records.filter((r) => r.category === "checklist" && r.frequency === key).sort((a, b) => b.date.localeCompare(a.date));
      const latest = matching[0];
      const since = latest ? daysSince(latest.date) : Infinity;
      return { key, template, latest, since, overdue: since > CHECKLIST_WINDOW_DAYS[key] };
    })
    .filter((c) => c.overdue);

  const openCorrectiveActions = records.filter((r) => r.correctiveAction && !r.correctiveActionResolved);

  const latestCalibrationByEquipment = {};
  records
    .filter((r) => r.category === "calibration" && r.equipmentName)
    .forEach((r) => {
      const existing = latestCalibrationByEquipment[r.equipmentName];
      if (!existing || r.date > existing.date) latestCalibrationByEquipment[r.equipmentName] = r;
    });
  const overdueCalibrations = Object.values(latestCalibrationByEquipment).filter((r) => r.dueDate && r.dueDate < today());

  const latestMaintenanceByEquipment = {};
  records
    .filter((r) => r.category === "maintenance" && r.equipmentName)
    .forEach((r) => {
      const existing = latestMaintenanceByEquipment[r.equipmentName];
      if (!existing || r.date > existing.date) latestMaintenanceByEquipment[r.equipmentName] = r;
    });
  const overdueMaintenance = Object.values(latestMaintenanceByEquipment).filter((r) => r.dueDate && r.dueDate < today());

  const latestContractorVisit = records
    .filter((r) => r.category === "Pest control — contractor visit")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const contractorVisitOverdue = latestContractorVisit && latestContractorVisit.dueDate && latestContractorVisit.dueDate < today();

  // Unlike internal audit or water testing, verifier visit frequency is
  // genuinely risk-based and set by the verifier themselves — so this
  // only flags overdue against a date you were actually told, never a
  // default cadence invented here. Never-logged doesn't count as overdue.
  const latestVerifierVisit = records
    .filter((r) => r.category === "Verifier visit")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const verifierVisitOverdue = latestVerifierVisit && latestVerifierVisit.dueDate && latestVerifierVisit.dueDate < today();

  // Monthly cadence — direct advice from a food safety inspector, not a
  // fixed MPI number. Per station, since the whole point is that every
  // station gets checked, not just whichever one was easiest.
  const overduePestStations = pestStations.filter((s) => {
    if (!s.active) return false;
    const lastCheck = records.filter((r) => r.category === "Pest control" && r.stationId === s.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    return !lastCheck || daysBetween(lastCheck.date, today()) > 30;
  });

  // MPI leaves the interval to the business's own judgement rather than
  // mandating a number — annual is the common real-world default.
  const staffTrainingNames = [...new Set(records.filter((r) => r.category === "training" && r.staffName).map((r) => r.staffName))];
  const staffDueForRefresher = staffTrainingNames.filter((name) => {
    const latestByTopic = {};
    records.filter((r) => r.category === "training" && r.staffName === name).forEach((r) => {
      if (!latestByTopic[r.topic] || r.date > latestByTopic[r.topic]) latestByTopic[r.topic] = r.date;
    });
    return Object.values(latestByTopic).some((date) => daysBetween(date, today()) > 365);
  });

  // Legally required at least every 12 months since 1 July 2023 (Food
  // Regulations 2015, under a National Programme) — never done at all
  // counts as overdue too, not just "over a year since the last one".
  const latestMockRecall = records.filter((r) => r.category === "recall").sort((a, b) => b.date.localeCompare(a.date))[0];
  const mockRecallOverdue = !latestMockRecall || daysBetween(latestMockRecall.date, today()) > 365;

  // Quarterly is a chosen cadence, not an MPI-mandated one — never done
  // at all counts as overdue, same logic as the mock recall check above.
  const latestInternalAudit = records.filter((r) => r.category === "Internal audit").sort((a, b) => b.date.localeCompare(a.date))[0];
  const internalAuditOverdue = !latestInternalAudit || (latestInternalAudit.dueDate && latestInternalAudit.dueDate < today());

  // Same honesty as internal audit — no MPI-mandated interval for water
  // testing exists, quarterly is just a sensible chosen default, computed
  // from the last logged test the same way pest control checks are.
  const latestWaterTest = records.filter((r) => r.category === "water").sort((a, b) => b.date.localeCompare(a.date))[0];
  const waterTestOverdue = !latestWaterTest || daysBetween(latestWaterTest.date, today()) > 91;

  const totalOpenItems = overdueChecklists.length + openCorrectiveActions.length + overdueCalibrations.length + overdueMaintenance.length + (contractorVisitOverdue ? 1 : 0) + (mockRecallOverdue ? 1 : 0) + (internalAuditOverdue ? 1 : 0) + overduePestStations.length + staffDueForRefresher.length + (waterTestOverdue ? 1 : 0) + (verifierVisitOverdue ? 1 : 0);

  return (
    <>
    <div>
      <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5, marginBottom: 18 }}>
        Based on MPI's National Programme 3 (Dec 2025) — the food safety framework for breweries under the Food Act
        2014. Records are kept here for at least 4 years, as required.
      </div>

      {totalOpenItems > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#B5502F", marginBottom: 10 }}>
            Needs attention ({totalOpenItems})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdueChecklists.map((c) => (
              <button
                key={c.key}
                onClick={() => onStartChecklist(c.template)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>{c.template.label}</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {c.latest ? `last done ${c.since}d ago` : "never done"}
                </span>
              </button>
            ))}
            {overdueCalibrations.map((r) => (
              <button
                key={r.equipmentName}
                onClick={() => onStartCalibration()}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>{r.equipmentName} calibration overdue</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>was due {r.dueDate}</span>
              </button>
            ))}
            {overdueMaintenance.map((r) => (
              <button
                key={r.equipmentName}
                onClick={() => onStartMaintenance()}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>{r.equipmentName} maintenance overdue</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>was due {r.dueDate}</span>
              </button>
            ))}
            {contractorVisitOverdue && (
              <button
                onClick={onLogContractorVisit}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>Pest contractor visit overdue</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>was due {latestContractorVisit.dueDate}</span>
              </button>
            )}
            {mockRecallOverdue && (
              <button
                onClick={onStartMockRecall}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>Simulated recall overdue — legally required every 12 months</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {latestMockRecall ? `last done ${latestMockRecall.date}` : "never done"}
                </span>
              </button>
            )}
            {internalAuditOverdue && (
              <button
                onClick={onStartInternalAudit}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>Internal audit due — quarterly</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {latestInternalAudit ? `last done ${latestInternalAudit.date}` : "never done"}
                </span>
              </button>
            )}
            {overduePestStations.length > 0 && (
              <button
                onClick={onLogPestCheck}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>
                  {overduePestStations.length} pest station{overduePestStations.length !== 1 ? "s" : ""} overdue — monthly checks
                </span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {overduePestStations.map((s) => s.label).join(", ")}
                </span>
              </button>
            )}
            {staffDueForRefresher.length > 0 && (
              <button
                onClick={() => onOpenStaff(staffDueForRefresher[0])}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>
                  {staffDueForRefresher.length} staff member{staffDueForRefresher.length !== 1 ? "s" : ""} due for a training refresher
                </span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {staffDueForRefresher.join(", ")}
                </span>
              </button>
            )}
            {waterTestOverdue && (
              <button
                onClick={() => onStartNote("water", "Log water test")}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>Water test due — quarterly</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {latestWaterTest ? `last done ${latestWaterTest.date}` : "never done"}
                </span>
              </button>
            )}
            {verifierVisitOverdue && (
              <button
                onClick={onLogVerifierVisit}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>Verifier visit overdue</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  was due {latestVerifierVisit.dueDate}
                </span>
              </button>
            )}
            {openCorrectiveActions.map((r) => {
              const daysOpen = daysBetween(r.date, today());
              const urgentColor = daysOpen >= 30 ? "#B5502F" : daysOpen >= 7 ? "#7A3E1D" : "#9B7A3E";
              return (
                <div
                  key={r.id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: "#7A3E1D", fontSize: 13.5 }}>{r.correctiveAction}</div>
                    <div style={{ color: urgentColor, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", fontWeight: daysOpen >= 30 ? 700 : 400 }}>
                      Open {daysOpen} day{daysOpen !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => onResolveCorrectiveAction(r.id)}
                    style={{ flexShrink: 0, background: "#FFFFFF", border: "1px solid #E3B37A", borderRadius: 5, padding: "6px 10px", color: "#7A3E1D", fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: "pointer" }}
                  >
                    Mark resolved
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                // MPI leaves the refresher interval to the business's own
                // judgement ("whenever you think staff need it") rather
                // than mandating a number — annual is the common
                // real-world default, tracked per topic per person here.
                const latestByTopic = {};
                staffRecords.forEach((r) => {
                  if (!latestByTopic[r.topic] || r.date > latestByTopic[r.topic]) latestByTopic[r.topic] = r.date;
                });
                const overdueTopics = Object.entries(latestByTopic).filter(([, date]) => daysBetween(date, today()) > 365);
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
                      border: `1px solid ${overdueTopics.length > 0 ? "#E3B37A" : "#DDE0C8"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div>
                      <span style={{ color: "#2A3324", fontSize: 13.5 }}>{name}</span>
                      {overdueTopics.length > 0 && (
                        <div style={{ color: "#B5502F", fontSize: 11 }}>
                          {overdueTopics.length} topic{overdueTopics.length !== 1 ? "s" : ""} due for refresher
                        </div>
                      )}
                    </div>
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
        <button onClick={onStartMaintenance} style={secondaryBtnStyle}>Log equipment maintenance</button>
        <button onClick={onStartTraining} style={secondaryBtnStyle}>Staff training</button>
        <button onClick={() => onStartNote("water", "Log water test")} style={secondaryBtnStyle}>Water test</button>
        <button onClick={onStartMockRecall} style={secondaryBtnStyle}>Mock recall</button>
        <button onClick={onStartIllness} style={{ ...secondaryBtnStyle, background: "#FBE5DC", borderColor: "#E3B3A0", color: "#B5502F" }}>Staff sickness</button>
        <button onClick={onLogPestCheck} style={secondaryBtnStyle}>Log pest check</button>
        <button onClick={onManagePestStations} style={secondaryBtnStyle}>Pest stations ({pestStations.filter((s) => s.active).length})</button>
        <button onClick={onLogContractorVisit} style={secondaryBtnStyle}>Log contractor visit</button>
        <button onClick={onStartInternalAudit} style={secondaryBtnStyle}>Internal audit</button>
        <button onClick={onLogVerifierVisit} style={secondaryBtnStyle}>Log verifier visit</button>
        <button onClick={onLogComplaint} style={secondaryBtnStyle}>Log complaint</button>
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
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#2A3324", fontSize: 13.5 }}>{s.name}</span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontFamily: "'Inter', sans-serif",
                      color: s.approved ? "#3F6B32" : "#B5502F",
                      background: s.approved ? "#EAF2E4" : "#FBE5D2",
                      border: `1px solid ${s.approved ? "#8FB86C" : "#E3B37A"}`,
                      borderRadius: 10,
                      padding: "1px 8px",
                    }}
                  >
                    {s.approved ? "Approved" : "Not approved"}
                  </span>
                </span>
                <span style={{ color: "#9BA88A", fontSize: 11.5 }}>Documents →</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>
          History ({filteredRecords.length})
        </div>
        <button
          onClick={() => setShowAuditReport(true)}
          style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "5px 10px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: "pointer" }}
        >
          <FileText size={12} /> Export audit report
        </button>
      </div>
      {onShareWithAuditor && (
        <button
          onClick={onShareWithAuditor}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", marginBottom: 10, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
        >
          <Users size={13} /> Share with auditor (read-only link)
        </button>
      )}
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
                {r.category === "checklist" && `${r.frequency === "label" ? `Label check${r.topic ? `: ${r.topic}` : ""} — ` : ""}${checkedCount}/${r.items.length} items checked${r.notes ? ` — ${r.notes}` : ""}`}
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
                {r.category === "Pest control" &&
                  (() => {
                    const level = PEST_ACTIVITY_OPTIONS.find(([key]) => key === r.pestActivity);
                    return (
                      <>
                        {level && (
                          <span style={{ color: level[2], border: `1px solid ${level[2]}`, borderRadius: 20, padding: "1px 8px", fontSize: 11, marginRight: 6 }}>
                            {level[1]}
                          </span>
                        )}
                        {r.notes || "—"}
                        {r.correctiveAction && (
                          <div style={{ color: r.correctiveActionResolved ? "#5C9A3C" : "#B5502F", marginTop: 3 }}>
                            Action: {r.correctiveAction}{!r.correctiveActionResolved && " (open)"}
                          </div>
                        )}
                        {r.photoUrl && <img src={r.photoUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, marginTop: 5 }} />}
                      </>
                    );
                  })()}
                {r.category === "Pest control — contractor visit" && (
                  <>
                    {r.completedBy} — {r.notes || "no findings noted"}
                    {r.dueDate && <div style={{ color: "#9BA88A", marginTop: 3 }}>Next visit due {r.dueDate}</div>}
                    {r.photoUrl && <img src={r.photoUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, marginTop: 5 }} />}
                  </>
                )}
                {r.category === "Internal audit" && (
                  <>
                    <div style={{ whiteSpace: "pre-line" }}>{r.notes}</div>
                    {r.dueDate && <div style={{ color: "#9BA88A", marginTop: 5 }}>Next internal audit due {r.dueDate}</div>}
                  </>
                )}
                {r.category === "Verifier visit" && (
                  <>
                    {r.completedBy} — {r.notes || "no findings noted"}
                    {r.correctiveAction && <div style={{ color: "#B5502F", marginTop: 3 }}>Non-conformance: {r.correctiveAction}</div>}
                    {r.dueDate && <div style={{ color: "#9BA88A", marginTop: 3 }}>Next visit due {r.dueDate}</div>}
                    {r.photoUrl && <img src={r.photoUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, marginTop: 5 }} />}
                  </>
                )}
                {r.category === "Complaint" && (
                  <>
                    {r.completedBy}{r.batchName ? ` — ${r.batchName}` : ""}
                    <div style={{ marginTop: 3 }}>{r.notes}</div>
                    {r.correctiveAction && <div style={{ color: "#B5502F", marginTop: 3 }}>Action taken: {r.correctiveAction}</div>}
                  </>
                )}
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
    {showAuditReport && (
      <FoodSafetyAuditReport records={filteredRecords} monthFilter={monthFilter} companyName={companyName} onClose={() => setShowAuditReport(false)} />
    )}
    </>
  );
}

export const AUDIT_AREAS = [
  "Checklists being completed on schedule",
  "Calibration records up to date",
  "Staff training current for all active staff",
  "Water testing up to date",
  "Pest control — stations checked regularly, contractor visits current",
  "Simulated recall done within the last 12 months",
  "Spot-checked traceability — could trace a lot end to end",
  "All corrective actions closed out or genuinely being actioned",
  "Records complete, accurate, and easy to find",
];

// A full review of the whole food safety system, not just one area —
// quarterly is the common real-world benchmark (not an MPI-mandated
// number, since NP3 itself just says "regularly"), so that's the
// default cadence this drives the overdue tracking from.
export function InternalAuditModal({ onClose, onSave }) {
  const [auditedBy, setAuditedBy] = useState("");
  const [date, setDate] = useState(today());
  const [results, setResults] = useState(() => {
    const initial = {};
    AUDIT_AREAS.forEach((_, i) => {
      initial[i] = "pass";
    });
    return initial;
  });
  const [notesByArea, setNotesByArea] = useState({});
  const [correctiveAction, setCorrectiveAction] = useState("");
  const nextAuditDue = addDays(date, 91);

  const setResult = (i, value) => setResults((prev) => ({ ...prev, [i]: value }));
  const hasIssues = Object.values(results).some((r) => r === "issue");

  const submit = () => {
    if (!auditedBy.trim()) return;
    if (hasIssues && !correctiveAction.trim()) return;
    const notes = AUDIT_AREAS.map(
      (area, i) => `${results[i] === "issue" ? "⚠ " : "✓ "}${area}${notesByArea[i] ? ` — ${notesByArea[i]}` : ""}`
    ).join("\n");
    onSave({
      category: "Internal audit",
      date,
      completedBy: auditedBy.trim(),
      notes,
      dueDate: nextAuditDue,
      correctiveAction: hasIssues ? correctiveAction.trim() : null,
      correctiveActionResolved: !hasIssues,
    });
    onClose();
  };

  return (
    <Modal title="Internal audit" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          A full review of your own food safety system — best practice is for this to be done by someone other than whoever's directly responsible for the area being checked.
        </div>
        <TextField label="Audited by" value={auditedBy} onChange={setAuditedBy} placeholder="Your name" />
        <TextField label="Date" type="date" value={date} onChange={setDate} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {AUDIT_AREAS.map((area, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ color: "#2A3324", fontSize: 13, flex: 1 }}>{area}</span>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setResult(i, "pass")}
                    style={{ background: results[i] === "pass" ? "#5C9A3C" : "#FFFFFF", border: `1px solid ${results[i] === "pass" ? "#5C9A3C" : "#DDE0C8"}`, borderRadius: 20, padding: "4px 10px", color: results[i] === "pass" ? "#16191A" : "#5C6B54", fontSize: 11.5, cursor: "pointer" }}
                  >
                    Pass
                  </button>
                  <button
                    onClick={() => setResult(i, "issue")}
                    style={{ background: results[i] === "issue" ? "#B5502F" : "#FFFFFF", border: `1px solid ${results[i] === "issue" ? "#B5502F" : "#DDE0C8"}`, borderRadius: 20, padding: "4px 10px", color: results[i] === "issue" ? "#FFFFFF" : "#5C6B54", fontSize: 11.5, cursor: "pointer" }}
                  >
                    Issue
                  </button>
                </div>
              </div>
              {results[i] === "issue" && (
                <input
                  type="text"
                  value={notesByArea[i] || ""}
                  onChange={(e) => setNotesByArea((prev) => ({ ...prev, [i]: e.target.value }))}
                  placeholder="What's wrong"
                  style={{ width: "100%", boxSizing: "border-box", marginTop: 8, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "7px 9px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5 }}
                />
              )}
            </div>
          ))}
        </div>
        {hasIssues && (
          <TextField
            label="Corrective action (required — at least one issue found)"
            value={correctiveAction}
            onChange={setCorrectiveAction}
            placeholder="What will be done about it"
          />
        )}
        <div style={{ color: "#9BA88A", fontSize: 11.5 }}>Next internal audit due: {nextAuditDue} (quarterly)</div>
        <button
          onClick={submit}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "0.03em", cursor: "pointer" }}
        >
          Save internal audit
        </button>
      </div>
    </Modal>
  );
}

export const RECALL_MANUAL_STEPS = [
  "Notify staff involved in production, sales, and distribution — invite them to take part in the exercise",
  "Carry out a risk assessment for the scenario (MPI's Risk Assessment form, labelled SIMULATED RECALL)",
  "Identify where affected stock would be held securely in a real recall (locked or taped-off area)",
  "Hold a review — what went well, what didn't, any gaps or staff training needs",
];

// Walks through MPI's actual simulated-recall process: pick a scenario,
// auto-trace who's affected (reusing the same logic as the Traceability
// report), draft — never send — notifications, then the handful of
// steps that genuinely need a human. Saved as a real Food Safety record
// so it's on hand for the next verifier visit.
export function MockRecallModal({ inventory, batches, salesOrders, mixedPackAssemblies, customers, onClose, onSave }) {
  const [step, setStep] = useState(1);
  const [scenario, setScenario] = useState("");
  const [itemId, setItemId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [manualChecked, setManualChecked] = useState(() => new Set());
  const [reviewNotes, setReviewNotes] = useState("");
  const [completedBy, setCompletedBy] = useState("");
  const [recallDate, setRecallDate] = useState(today());

  const item = inventory.find((it) => it.id === itemId);
  const lots = item ? [...new Map((item.lots || []).map((l) => [l.lotNumber, l])).values()] : [];
  const trace = item && lotNumber ? traceLot(item, lotNumber, batches, salesOrders, mixedPackAssemblies, customers) : [];
  const affectedBatches = trace.map((t) => t.batch.name);
  const affectedCustomers = [
    ...new Set([
      ...trace.flatMap((t) => t.directOrders.map((d) => d.customer?.name).filter(Boolean)),
      ...trace.flatMap((t) => t.packOrders.map((d) => d.customer?.name).filter(Boolean)),
    ]),
  ];

  const toggleManual = (i) =>
    setManualChecked((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const customerDraft = `SIMULATED RECALL — DO NOT SEND

Subject: Important product notice — ${item?.name || "[ingredient]"} — ${scenario || "[scenario]"}

We are writing to inform you, as part of a routine simulated recall exercise, that the following product(s) would be affected under this scenario: ${affectedBatches.join(", ") || "[none traced]"}.

In a real recall, this notice would detail the issue, the action we're taking, and what you should do with any affected stock. No action is required — this is a practice exercise only.`;

  const verifierDraft = `SIMULATED RECALL — DO NOT SEND

To: [Verifier / New Zealand Food Safety]
Re: Simulated recall exercise — ${recallDate}

Scenario: ${scenario || "[scenario]"}
Affected lot: ${lotNumber || "[lot]"} (${item?.name || "[ingredient]"})
Batches traced: ${affectedBatches.join(", ") || "[none]"}
Customers who received affected product: ${affectedCustomers.join(", ") || "[none]"}

This exercise tested our ability to trace and identify affected product using our records. Findings and any improvements identified are recorded separately.`;

  const submit = () => {
    if (!completedBy.trim()) return;
    const notes = [
      `Scenario: ${scenario.trim() || "not specified"}`,
      `Traced: ${item?.name || "—"}, lot ${lotNumber || "—"}`,
      `Batches affected: ${affectedBatches.join(", ") || "none"}`,
      `Customers affected: ${affectedCustomers.join(", ") || "none"}`,
      `Manual steps completed: ${manualChecked.size}/${RECALL_MANUAL_STEPS.length}`,
      reviewNotes.trim() ? `Review notes: ${reviewNotes.trim()}` : "",
    ].filter(Boolean).join("\n");
    onSave({ category: "recall", date: recallDate, notes, completedBy: completedBy.trim(), correctiveActionResolved: true });
    onClose();
  };

  return (
    <Modal title={`Simulated recall — step ${step} of 4`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {step === 1 && (
          <>
            <div style={{ color: "#5C6B54", fontSize: 13 }}>
              Pick a scenario that could actually happen — MPI suggests things like a contaminated ingredient lot, an undeclared allergen, or a customer complaint about a foreign object.
            </div>
            <TextField label="Scenario" value={scenario} onChange={setScenario} placeholder="e.g. Contaminated hop lot — suspected mould" />
            <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 4 }}>Which ingredient lot are we simulating as affected?</div>
            <div style={{ display: "flex", gap: 10 }}>
              <select value={itemId} onChange={(e) => { setItemId(e.target.value); setLotNumber(""); }} style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>
                <option value="">Choose an ingredient…</option>
                {inventory.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
              <select value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} disabled={!item} style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}>
                <option value="">Choose a lot…</option>
                {lots.map((l) => <option key={l.lotNumber} value={l.lotNumber}>{l.lotNumber}</option>)}
              </select>
            </div>
            <button
              onClick={() => setStep(2)}
              disabled={!scenario.trim() || !lotNumber}
              style={{ background: scenario.trim() && lotNumber ? "#5C9A3C" : "#E8E4D4", border: "none", borderRadius: 5, padding: "12px", color: scenario.trim() && lotNumber ? "#16191A" : "#A3AC94", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: scenario.trim() && lotNumber ? "pointer" : "default" }}
            >
              Trace affected product →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ color: "#5C6B54", fontSize: 13 }}>
              Traced automatically from your records — this is the step that takes the longest in a real recall.
            </div>
            {trace.length === 0 ? (
              <div style={{ color: "#9BA88A", fontSize: 13 }}>This lot hasn't been used in any batch — nothing to trace for this scenario.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {trace.map(({ batch, directOrders, packOrders }) => (
                  <div key={batch.id} style={{ padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, fontSize: 13 }}>
                    <div style={{ color: "#2A3324", fontWeight: 500 }}>{batch.name} (#{batch.number})</div>
                    <div style={{ color: "#9BA88A", fontSize: 11.5 }}>
                      {directOrders.length + packOrders.length === 0 ? "Not yet sold" : `${directOrders.length + packOrders.length} order(s) affected`}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep(1)} style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "12px 16px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 14, cursor: "pointer" }}>← Back</button>
              <button onClick={() => setStep(3)} style={{ flex: 1, background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: "pointer" }}>Draft notifications →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ color: "#B5502F", fontSize: 12.5, fontWeight: 500 }}>
              Drafts only — nothing here is ever sent automatically. Copy these to show your verifier, don't email them out.
            </div>
            <div>
              <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Draft customer notification</div>
              <textarea readOnly value={customerDraft} style={{ width: "100%", boxSizing: "border-box", minHeight: 130, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: 10, color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }} />
            </div>
            <div>
              <div style={{ color: "#9BA88A", fontSize: 11, marginBottom: 4 }}>Draft verifier / NZ Food Safety notification</div>
              <textarea readOnly value={verifierDraft} style={{ width: "100%", boxSizing: "border-box", minHeight: 130, background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: 10, color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5 }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep(2)} style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "12px 16px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 14, cursor: "pointer" }}>← Back</button>
              <button onClick={() => setStep(4)} style={{ flex: 1, background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: "pointer" }}>Remaining steps →</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ color: "#5C6B54", fontSize: 13 }}>These need a real person — tick them off as your team works through them.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {RECALL_MANUAL_STEPS.map((s, i) => (
                <label key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, cursor: "pointer" }}>
                  <input type="checkbox" checked={manualChecked.has(i)} onChange={() => toggleManual(i)} style={{ width: 16, height: 16, marginTop: 1, accentColor: "#5C9A3C", cursor: "pointer" }} />
                  <span style={{ color: "#2A3324", fontSize: 13 }}>{s}</span>
                </label>
              ))}
            </div>
            <TextField label="Review notes (optional)" value={reviewNotes} onChange={setReviewNotes} placeholder="What went well, what to improve next time" />
            <TextField label="Completed by" value={completedBy} onChange={setCompletedBy} placeholder="Your name" />
            <BackdateField value={recallDate} onChange={setRecallDate} label="Date of the exercise" />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep(3)} style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "12px 16px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 14, cursor: "pointer" }}>← Back</button>
              <button
                onClick={submit}
                disabled={!completedBy.trim()}
                style={{ flex: 1, background: completedBy.trim() ? "#5C9A3C" : "#E8E4D4", border: "none", borderRadius: 5, padding: "12px", color: completedBy.trim() ? "#16191A" : "#A3AC94", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: completedBy.trim() ? "pointer" : "default" }}
              >
                Save mock recall record
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
