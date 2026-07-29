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
} from "./lib/mappers";

const STAGES = ["Brewing", "Primary", "Secondary", "Conditioning", "Packaged"];

const STAGE_COLOR = {
  Brewing: "#8A6A3D",
  Primary: "#C17A3D",
  Secondary: "#B8925A",
  Conditioning: "#D4A24C",
  Packaged: "#5C6B63",
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
      <path d="M9 5 H29 V23 L19 34 L9 23 Z" stroke="#C17A3D" strokeWidth="2.2" strokeLinejoin="round" />
      {/* Liquid fill */}
      <g clipPath="url(#bp-tank-clip)">
        <rect x="7" y="16" width="24" height="20" fill="#C17A3D" opacity="0.32" />
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
const CATEGORIES = ["Grain", "Hops", "Yeast", "Other"];

const CATEGORY_COLOR = {
  Grain: "#C17A3D",
  Hops: "#7FA35C",
  Yeast: "#B8925A",
  Other: "#5C6B63",
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
          stroke="#3A413D"
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
        background: "#1F2422",
        border: "1px solid #2C332F",
        borderRadius: 6,
        padding: "16px 18px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A5650")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2C332F")}
    >
      <Tank batch={batch} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                color: "#5C6B63",
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
                color: "#EDE7D9",
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
        <div style={{ color: "#8A9591", fontSize: 13, marginTop: 2 }}>
          {batch.style}{batch.tankName ? ` · ${batch.tankName}` : ""}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#B8C0BC" }}>
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
              <div style={{ height: 5, background: "#2C332F", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pctPackaged}%`,
                    background: rem > 0 ? "#D4A24C" : "#7FA35C",
                    borderRadius: 3,
                  }}
                />
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#5C6B63", marginTop: 5 }}>
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

function InventoryItemCard({ item, onAdjust }) {
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
  const displayQty = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "#1F2422",
        border: `1px solid ${low ? "#6B4A2F" : "#2C332F"}`,
        borderRadius: 6,
        padding: "13px 16px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 16,
              color: "#EDE7D9",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.name}
          </h3>
          {low && <AlertTriangle size={13} color="#C17A3D" />}
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
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "#5C6B63" }}>
              · lot {item.lots[item.lots.length - 1].lotNumber}
              {item.lots.length > 1 ? ` (+${item.lots.length - 1})` : ""}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          onClick={() => onAdjust(item.id, -step)}
          aria-label={`Remove ${step} ${item.unit} of ${item.name}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: "#242B27",
            border: "1px solid #3A413D",
            color: "#EDE7D9",
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
            color: low ? "#C17A3D" : "#EDE7D9",
            width: 68,
            textAlign: "center",
          }}
        >
          {displayQty} {item.unit}
        </span>
        <button
          onClick={() => onAdjust(item.id, step)}
          aria-label={`Add ${step} ${item.unit} of ${item.name}`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: "#242B27",
            border: "1px solid #3A413D",
            color: "#EDE7D9",
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

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#16191A",
          border: "1px solid #2C332F",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#EDE7D9",
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
  const [rows, setRows] = useState([{ id: uid(), name: "Tank 1", capacity: 20 }]);

  const applyCount = (raw) => {
    const num = Math.max(1, Math.min(50, parseInt(raw, 10) || 1));
    setRows((prev) => {
      if (num === prev.length) return prev;
      if (num < prev.length) return prev.slice(0, num);
      const next = [...prev];
      const lastCapacity = prev[prev.length - 1]?.capacity ?? 20;
      while (next.length < num) {
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
          value={rows.length}
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
                background: "#16191A",
                border: "1px solid #2C332F",
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
            background: "#C17A3D",
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
        <div style={{ color: "#5C6B63", fontSize: 12 }}>
          Renaming won't retroactively update batches already assigned to this tank — reassign them from the batch's page if needed.
        </div>
        <button
          onClick={submit}
          style={{
            marginTop: 4,
            background: "#C17A3D",
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

function ConfirmDeleteTankModal({ tank, onClose, onConfirm }) {
  return (
    <Modal title={`Delete ${tank.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#8A9591", fontSize: 13 }}>
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
            color: "#EDE7D9",
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

function AssignTankModal({ batch, tanks, onClose, onSave }) {
  const [tankId, setTankId] = useState(batch.tankId || "");

  const submit = () => {
    const tank = tanks.find((t) => t.id === tankId) || null;
    onSave(batch.id, tank);
    onClose();
  };

  return (
    <Modal title={`Assign tank — ${batch.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>Tank</span>
          <select
            value={tankId}
            onChange={(e) => setTankId(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#16191A",
              border: "1px solid #2C332F",
              borderRadius: 4,
              padding: "9px 10px",
              color: "#EDE7D9",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          >
            <option value="">Unassigned</option>
            {tanks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.capacity}L)
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={submit}
          style={{
            background: "#C17A3D",
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

function AddInventoryModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Grain");
  const [qty, setQty] = useState(10);
  const [unit, setUnit] = useState("kg");
  const [threshold, setThreshold] = useState(5);

  const submit = () => {
    if (!name.trim()) return;
    onAdd({
      id: uid(),
      name: name.trim(),
      category,
      qty: Number(qty) || 0,
      unit,
      threshold: Number(threshold) || 0,
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
        <button
          onClick={submit}
          style={{
            marginTop: 8,
            background: "#C17A3D",
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
  const color = status === "Received" ? "#7FA35C" : "#C17A3D";
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
        background: "#1F2422",
        border: "1px solid #2C332F",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A5650")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2C332F")}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", fontSize: 13 }}>{po.poNumber}</span>
          <h3
            style={{
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 16,
              color: "#EDE7D9",
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {po.supplier}
          </h3>
        </div>
        <div style={{ color: "#8A9591", fontSize: 12.5, marginTop: 3 }}>
          {po.lines.length} item{po.lines.length !== 1 ? "s" : ""} · ordered {po.orderDate.slice(5)}
        </div>
      </div>
      <POStatusPill status={po.status} />
    </button>
  );
}

function AddPOModal({ onClose, onAdd, nextPONumber }) {
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState([{ id: uid(), name: "", category: "Grain", qty: 1, unit: "kg", lotNumber: "" }]);

  const updateLine = (id, patch) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () =>
    setLines((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 1, unit: "kg", lotNumber: "" }]);

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
      status: "Ordered",
      lines: cleanLines.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
    });
    onClose();
  };

  return (
    <Modal title="New purchase order" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Supplier" value={supplier} onChange={setSupplier} />

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591", marginTop: 4 }}>
          Line items
        </div>
        {lines.map((line, i) => (
          <div
            key={line.id}
            style={{
              background: "#16191A",
              border: "1px solid #2C332F",
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
                  color: "#8A9591",
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
              <TextField label="Lot / batch #" value={line.lotNumber} onChange={(v) => updateLine(line.id, { lotNumber: v })} />
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
            border: "1px dashed #3A413D",
            borderRadius: 5,
            padding: "9px",
            color: "#8A9591",
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
            background: "#C17A3D",
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

function PODetail({ po, onBack, onReceive }) {
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
          color: "#8A9591",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All orders
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", fontSize: 13 }}>{po.poNumber}</div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#EDE7D9", margin: "2px 0 6px", fontWeight: 500 }}>
            {po.supplier}
          </h1>
        </div>
        <POStatusPill status={po.status} />
      </div>
      <div style={{ color: "#8A9591", fontSize: 13, marginBottom: 22 }}>
        Ordered {po.orderDate}
        {po.receivedDate ? ` · Received ${po.receivedDate}` : ""}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
        Line items
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24 }}>
        {po.lines.map((l) => (
          <div
            key={l.id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "10px 12px",
              background: "#1B1F1D",
              border: "1px solid #262C29",
              borderRadius: 5,
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, color: "#EDE7D9", fontFamily: "'Inter', sans-serif" }}>{l.name}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[l.category], fontSize: 11 }}>
              {l.category}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#EDE7D9", width: 64, textAlign: "right", flexShrink: 0 }}>
              {l.qty} {l.unit}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", width: 90, flexShrink: 0, textAlign: "right" }}>
              {l.lotNumber || "no lot #"}
            </span>
          </div>
        ))}
      </div>

      {po.status === "Ordered" && (
        <button
          onClick={() => onReceive(po.id)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#C17A3D",
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
        background: "#1F2422",
        border: "1px solid #2C332F",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A5650")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2C332F")}
    >
      <div style={{ minWidth: 0 }}>
        <h3
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 17,
            color: "#EDE7D9",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {recipe.name}
        </h3>
        <div style={{ color: "#8A9591", fontSize: 12.5, marginTop: 3 }}>
          {recipe.style} · {recipe.volume}L · {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? "s" : ""}
        </div>
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", fontSize: 12.5, flexShrink: 0 }}>
        OG {recipe.og.toFixed(3)}
      </span>
    </button>
  );
}

function AddRecipeModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [volume, setVolume] = useState(20);
  const [og, setOg] = useState(1.05);
  const [fg, setFg] = useState(1.01);
  const [ingredients, setIngredients] = useState([{ id: uid(), name: "", category: "Grain", qty: 1, unit: "kg" }]);

  const updateLine = (id, patch) =>
    setIngredients((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () =>
    setIngredients((prev) => [...prev, { id: uid(), name: "", category: "Grain", qty: 1, unit: "kg" }]);

  const removeLine = (id) => setIngredients((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const submit = () => {
    const clean = ingredients.filter((l) => l.name.trim());
    if (!name.trim() || clean.length === 0) return;
    onAdd({
      id: uid(),
      name: name.trim(),
      style: style.trim() || "Unspecified",
      volume: Number(volume) || 0,
      og: Number(og),
      fg: Number(fg),
      ingredients: clean.map((l) => ({ ...l, name: l.name.trim(), qty: Number(l.qty) || 0 })),
    });
    onClose();
  };

  return (
    <Modal title="New recipe" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Recipe name" value={name} onChange={setName} />
        <TextField label="Style" value={style} onChange={setStyle} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Batch volume" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          <NumberField label="Target OG" value={og} onChange={setOg} step="0.001" />
          <NumberField label="Target FG" value={fg} onChange={setFg} step="0.001" />
        </div>

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591", marginTop: 4 }}>
          Ingredients
        </div>
        {ingredients.map((line, i) => (
          <div
            key={line.id}
            style={{
              background: "#16191A",
              border: "1px solid #2C332F",
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
                  color: "#8A9591",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            <div style={{ marginBottom: 10 }}>
              <TextField label={`Ingredient ${i + 1}`} value={line.name} onChange={(v) => updateLine(line.id, { name: v })} />
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
            border: "1px dashed #3A413D",
            borderRadius: 5,
            padding: "9px",
            color: "#8A9591",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <Plus size={14} /> Add ingredient
        </button>

        <button
          onClick={submit}
          style={{
            marginTop: 4,
            background: "#C17A3D",
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
          Save recipe
        </button>
      </div>
    </Modal>
  );
}

function RecipeDetail({ recipe, inventory, onBack, onBrew }) {
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
          color: "#8A9591",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All recipes
      </button>

      <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#EDE7D9", margin: "2px 0 6px", fontWeight: 500 }}>
        {recipe.name}
      </h1>
      <div style={{ color: "#8A9591", fontSize: 14, marginBottom: 20 }}>
        {recipe.style} · {recipe.volume}L · OG {recipe.og.toFixed(3)} → FG {recipe.fg.toFixed(3)}
      </div>

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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
                background: "#1B1F1D",
                border: `1px solid ${short ? "#6B4A2F" : "#262C29"}`,
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, color: "#EDE7D9", fontFamily: "'Inter', sans-serif" }}>{ing.name}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[ing.category], fontSize: 11 }}>
                {ing.category}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#EDE7D9", width: 64, textAlign: "right", flexShrink: 0 }}>
                {ing.qty} {ing.unit}
              </span>
              {short && <AlertTriangle size={13} color="#C17A3D" />}
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
            color: "#C17A3D",
            fontSize: 12.5,
            marginBottom: 14,
            background: "#241D14",
            border: "1px solid #4A3420",
            borderRadius: 5,
            padding: "8px 12px",
          }}
        >
          <AlertTriangle size={14} />
          Short on {shortages.length} ingredient{shortages.length !== 1 ? "s" : ""} — you can still brew, but stock will go negative-adjusted to zero.
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
          background: "#C17A3D",
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
    </div>
  );
}

function NumberField({ label, value, onChange, step = "any", suffix }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#16191A",
            border: "1px solid #2C332F",
            borderRadius: 4,
            padding: "9px 10px",
            color: "#EDE7D9",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
          }}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 10, top: 9, color: "#5C6B63", fontSize: 12 }}>{suffix}</span>
        )}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#16191A",
          border: "1px solid #2C332F",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#EDE7D9",
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
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1B1F1D",
          border: "1px solid #2C332F",
          borderBottom: "none",
          borderRadius: "10px 10px 0 0",
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          overflowY: "auto",
          padding: "20px 22px 26px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#EDE7D9", margin: 0, fontWeight: 500 }}>
            {title}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A9591", cursor: "pointer", padding: 4 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AddBatchModal({ onClose, onAdd, nextNumber, recipes, presetRecipe, tanks }) {
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
    }
  };

  const submit = () => {
    if (!name.trim()) return;
    const tank = tanks.find((t) => t.id === tankId) || null;
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
      tankId: tank ? tank.id : null,
      tankName: tank ? tank.name : null,
      ingredients: activeRecipe ? activeRecipe.ingredients : [],
      readings: [{ id: uid(), date: today(), gravity: Number(og), temp: Number(temp), note: "Brew day, pitched yeast" }],
    });
    onClose();
  };

  return (
    <Modal title="New Batch" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {recipes.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>
              Base on recipe (optional)
            </span>
            <select
              value={recipeId}
              onChange={(e) => applyRecipe(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#16191A",
                border: "1px solid #2C332F",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#EDE7D9",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            >
              <option value="">None — start from scratch</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {tanks.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>
              Tank (optional)
            </span>
            <select
              value={tankId}
              onChange={(e) => setTankId(e.target.value)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#16191A",
                border: "1px solid #2C332F",
                borderRadius: 4,
                padding: "9px 10px",
                color: "#EDE7D9",
                fontFamily: "'Inter', sans-serif",
                fontSize: 14,
              }}
            >
              <option value="">Unassigned</option>
              {tanks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.capacity}L)
                </option>
              ))}
            </select>
          </label>
        )}
        <TextField label="Batch name" value={name} onChange={setName} />
        <TextField label="Style" value={style} onChange={setStyle} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Volume" value={volume} onChange={setVolume} step="0.5" suffix="L" />
          <NumberField label="Pitch temp" value={temp} onChange={setTemp} step="0.5" suffix="°C" />
          <NumberField label="Original gravity" value={og} onChange={setOg} step="0.001" />
          <NumberField label="Target FG" value={fg} onChange={setFg} step="0.001" />
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591", marginTop: 4 }}>
          Brew day
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <NumberField label="Mash pH" value={mashPh} onChange={setMashPh} step="0.01" />
          <NumberField label="Pre-boil gravity" value={preBoilGravity} onChange={setPreBoilGravity} step="0.001" />
          <NumberField label="Top-up water" value={topUpWater} onChange={setTopUpWater} step="0.1" suffix="L" />
        </div>
        {activeRecipe && (
          <div style={{ background: "#16191A", border: "1px solid #2C332F", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 6 }}>
              Ingredients to assign
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {activeRecipe.ingredients.map((ing) => (
                <div key={ing.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                  <span style={{ color: "#EDE7D9" }}>{ing.name}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A9591" }}>{ing.qty} {ing.unit}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={submit}
          style={{
            marginTop: 8,
            background: "#C17A3D",
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
            background: "#C17A3D",
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
            background: "#C17A3D",
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
        <div style={{ color: "#8A9591", fontSize: 13 }}>
          Remaining in tank: <span style={{ color: "#EDE7D9", fontFamily: "'JetBrains Mono', monospace" }}>{remaining} L</span>
          {" "}of {batch.volume} L batch
        </div>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#8A9591" }}>
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
            background: "#16191A",
            border: "1px solid #2C332F",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 13,
          }}
        >
          <span style={{ color: "#8A9591" }}>This run</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#EDE7D9" }}>{sessionVolume.toFixed(2)} L</span>
        </div>
        {diff > 0.01 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "#C17A3D",
              fontSize: 12.5,
              background: "#241D14",
              border: "1px solid #4A3420",
              borderRadius: 5,
              padding: "8px 12px",
            }}
          >
            <AlertTriangle size={14} />
            {`${diff.toFixed(2)} L more than what's left in the tank — double check counts.`}
          </div>
        ) : (
          sessionVolume > 0 && (
            <div style={{ color: "#5C6B63", fontSize: 12.5 }}>
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
            background: sessionVolume > 0 ? "#C17A3D" : "#3A2A22",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: sessionVolume > 0 ? "#16191A" : "#8A6A5A",
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
        <div style={{ color: "#8A9591", fontSize: 13 }}>
          There's <span style={{ color: "#EDE7D9", fontFamily: "'JetBrains Mono', monospace" }}>{remaining} L</span> still sitting in
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
            color: "#EDE7D9",
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
            color: "#C17A3D",
            fontSize: 13,
            background: "#241D14",
            border: "1px solid #4A3420",
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
          <div style={{ color: "#C17A3D", fontSize: 12.5, background: "#241D14", border: "1px solid #4A3420", borderRadius: 5, padding: "8px 12px" }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={!canDelete || busy}
          style={{
            background: canDelete ? "#B5502F" : "#3A2A22",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canDelete ? "#EDE7D9" : "#8A6A5A",
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

function BatchDetail({ batch, onBack, onAdvance, onLogReading, onEditBrewDay, onOpenPackaging, onDiscardRemaining, onAssignTank }) {
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
          color: "#8A9591",
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
          <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", fontSize: 13 }}>
            Batch #{batch.number}
          </div>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 28, color: "#EDE7D9", margin: "2px 0 6px", fontWeight: 500 }}>
            {batch.name}
          </h1>
          <div style={{ color: "#8A9591", fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              {batch.style} · {batch.volume}L{batch.tankName ? ` · ${batch.tankName}` : " · No tank assigned"}
            </span>
            <button
              onClick={() => onAssignTank(batch)}
              style={{ background: "none", border: "none", color: "#C17A3D", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              Change
            </button>
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
          <div key={label} style={{ background: "#1F2422", border: "1px solid #2C332F", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#EDE7D9", marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63" }}>Brew day</div>
        <button
          onClick={() => onEditBrewDay(batch)}
          style={{ background: "none", border: "none", color: "#C17A3D", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
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
          <div key={label} style={{ background: "#1F2422", border: "1px solid #2C332F", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63" }}>{label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#EDE7D9", marginTop: 3 }}>{val}</div>
          </div>
        ))}
      </div>

      {batch.ingredients && batch.ingredients.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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
                  background: "#1B1F1D",
                  border: "1px solid #262C29",
                  borderRadius: 5,
                  fontSize: 13,
                }}
              >
                <span style={{ flex: 1, color: "#EDE7D9", fontFamily: "'Inter', sans-serif" }}>{ing.name}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: CATEGORY_COLOR[ing.category], fontSize: 11 }}>
                  {ing.category}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A9591", width: 64, textAlign: "right", flexShrink: 0 }}>
                  {ing.qty} {ing.unit}
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
                color: i <= stageIdx ? STAGE_COLOR[batch.stage] : "#3A413D",
                letterSpacing: "0.05em",
              }}
            >
              {s.toUpperCase()}
            </span>
            {i < STAGES.length - 1 && <span style={{ flex: 1, height: 1, background: i < stageIdx ? STAGE_COLOR[batch.stage] : "#2C332F" }} />}
          </React.Fragment>
        ))}
      </div>
      <div style={{ color: "#5C6B63", fontSize: 12.5, marginBottom: 18 }}>{days} days since brew day</div>

      {batch.packaging && (() => {
        const events = packagingEvents(batch);
        const discarded = packagingDiscarded(batch);
        const totals = aggregatePackagingCounts(batch);
        const remaining = remainingVolume(batch);
        return (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 8 }}>
              Packaging
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
              {CONTAINERS.map((c) => (
                <div key={c.key} style={{ background: "#1F2422", border: "1px solid #2C332F", borderRadius: 6, padding: "10px 10px" }}>
                  <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B63" }}>{c.shortLabel}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#EDE7D9", marginTop: 3 }}>
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
                      padding: "8px 12px",
                      background: "#1B1F1D",
                      border: "1px solid #262C29",
                      borderRadius: 5,
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63" }}>{(e.date || "").slice(5)}</span>
                    <span style={{ color: "#8A9591" }}>
                      {CONTAINERS.filter((c) => (e[c.key] || 0) > 0).map((c) => `${e[c.key]}× ${c.shortLabel}`).join(" · ") || "—"}
                    </span>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#EDE7D9" }}>{packagedVolume(e).toFixed(2)} L</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ color: "#5C6B63", fontSize: 12.5, marginBottom: 10 }}>
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
                    background: "#242B27",
                    border: "1px solid #3A413D",
                    borderRadius: 5,
                    padding: "10px",
                    color: "#EDE7D9",
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
                    border: "1px solid #4A3420",
                    borderRadius: 5,
                    padding: "10px",
                    color: "#C17A3D",
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

      <div style={{ display: "flex", gap: 10, marginBottom: 26 }}>
        <button
          onClick={() => onLogReading(batch)}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            background: "#242B27",
            border: "1px solid #3A413D",
            borderRadius: 5,
            padding: "11px",
            color: "#EDE7D9",
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
              background: "#C17A3D",
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

      {chartData.length > 1 && (
        <div style={{ background: "#1F2422", border: "1px solid #2C332F", borderRadius: 6, padding: "16px 12px 6px", marginBottom: 22 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 6, marginLeft: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <TrendingDown size={13} /> Gravity trend
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 5, right: 14, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="#2C332F" strokeDasharray="3 3" />
              <XAxis dataKey="date" stroke="#5C6B63" fontSize={11} />
              <YAxis stroke="#5C6B63" fontSize={11} domain={["dataMin - 0.003", "dataMax + 0.003"]} tickFormatter={(v) => v.toFixed(3)} />
              <Tooltip
                contentStyle={{ background: "#16191A", border: "1px solid #2C332F", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "#8A9591" }}
              />
              <Line type="monotone" dataKey="gravity" stroke="#C17A3D" strokeWidth={2} dot={{ r: 3, fill: "#C17A3D" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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
              background: "#1B1F1D",
              border: "1px solid #262C29",
              borderRadius: 5,
              fontSize: 13,
            }}
          >
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", width: 62, flexShrink: 0 }}>{r.date.slice(5)}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#EDE7D9", width: 60, flexShrink: 0 }}>{r.gravity.toFixed(3)}</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A9591", width: 42, flexShrink: 0 }}>{r.temp}°C</span>
            {r.note && <span style={{ color: "#8A9591", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function HomeView({
  companyName,
  fermentingBatches,
  conditioningBatches,
  inProgressBatches,
  packagedBatches,
  inventory,
  purchaseOrders,
  onOpenBatch,
  onOpenPO,
  onGoTo,
}) {
  const lowStock = inventory.filter((it) => it.qty <= it.threshold);
  const openOrders = purchaseOrders.filter((po) => po.status === "Ordered");

  const stats = [
    ["Fermenting", fermentingBatches.length, STAGE_COLOR.Primary, "batches"],
    ["Conditioning", conditioningBatches.length, STAGE_COLOR.Conditioning, "batches"],
    ["Packaging", inProgressBatches.length, "#D4A24C", "batches"],
    ["Packaged", packagedBatches.length, "#5C6B63", "batches"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ color: "#8A9591", fontSize: 13, marginBottom: 2 }}>Welcome back to</div>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, color: "#EDE7D9", margin: 0, fontWeight: 500 }}>
          {companyName || "your brewery"}
        </h1>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {stats.map(([label, count, color, goTo]) => (
          <button
            key={label}
            onClick={() => onGoTo(goTo)}
            style={{
              background: "#1F2422",
              border: "1px solid #2C332F",
              borderRadius: 6,
              padding: "12px 10px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B63" }}>{label}</div>
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
                  background: "#1B1F1D",
                  border: "1px solid #262C29",
                  borderRadius: 5,
                  fontSize: 13.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#EDE7D9" }}>{b.name}</span>
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
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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
                  background: "#1B1F1D",
                  border: "1px solid #4A3420",
                  borderRadius: 5,
                  fontSize: 13.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#EDE7D9" }}>
                  <AlertTriangle size={13} color="#C17A3D" /> {it.name} running low
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#C17A3D", fontSize: 12 }}>
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
                  background: "#1B1F1D",
                  border: "1px solid #262C29",
                  borderRadius: 5,
                  fontSize: 13.5,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "#EDE7D9" }}>{po.poNumber} — {po.supplier}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A9591", fontSize: 12 }}>Awaiting delivery</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {fermentingBatches.length === 0 && conditioningBatches.length === 0 && inProgressBatches.length === 0 && packagedBatches.length === 0 && (
        <div style={{ color: "#5C6B63", fontSize: 13.5, padding: "20px 4px" }}>
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
        background: "#16191A",
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
        button:focus-visible { outline: 2px solid #C17A3D; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#1F2422",
              border: "1px solid #2C332F",
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
              color: "#C17A3D",
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
            background: "#1A2318",
            border: "1px solid #33452C",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <CheckCircle2 size={22} color="#7FA35C" />
        </div>

        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#EDE7D9", margin: "0 0 8px", fontWeight: 500 }}>
          Email confirmed
        </h1>
        <p style={{ color: "#8A9591", fontSize: 14, lineHeight: 1.5, margin: "0 0 26px" }}>
          Thanks for confirming your email. Your account's ready to go — log in below to get into your brewery.
        </p>

        <button
          onClick={onContinue}
          style={{
            width: "100%",
            background: "#C17A3D",
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
        background: "#16191A",
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
        input:focus { outline: 1px solid #C17A3D; }
        button:focus-visible { outline: 2px solid #C17A3D; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 30 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#1F2422",
              border: "1px solid #2C332F",
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
              color: "#C17A3D",
              marginBottom: 6,
            }}
          >
            Brewpoint
          </span>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#EDE7D9", margin: 0, fontWeight: 500 }}>
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
            <div style={{ color: "#C17A3D", fontSize: 12.5, background: "#241D14", border: "1px solid #4A3420", borderRadius: 5, padding: "8px 12px" }}>
              {error}
            </div>
          )}
          {info && !error && (
            <div style={{ color: "#7FA35C", fontSize: 12.5, background: "#1A2318", border: "1px solid #33452C", borderRadius: 5, padding: "8px 12px" }}>
              {info}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            style={{
              marginTop: 4,
              background: "#C17A3D",
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
              color: "#8A9591",
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

export default function TankLog() {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [justConfirmedEmail, setJustConfirmedEmail] = useState(() => {
    const hash = window.location.hash || "";
    return hash.includes("type=signup") || hash.includes("type=invite") || hash.includes("type=email_change");
  });
  const [loadingData, setLoadingData] = useState(false);
  const [view, setView] = useState("home");
  const [batches, setBatches] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [logTarget, setLogTarget] = useState(null);
  const [brewDayTarget, setBrewDayTarget] = useState(null);
  const [packagingTarget, setPackagingTarget] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [showAddInventory, setShowAddInventory] = useState(false);
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
  const [teammates, setTeammates] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [showAddTank, setShowAddTank] = useState(false);
  const [editTankTarget, setEditTankTarget] = useState(null);
  const [deleteTankTarget, setDeleteTankTarget] = useState(null);
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
      setTeammates([]);
      setTanks([]);
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

      const [companyRes, teammatesRes, batchesRes, inventoryRes, poRes, recipesRes, tanksRes] = await Promise.all([
        supabase.from("companies").select("name").eq("id", myProfile.companyId).single(),
        supabase.from("profiles").select("*").eq("company_id", myProfile.companyId),
        supabase.from("batches").select("*").order("created_at", { ascending: false }),
        supabase.from("inventory_items").select("*").order("created_at", { ascending: false }),
        supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
        supabase.from("recipes").select("*").order("created_at", { ascending: false }),
        supabase.from("tanks").select("*").order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      if (companyRes.error) console.error(companyRes.error);
      else setCompanyName(companyRes.data.name);
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

  const addBatch = async (b) => {
    const { data, error } = await supabase.from("batches").insert(batchToRow(b, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    setBatches((prev) => [rowToBatch(data), ...prev]);

    if (b.ingredients && b.ingredients.length > 0) {
      for (const ing of b.ingredients) {
        const item = inventory.find((it) => it.name.toLowerCase() === ing.name.toLowerCase());
        if (!item) continue;
        const newQty = Math.max(0, Math.round((item.qty - ing.qty) * 100) / 100);
        const { error: invError } = await supabase.from("inventory_items").update({ qty: newQty }).eq("id", item.id);
        if (invError) console.error(invError);
        else setInventory((prev) => prev.map((it) => (it.id === item.id ? { ...it, qty: newQty } : it)));
      }
    }
  };

  const addRecipe = async (r) => {
    const { data, error } = await supabase.from("recipes").insert(recipeToRow(r, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    setRecipes((prev) => [rowToRecipe(data), ...prev]);
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

  const adjustInventory = async (id, delta) => {
    const item = inventory.find((it) => it.id === id);
    if (!item) return;
    const newQty = Math.max(0, Math.round((item.qty + delta) * 100) / 100);
    const { error } = await supabase.from("inventory_items").update({ qty: newQty }).eq("id", id);
    if (error) return console.error(error);
    setInventory((prev) => prev.map((it) => (it.id === id ? { ...it, qty: newQty } : it)));
  };

  const addPO = async (po) => {
    const { data, error } = await supabase.from("purchase_orders").insert(poToRow(po, user.id, profile.companyId)).select().single();
    if (error) return console.error(error);
    setPurchaseOrders((prev) => [rowToPO(data), ...prev]);
  };

  const receivePO = async (id) => {
    const po = purchaseOrders.find((p) => p.id === id);
    if (!po) return;

    let nextInventory = [...inventory];
    for (const line of po.lines) {
      const idx = nextInventory.findIndex((it) => it.name.toLowerCase() === line.name.toLowerCase());
      const lotEntry = { id: uid(), lotNumber: line.lotNumber || "no lot #", qty: line.qty, date: today(), poNumber: po.poNumber };

      if (idx >= 0) {
        const item = nextInventory[idx];
        const newQty = Math.round((item.qty + line.qty) * 100) / 100;
        const newLots = [...(item.lots || []), lotEntry];
        const { error } = await supabase.from("inventory_items").update({ qty: newQty, lots: newLots }).eq("id", item.id);
        if (error) {
          console.error(error);
          continue;
        }
        nextInventory[idx] = { ...item, qty: newQty, lots: newLots };
      } else {
        const newItem = { id: uid(), name: line.name, category: line.category, qty: line.qty, unit: line.unit, threshold: 0, lots: [lotEntry] };
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
      .update({ status: "Received", received_date: today() })
      .eq("id", id);
    if (poError) return console.error(poError);
    setPurchaseOrders((prev) => prev.map((p) => (p.id === id ? { ...p, status: "Received", receivedDate: today() } : p)));
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

  const logReading = async (id, reading) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const readings = [...batch.readings, reading];
    const { error } = await supabase.from("batches").update({ readings }).eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, readings } : b)));
  };

  const updateBrewDay = async (id, patch) => {
    const { error } = await supabase
      .from("batches")
      .update({ mash_ph: patch.mashPh, pre_boil_gravity: patch.preBoilGravity, top_up_water: patch.topUpWater })
      .eq("id", id);
    if (error) return console.error(error);
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
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
      <div style={{ minHeight: "100vh", background: "#16191A", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#5C6B63", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>Loading…</span>
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
        background: "#16191A",
        fontFamily: "'Inter', sans-serif",
        padding: "0 0 60px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #C17A3D; }
        button:focus-visible { outline: 2px solid #C17A3D; outline-offset: 2px; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        <div
          style={{
            width: 210,
            flexShrink: 0,
            borderRight: "1px solid #2C332F",
            padding: "24px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#C17A3D", padding: "0 6px" }}>
            <BreworxMark size={26} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Brewpoint
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {[
              ["home", "Home"],
              ["batches", "Fermentation"],
              ["inventory", "Inventory"],
              ["orders", "Orders"],
              ["recipes", "Recipes"],
              ["brewery", "Brewery"],
              ["settings", "Settings"],
            ].map(([key, label]) => {
              const isCurrent = view === key && !selected && !selectedPO && !selectedRecipe;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setView(key);
                    setSelectedId(null);
                    setSelectedPOId(null);
                    setSelectedRecipeId(null);
                  }}
                  style={{
                    textAlign: "left",
                    background: isCurrent ? "#1F2422" : "none",
                    border: "none",
                    borderLeft: `2px solid ${isCurrent ? "#C17A3D" : "transparent"}`,
                    borderRadius: 4,
                    padding: "10px 12px",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'Oswald', sans-serif",
                      fontSize: 15,
                      color: isCurrent ? "#EDE7D9" : "#8A9591",
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
            <span style={{ color: "#8A9591", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>{user.name}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "none",
                border: "1px solid #2C332F",
                borderRadius: 4,
                color: "#8A9591",
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
        {!selected && !selectedPO && !selectedRecipe && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
              {view !== "settings" && view !== "home" && (
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
                    background: "#C17A3D",
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
              <div style={{ color: "#5C6B63", fontSize: 13, fontFamily: "'JetBrains Mono', monospace", padding: "20px 4px" }}>
                Loading your brewery…
              </div>
            )}

            {!loadingData && view === "home" && (
              <HomeView
                companyName={companyName}
                fermentingBatches={fermentingBatches}
                conditioningBatches={conditioningBatches}
                inProgressBatches={inProgressBatches}
                packagedBatches={packagedBatches}
                inventory={inventory}
                purchaseOrders={purchaseOrders}
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

            {!loadingData && view === "batches" && (
              <>
                <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
                  Fermenting ({fermentingBatches.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: (conditioningBatches.length || inProgressBatches.length || packagedBatches.length) ? 26 : 0 }}>
                  {fermentingBatches.map((b) => (
                    <BatchCard key={b.id} batch={b} onOpen={setSelectedId} />
                  ))}
                  {fermentingBatches.length === 0 && (
                    <div style={{ color: "#5C6B63", fontSize: 13.5, padding: "20px 4px" }}>
                      No batches fermenting right now. Start one to get going.
                    </div>
                  )}
                </div>

                {conditioningBatches.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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
                    <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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

            {!loadingData && view === "inventory" && (
              <>
                {inventory.some((it) => it.qty <= it.threshold) && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "#C17A3D",
                      fontSize: 12.5,
                      marginBottom: 14,
                      background: "#241D14",
                      border: "1px solid #4A3420",
                      borderRadius: 5,
                      padding: "8px 12px",
                    }}
                  >
                    <AlertTriangle size={14} />
                    {inventory.filter((it) => it.qty <= it.threshold).length} item(s) running low
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {inventory.map((it) => (
                    <InventoryItemCard key={it.id} item={it} onAdjust={adjustInventory} />
                  ))}
                  {inventory.length === 0 && (
                    <div style={{ color: "#5C6B63", fontSize: 13.5, padding: "20px 4px" }}>
                      No ingredients tracked yet. Add grain, hops, or yeast to get started.
                    </div>
                  )}
                </div>
              </>
            )}

            {!loadingData && view === "orders" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {purchaseOrders.map((po) => (
                  <POCard key={po.id} po={po} onOpen={setSelectedPOId} />
                ))}
                {purchaseOrders.length === 0 && (
                  <div style={{ color: "#5C6B63", fontSize: 13.5, padding: "20px 4px" }}>
                    No purchase orders yet. Create one to bring in ingredients with lot tracking.
                  </div>
                )}
              </div>
            )}

            {!loadingData && view === "recipes" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {recipes.map((r) => (
                  <RecipeCard key={r.id} recipe={r} onOpen={setSelectedRecipeId} />
                ))}
                {recipes.length === 0 && (
                  <div style={{ color: "#5C6B63", fontSize: 13.5, padding: "20px 4px" }}>
                    No recipes yet. Add one so you can assign its ingredients when you start a brew.
                  </div>
                )}
              </div>
            )}

            {!loadingData && view === "brewery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tanks.map((t) => {
                  const inUseCount = batches.filter((b) => b.tankId === t.id).length;
                  return (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        background: "#1F2422",
                        border: "1px solid #2C332F",
                        borderRadius: 6,
                        padding: "14px 16px",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#EDE7D9", margin: 0 }}>
                          {t.name}
                        </h3>
                        <div style={{ color: "#8A9591", fontSize: 12.5, marginTop: 3 }}>
                          {t.capacity}L{inUseCount > 0 ? ` · in use by ${inUseCount} batch${inUseCount !== 1 ? "es" : ""}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        <button
                          onClick={() => setEditTankTarget(t)}
                          style={{ background: "none", border: "1px solid #2C332F", borderRadius: 4, color: "#8A9591", cursor: "pointer", padding: 6 }}
                        >
                          <Settings size={14} />
                        </button>
                        {inUseCount === 0 && (
                          <button
                            onClick={() => setDeleteTankTarget(t)}
                            style={{ background: "none", border: "1px solid #4A3420", borderRadius: 4, color: "#C17A3D", cursor: "pointer", padding: 6 }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {tanks.length === 0 && (
                  <div style={{ color: "#5C6B63", fontSize: 13.5, padding: "20px 4px" }}>
                    No tanks set up yet. Add your fermenters and conditioning vessels so batches can be assigned to them.
                  </div>
                )}
              </div>
            )}

            {!loadingData && view === "settings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
                    Account
                  </div>
                  <div style={{ background: "#1F2422", border: "1px solid #2C332F", borderRadius: 6, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B63" }}>Name</div>
                      <div style={{ color: "#EDE7D9", fontSize: 15, marginTop: 2 }}>{user.name}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B63" }}>Email</div>
                      <div style={{ color: "#EDE7D9", fontSize: 15, marginTop: 2 }}>{user.email}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B63" }}>Role</div>
                      <div style={{ color: "#EDE7D9", fontSize: 15, marginTop: 2, textTransform: "capitalize" }}>{profile?.role || "—"}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
                    Company
                  </div>
                  <div style={{ background: "#1F2422", border: "1px solid #2C332F", borderRadius: 6, padding: "14px 16px" }}>
                    <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B63" }}>Name</div>
                    <div style={{ color: "#EDE7D9", fontSize: 17, fontFamily: "'Oswald', sans-serif", marginTop: 2 }}>{companyName || "—"}</div>
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B63", marginBottom: 10 }}>
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
                          background: "#1B1F1D",
                          border: "1px solid #262C29",
                          borderRadius: 5,
                          fontSize: 13.5,
                        }}
                      >
                        <span style={{ color: "#EDE7D9" }}>
                          {t.name}
                          {t.id === user.id ? " (you)" : ""}
                        </span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C6B63", fontSize: 11, textTransform: "uppercase" }}>
                          {t.role}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{ color: "#5C6B63", fontSize: 12, marginTop: 10 }}>
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
                    border: "1px solid #4A3420",
                    borderRadius: 5,
                    padding: "12px",
                    color: "#C17A3D",
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
                    color: "#6B4A2F",
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
            onLogReading={setLogTarget}
            onEditBrewDay={setBrewDayTarget}
            onOpenPackaging={setPackagingTarget}
            onDiscardRemaining={setDiscardTarget}
            onAssignTank={setAssignTankTarget}
          />
        )}

        {!selected && selectedPO && (
          <PODetail po={selectedPO} onBack={() => setSelectedPOId(null)} onReceive={receivePO} />
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
        />
      )}
      {showAddInventory && <AddInventoryModal onClose={() => setShowAddInventory(false)} onAdd={addInventoryItem} />}
      {showAddPO && <AddPOModal onClose={() => setShowAddPO(false)} onAdd={addPO} nextPONumber={nextPONumber} />}
      {showAddRecipe && <AddRecipeModal onClose={() => setShowAddRecipe(false)} onAdd={addRecipe} />}
      {showAddTank && <AddTankModal onClose={() => setShowAddTank(false)} onAdd={addTank} />}
      {editTankTarget && (
        <EditTankModal tank={editTankTarget} onClose={() => setEditTankTarget(null)} onSave={updateTank} />
      )}
      {deleteTankTarget && (
        <ConfirmDeleteTankModal tank={deleteTankTarget} onClose={() => setDeleteTankTarget(null)} onConfirm={deleteTank} />
      )}
      {assignTankTarget && (
        <AssignTankModal batch={assignTankTarget} tanks={tanks} onClose={() => setAssignTankTarget(null)} onSave={assignBatchTank} />
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
