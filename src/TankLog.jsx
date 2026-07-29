import React, { useState, useMemo, useEffect } from "react";
import { Plus, Droplet, ChevronLeft, X, TrendingDown, Beaker, Package, Minus, AlertTriangle, Truck, CheckCircle2, Trash2, LogOut, Settings, Users } from "lucide-react";
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

function BreworxMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      {/* Hop cone */}
      <g>
        <ellipse cx="13" cy="9" rx="5.5" ry="3.6" fill="#C17A3D" />
        <ellipse cx="13" cy="14" rx="6.5" ry="3.9" fill="#C17A3D" opacity="0.92" />
        <ellipse cx="13" cy="19.2" rx="7.2" ry="4.2" fill="#C17A3D" opacity="0.85" />
        <ellipse cx="13" cy="24.4" rx="6.6" ry="3.9" fill="#C17A3D" opacity="0.78" />
        <ellipse cx="13" cy="29.2" rx="5" ry="3.2" fill="#C17A3D" opacity="0.72" />
        <line x1="13" y1="5.5" x2="13" y2="4" stroke="#C17A3D" strokeWidth="1.4" strokeLinecap="round" />
      </g>
      {/* Barley ear */}
      <g stroke="#D4A24C" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <line x1="24" y1="35" x2="29" y2="6" />
        <line x1="26.3" y1="27" x2="22" y2="22" />
        <line x1="26.3" y1="27" x2="30.5" y2="22.6" />
        <line x1="27.1" y1="21" x2="23" y2="16.3" />
        <line x1="27.1" y1="21" x2="31.3" y2="16.9" />
        <line x1="27.9" y1="15" x2="24" y2="10.6" />
        <line x1="27.9" y1="15" x2="32.1" y2="11.2" />
        <line x1="28.6" y1="9.2" x2="25.2" y2="5.6" />
        <line x1="28.6" y1="9.2" x2="32" y2="6" />
      </g>
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
        <div style={{ color: "#8A9591", fontSize: 13, marginTop: 2 }}>{batch.style}</div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#B8C0BC" }}>
          <span>SG {latest.gravity.toFixed(3)}</span>
          <span>{latest.temp}°C</span>
          <span>{days}d</span>
          <span style={{ color: STAGE_COLOR[batch.stage] }}>{pct.toFixed(0)}% attn</span>
        </div>
        {batch.packaging && (
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#5C6B63", marginTop: 6 }}>
            {CONTAINERS.filter((c) => (batch.packaging[c.key] || 0) > 0)
              .map((c) => `${batch.packaging[c.key]}× ${c.shortLabel}`)
              .join(" · ") || "No containers logged"}
          </div>
        )}
      </div>
    </button>
  );
}

function InventoryItemCard({ item, onAdjust }) {
  const low = item.qty <= item.threshold;
  const step = STEP_FOR_UNIT[item.unit] ?? 1;
  const displayQty = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
  return (
    
