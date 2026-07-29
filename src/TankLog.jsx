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
