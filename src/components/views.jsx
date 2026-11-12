import { useState, useMemo, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import { TrendingUp, Package, AlertTriangle, CheckCircle2, Trash2, FlaskConical, Warehouse, Calendar, Search } from "lucide-react";
// Charts: recharts is imported directly. Lazy-loading each piece separately
// (as this used to) breaks recharts — a chart only draws children it
// recognises by type, so lazy-wrapped bars, lines and axes were skipped and
// every chart rendered as an empty frame.
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { item_qty } from "./account";
import { RecipeSearchField } from "./batches";
import { StagePill } from "./cards";
import { TASTING_TAGS } from "./foodSafety";
import { AgingTankVesselIcon, BarrelVesselIcon, BrewDayVesselIcon, TankWallCard } from "./tanks";
import { ingredientsNeededForScheduled } from "./traceability";
import { ConfirmDialogModal, EmptyState, FirstVisitTip, Modal, NumberField, TextField } from "./ui";
import { formatHistoryStamp } from "../lib/brewing";
import { monthKeyFromDate, monthLabelFromKey } from "../lib/excise";
import { STAGE_COLOR, activeRecipesByFamily, batchTankIds, isScheduledBatch, occupyingBatch, packagingEvents, remainingVolume, sortedTanks, tankIsOccupied, uid, userColor } from "../lib/production";
import { addDays, daysBetween, today } from "../lib/utils";

export function QuickJumpModal({ onClose, batches, recipes, purchaseOrders, tanks, inventory, consumables, suppliers, foodSafetyRecords, onOpenBatch, onOpenRecipe, onOpenPO, onOpenTank, onOpenInventory, onOpenConsumable, onOpenSupplier, onOpenFoodSafety }) {
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

  return createPortal(
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
    </div>,
    document.body
  );
}

// A single day's reminders — see what's there, check things off, add a new
// one. Kept simple deliberately: a date and a line of text, nothing more.
export function ReminderDayModal({ date, reminders, onClose, onAdd, onToggle, onDelete }) {
  const [text, setText] = useState("");
  const dayReminders = reminders.filter((r) => r.dueDate === date);
  const dt = new Date(date + "T00:00:00");
  const label = dt.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), date);
    setText("");
  };

  return (
    <Modal title={label} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {dayReminders.map((r) => (
            <div
              key={r.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5 }}
            >
              <button
                onClick={() => onToggle(r.id, !r.done)}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: `1.5px solid ${r.done ? "#5C9A3C" : "#C9D1AC"}`,
                  background: r.done ? "#5C9A3C" : "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  cursor: "pointer",
                }}
              >
                {r.done && <CheckCircle2 size={12} color="#FFFFFF" />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "#2A3324", textDecoration: r.done ? "line-through" : "none", opacity: r.done ? 0.6 : 1 }}>{r.text}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: userColor(r.userName) }} />
                  <span style={{ fontSize: 11, color: "#9BA88A" }}>
                    {r.userName}
                    {r.done && r.doneBy ? ` · done by ${r.doneBy}` : ""}
                  </span>
                </div>
              </div>
              <button onClick={() => onDelete(r.id)} aria-label="Delete" style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4, flexShrink: 0 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {dayReminders.length === 0 && <div style={{ color: "#9BA88A", fontSize: 13 }}>Nothing added for this day yet.</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Add a reminder…"
            style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
          />
          <button
            onClick={submit}
            style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 14px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
          >
            Add
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The whole point of this page: something that's been sitting in a barrel
// for eight months shouldn't feel like a forgotten spreadsheet row. One
// glance tells you what's fermenting vs quietly aging, what's in it, and
// when someone last actually tasted it.
// What's actually sitting in the fridge ready to reuse, grouped by strain
// so you can see every generation of a given yeast at a glance — and a
// collapsed history of what's already been pitched, for the record.
export function YeastView({ yeastHarvests, onOpenSourceBatch }) {
  const available = (yeastHarvests || []).filter((h) => !h.used);
  const used = (yeastHarvests || []).filter((h) => h.used);

  const grouped = {};
  available.forEach((h) => {
    if (!grouped[h.strainName]) grouped[h.strainName] = [];
    grouped[h.strainName].push(h);
  });
  const strains = Object.keys(grouped).sort();

  return (
    <div>
      {strains.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="Nothing harvested yet"
          subtitle={'Open a batch in Primary, Cooling, Brite Tank, or Aging and tap "Harvest yeast from this batch" — it\'ll show up here, ready to reuse.'}
        />
      ) : (
        strains.map((strain) => (
          <div key={strain} style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, color: "#2A3324", marginBottom: 8 }}>{strain}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {grouped[strain]
                .sort((a, b) => b.generation - a.generation)
                .map((h) => (
                  <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6 }}>
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        letterSpacing: "0.04em",
                        color: "#8E6FB5",
                        border: "1px solid #8E6FB5",
                        borderRadius: 20,
                        padding: "3px 9px",
                        flexShrink: 0,
                      }}
                    >
                      GEN {h.generation}
                    </span>
                    <span style={{ flex: 1, color: "#2A3324", fontSize: 13.5 }}>
                      {h.amount} {h.unit}
                    </span>
                    <button
                      onClick={() => onOpenSourceBatch(h.sourceBatchId)}
                      style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 11.5, fontFamily: "'Inter', sans-serif", padding: 0, textAlign: "right", flexShrink: 0 }}
                    >
                      from {h.sourceBatchName}
                      <br />
                      {formatHistoryStamp(h.harvestDate)}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}

      {used.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
            Already pitched ({used.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
            {[...used].sort((a, b) => (b.usedDate || "").localeCompare(a.usedDate || "")).map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 12, fontSize: 12, padding: "6px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>GEN {h.generation}</span>
                <span style={{ color: "#2A3324" }}>{h.strainName}</span>
                <span style={{ color: "#9BA88A", marginLeft: "auto" }}>{h.usedDate ? formatHistoryStamp(h.usedDate) : ""}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function AgingOverviewView({ batches, tanks, onOpenBatch }) {
  const agingBatches = batches.filter((b) => b.stage === "Aging");

  return (
    <div>
      {agingBatches.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="Nothing aging right now"
          subtitle="Move a batch into a barrel or aging tank from its own page — from Primary, Brite Tank, or straight from the kettle — and it'll show up here."
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {agingBatches.map((b) => {
            const tank = tanks.find((t) => t.id === b.tankId);
            const isBarrel = tank?.type === "Barrel";
            const days = daysBetween(b.startDate, today());
            const sortedTasting = [...(b.tastingLog || [])].sort((a, c) => c.date.localeCompare(a.date));
            const latest = sortedTasting[0];

            return (
              <button
                key={b.id}
                onClick={() => onOpenBatch(b.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  background: "#FFFFFF",
                  border: "1px solid #DDE0C8",
                  borderRadius: 10,
                  padding: "18px 14px",
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                {isBarrel ? (
                  <BarrelVesselIcon fermenting={!!b.stillFermenting} size={64} uid={b.id} />
                ) : (
                  <AgingTankVesselIcon size={64} uid={b.id} />
                )}
                <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, color: "#2A3324", marginTop: 4 }}>{b.name}</div>
                <div style={{ color: "#5C6B54", fontSize: 11.5 }}>
                  {tank ? tank.name : "Unknown vessel"}
                  {isBarrel && tank?.barrelSource ? ` · ${tank.barrelSource}` : ""}
                </div>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10.5,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: isBarrel && b.stillFermenting ? "#E08A3C" : "#8E6FB5",
                    border: `1px solid ${isBarrel && b.stillFermenting ? "#E08A3C" : "#8E6FB5"}`,
                    borderRadius: 20,
                    padding: "3px 10px",
                  }}
                >
                  {isBarrel && b.stillFermenting ? "Fermenting" : "Aging"} · {days}d
                </span>
                {latest && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginTop: 2 }}>
                    {latest.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        style={{
                          background: TASTING_TAGS["Off-flavors"].includes(tag) ? "#FBE5D2" : "#EBF3E4",
                          border: `1px solid ${TASTING_TAGS["Off-flavors"].includes(tag) ? "#E3B37A" : "#5C9A3C"}`,
                          borderRadius: 20,
                          padding: "2px 8px",
                          color: TASTING_TAGS["Off-flavors"].includes(tag) ? "#7A3E1D" : "#2A3324",
                          fontSize: 10.5,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {!latest && <div style={{ color: "#C9D1AC", fontSize: 10.5 }}>No tasting logged yet</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function IngredientsNeededModal({ batches, recipes, inventory, onClose, onOpenPO }) {
  const [expandedKey, setExpandedKey] = useState(null);
  const rows = ingredientsNeededForScheduled(batches, recipes, inventory);
  const short = rows.filter((r) => r.shortfall > 0);
  const covered = rows.filter((r) => r.shortfall === 0);

  return (
    <Modal title="Ingredients needed for scheduled brews" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Totalled across every batch scheduled for a future date, checked against what's currently in stock.
        </div>
        {rows.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>
            No scheduled batches have a recipe attached yet, so there's nothing to check — link a recipe when scheduling to see this.
          </div>
        ) : (
          <>
            {short.length > 0 && (
              <div>
                <div style={{ color: "#B5502F", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>
                  Short — {short.length} to order
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {short.map((r) => (
                    <div key={r.name} style={{ background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 5, padding: "10px 12px" }}>
                      <button
                        onClick={() => setExpandedKey(expandedKey === r.name ? null : r.name)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                      >
                        <span style={{ color: "#2A3324", fontSize: 13.5 }}>{r.name}{!r.inStock && <span style={{ color: "#B5502F", fontSize: 11 }}> — not in inventory yet</span>}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#B5502F", fontSize: 12.5, flexShrink: 0 }}>
                          short {r.shortfall} {r.unit}
                        </span>
                      </button>
                      <div style={{ color: "#7A3E1D", fontSize: 11.5, marginTop: 4 }}>
                        Need {r.totalQty} {r.unit} · have {r.available} {r.unit}
                      </div>
                      {expandedKey === r.name && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                          {r.batches.map((b, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 8px", background: "#FFFFFF", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                              <span style={{ color: "#2A3324" }}>{b.batchName}</span>
                              <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>{b.qty} {r.unit} · {b.batchDate}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {onOpenPO && (
                  <button
                    onClick={onOpenPO}
                    style={{ marginTop: 10, width: "100%", background: "#5C9A3C", border: "none", borderRadius: 5, padding: "11px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, cursor: "pointer" }}
                  >
                    + New purchase order
                  </button>
                )}
              </div>
            )}
            {covered.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", color: "#5C9A3C", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
                  Covered — {covered.length} already in stock
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                  {covered.map((r) => (
                    <div key={r.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "7px 10px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 4 }}>
                      <span style={{ color: "#2A3324" }}>{r.name}</span>
                      <span style={{ color: "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>need {r.totalQty} {r.unit} · have {r.available} {r.unit}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

export function ProductionManagerView({ tanks, batches, onOpenBatch, onScheduleTank, onEditScheduled, reminders, onOpenDay, recipes, inventory, onCheckIngredients, onReschedule }) {
  const [dragState, setDragState] = useState(null); // { batchId, pointerId, startX, deltaX, startY, deltaY, hoveredTankId }
  const dragStateRef = useRef(null);
  dragStateRef.current = dragState;
  const justDraggedRef = useRef(false);
  const rowRefs = useRef({});
  const dragRowRectsRef = useRef(null);
  const calendarTanks = tanks.filter((t) => t.type !== "Mash Tun" && t.type !== "Kettle" && t.type !== "Barrel");
  const daysBack = 7;
  const daysForward = 365;
  const rangeStart = addDays(today(), -daysBack);
  const totalDays = daysBack + daysForward + 1;
  const dayList = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i));
  const dayWidth = 34;
  const dayIndex = (d) => Math.round((new Date(d + "T00:00:00") - new Date(rangeStart + "T00:00:00")) / 86400000);
  // Months across the top, and jumping to any month — the calendar runs a
  // year ahead so brews can be planned well in advance.
  const calScrollRef = useRef(null);
  const monthLabel = (d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const monthSpans = [];
  dayList.forEach((d) => {
    const key = d.slice(0, 7);
    const last = monthSpans[monthSpans.length - 1];
    if (last && last.key === key) last.days++;
    else monthSpans.push({ key, label: monthLabel(d), days: 1, start: d });
  });
  const monthStarts = monthSpans.map((m) => ({ date: m.start, label: m.label }));
  const scrollToDay = (d) => {
    const el = calScrollRef.current;
    if (el) el.scrollTo({ left: Math.max(0, dayIndex(d) * dayWidth), behavior: "smooth" });
  };

  const occupancyForTank = (tankId) =>
    batches
      .filter((b) => batchTankIds(b).includes(tankId) && b.stage !== "Aging")
      .map((b) => {
        const events = packagingEvents(b);
        const fullyDone = b.stage === "Packaged" && remainingVolume(b) === 0;
        const estimatedEnd = b.plannedDays ? addDays(b.startDate, b.plannedDays) : addDays(today(), 1);
        // Once the estimate has passed, keep the bar growing day by day
        // for as long as the batch is genuinely still here — batchTankIds
        // above already stops matching the moment it's actually moved to
        // a different tank, so this only extends while it's real.
        const liveFloor = addDays(today(), 1);
        const end = fullyDone
          ? (events.length > 0 ? events[events.length - 1].date : b.startDate)
          : (estimatedEnd > liveFloor ? estimatedEnd : liveFloor);
        return { batch: b, start: b.startDate, end, isEstimate: !fullyDone && !!b.plannedDays };
      })
      .filter((o) => o.end >= rangeStart && o.start <= dayList[dayList.length - 1]);

  // Scheduling doesn't block overlapping future dates in the same tank on
  // its own — someone can genuinely plan three brews in a row before
  // moving one out. Without this, overlapping entries would render on top
  // of each other at the same position and hide all but one. Standard
  // calendar lane-packing: sort by start date, place each item in the
  // first lane whose last occupant has already ended.
  const assignLanes = (occ) => {
    const sorted = [...occ].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const laneEnds = [];
    return sorted.map((o) => {
      let lane = laneEnds.findIndex((end) => end < o.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(o.end);
      } else {
        laneEnds[lane] = o.end;
      }
      return { ...o, lane };
    });
  };

  // A scheduled batch is genuinely blocked, not just visually overlapping,
  // when something else's occupancy (including a live-extended overrun)
  // covers the day it's meant to start — the actual thing worth warning
  // about, versus mere lane-packing which just handles the display.
  const conflictFor = (occ, entry) => {
    if (!isScheduledBatch(entry.batch)) return null;
    const blocker = occ.find((o) => o.batch.id !== entry.batch.id && o.start <= entry.start && o.end >= entry.start);
    return blocker ? blocker.batch : null;
  };

  return (
    <div>
      {onCheckIngredients && (
        <button
          onClick={onCheckIngredients}
          style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "9px 14px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
        >
          <Package size={15} /> Ingredients needed for scheduled brews
        </button>
      )}
      {calendarTanks.length === 0 ? (
        <EmptyState icon={Calendar} title="No fermenters yet" subtitle="Set up a fermenter in Brewery first, then you can schedule batches against it here." />
      ) : (
        <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <button type="button" onClick={() => scrollToDay(addDays(today(), -2))} style={{ background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "6px 11px", fontSize: 12.5, color: "#2A3324", cursor: "pointer" }}>Today</button>
          <select value="" onChange={(e) => e.target.value && scrollToDay(e.target.value)} style={{ background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "6px 8px", fontSize: 12.5, color: "#2A3324" }}>
            <option value="">Jump to month…</option>
            {monthStarts.map((m) => <option key={m.date} value={m.date}>{m.label}</option>)}
          </select>
        </div>
        <div ref={calScrollRef} style={{ overflowX: "auto", paddingBottom: 8 }}>
          <div style={{ minWidth: totalDays * dayWidth + 120, width: "fit-content" }}>
            <div style={{ display: "flex" }}>
              <div style={{ width: 120, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: "#F5F1E4" }} />
              {monthSpans.map((m) => (
                <div key={m.key} style={{ width: m.days * dayWidth, flexShrink: 0, borderLeft: "1px solid #C9D1AC", padding: "3px 6px", boxSizing: "border-box", fontFamily: "'Oswald', sans-serif", fontSize: 12, color: "#2A3324", whiteSpace: "nowrap", overflow: "hidden" }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div style={{ display: "flex" }}>
              <div style={{ width: 120, flexShrink: 0, position: "sticky", left: 0, zIndex: 3, background: "#F5F1E4" }} />
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
                      borderLeft: "1px solid #DDE0C8",
                      background: isToday ? "#5C9A3C" : "transparent",
                      borderRadius: isToday ? 4 : 0,
                    }}
                  >
                    <div style={{ fontSize: 8.5, color: isToday ? "#FFFFFF" : "#9BA88A", fontFamily: "'JetBrains Mono', monospace" }}>
                      {dt.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 12, color: isToday ? "#FFFFFF" : "#2A3324", fontFamily: "'JetBrains Mono', monospace" }}>
                      {dt.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", borderTop: "1px solid #EBE8D6", borderBottom: "2px solid #DDE0C8", minHeight: 40 }}>
              <div style={{ width: 120, flexShrink: 0, paddingRight: 10, position: "sticky", left: 0, zIndex: 3, background: "#F5F1E4" }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 12.5, fontWeight: 500, color: "#5C6B54" }}>Reminders</div>
              </div>
              <div style={{ display: "flex" }}>
                {dayList.map((d) => {
                  const dayReminders = reminders.filter((r) => r.dueDate === d);
                  const isTodayCol = d === today();
                  return (
                    <div
                      key={d}
                      onClick={() => onOpenDay && onOpenDay(d)}
                      style={{
                        width: dayWidth,
                        minHeight: 40,
                        flexShrink: 0,
                        borderLeft: "1px solid #DDE0C8",
                        background: isTodayCol ? "rgba(92, 154, 60, 0.08)" : "transparent",
                        cursor: "pointer",
                        display: "flex",
                        flexWrap: "wrap",
                        alignContent: "flex-start",
                        gap: 2,
                        padding: "5px 3px",
                      }}
                    >
                      {dayReminders.slice(0, 4).map((r) => (
                        <div
                          key={r.id}
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: 4,
                            background: userColor(r.userName),
                            opacity: r.done ? 0.35 : 1,
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            {sortedTanks(calendarTanks).map((tank) => {
              const occ = assignLanes(occupancyForTank(tank.id));
              const laneCount = occ.length > 0 ? Math.max(...occ.map((o) => o.lane)) + 1 : 1;
              const rowHeight = Math.max(48, laneCount * 40 + 8);
              return (
                <div
                  key={tank.id}
                  ref={(el) => (rowRefs.current[tank.id] = el)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderTop: "1px solid #EBE8D6",
                    minHeight: rowHeight,
                    background: dragState && dragState.canRetank && dragState.hoveredTankId === tank.id ? "rgba(92, 154, 60, 0.1)" : "transparent",
                  }}
                >
                  <div style={{ width: 120, flexShrink: 0, paddingRight: 10, position: "sticky", left: 0, zIndex: 3, background: "#F5F1E4" }}>
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
                          if (!covered && onScheduleTank) onScheduleTank(tank.id, d);
                        }}
                        style={{
                          width: dayWidth,
                          height: rowHeight,
                          flexShrink: 0,
                          borderLeft: "1px solid #DDE0C8",
                          background: d === today() ? "rgba(92, 154, 60, 0.08)" : "transparent",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                    {occ.map(({ batch, start, end, isEstimate, lane }) => {
                      const startIdx = Math.max(0, dayIndex(start));
                      const endIdx = Math.min(totalDays - 1, dayIndex(end));
                      const isScheduled = isScheduledBatch(batch);
                      const blocker = isScheduled ? conflictFor(occ, { batch, start, end }) : null;
                      const isDragging = dragState && dragState.batchId === batch.id && dragState.sourceTankId === tank.id;
                      const snappedDeltaDays = isDragging ? Math.round(dragState.deltaX / dayWidth) : 0;
                      const dragOffsetPx = snappedDeltaDays * dayWidth;

                      const handlePointerDown = (e) => {
                        if (!isScheduled || !onReschedule) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        dragRowRectsRef.current = calendarTanks.map((t) => {
                          const el = rowRefs.current[t.id];
                          return el ? { tankId: t.id, rect: el.getBoundingClientRect() } : null;
                        }).filter(Boolean);
                        setDragState({ batchId: batch.id, pointerId: e.pointerId, startX: e.clientX, deltaX: 0, startY: e.clientY, deltaY: 0, hoveredTankId: tank.id, sourceTankId: tank.id });
                      };
                      const handlePointerMove = (e) => {
                        if (!dragStateRef.current || dragStateRef.current.batchId !== batch.id || dragStateRef.current.pointerId !== e.pointerId) return;
                        let hoveredTankId = dragStateRef.current.hoveredTankId;
                        if (dragRowRectsRef.current) {
                          for (const { tankId, rect } of dragRowRectsRef.current) {
                            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                              hoveredTankId = tankId;
                              break;
                            }
                          }
                        }
                        setDragState((prev) => (prev ? { ...prev, deltaX: e.clientX - prev.startX, deltaY: e.clientY - prev.startY, hoveredTankId } : prev));
                      };
                      const handlePointerUp = (e) => {
                        const current = dragStateRef.current;
                        if (!current || current.batchId !== batch.id || current.pointerId !== e.pointerId) return;
                        const dayOffset = Math.round(current.deltaX / dayWidth);
                        const newTankId = current.hoveredTankId !== current.sourceTankId ? current.hoveredTankId : null;
                        if (Math.abs(current.deltaX) > 5 || Math.abs(current.deltaY) > 5) justDraggedRef.current = true;
                        dragRowRectsRef.current = null;
                        setDragState(null);
                        if (dayOffset !== 0 || newTankId) {
                          const patch = {};
                          if (dayOffset !== 0) patch.startDate = addDays(batch.startDate, dayOffset);
                          if (newTankId) {
                            const newTank = calendarTanks.find((t) => t.id === newTankId);
                            if (newTank) {
                              // A split batch renders as one bar per tank it's
                              // split across — each bar is only that specific
                              // portion, so retanking moves just this one
                              // entry, not the whole batch or its other half.
                              if (batch.splitTanks && batch.splitTanks.length > 0) {
                                patch.splitTanks = batch.splitTanks.map((t) =>
                                  t.tankId === current.sourceTankId ? { ...t, tankId: newTank.id, tankName: newTank.name } : t
                                );
                              } else {
                                patch.tankId = newTank.id;
                                patch.tankName = newTank.name;
                              }
                            }
                          }
                          onReschedule(batch, patch);
                        }
                      };

                      return (
                        <button
                          key={batch.id}
                          onClick={() => {
                            if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                            if (isScheduled) { if (onEditScheduled) onEditScheduled(batch.id); } else if (onOpenBatch) onOpenBatch(batch.id);
                          }}
                          onPointerDown={handlePointerDown}
                          onPointerMove={handlePointerMove}
                          onPointerUp={handlePointerUp}
                          onPointerCancel={handlePointerUp}
                          title={blocker ? `Can't start until ${blocker.name} is out of this tank` : isScheduled ? "Drag to reschedule — drag up or down to move to a different tank" : undefined}
                          style={{
                            position: "absolute",
                            left: startIdx * dayWidth + 2 + dragOffsetPx,
                            width: (endIdx - startIdx + 1) * dayWidth - 4,
                            top: 7 + lane * 40,
                            height: 34,
                            transform: isDragging ? `translateY(${dragState.deltaY}px)` : undefined,
                            background: blocker ? "#E3B37A" : isScheduled ? "#C9BD98" : STAGE_COLOR[batch.stage] || "#5C9A3C",
                            opacity: isEstimate ? 0.6 : 1,
                            border: blocker ? "1px solid #B5502F" : isScheduled ? "1px dashed #9B8F6F" : isEstimate ? `1px dashed ${STAGE_COLOR[batch.stage] || "#5C9A3C"}` : "none",
                            borderRadius: 5,
                            cursor: isScheduled && onReschedule ? "grab" : onOpenBatch ? "pointer" : "default",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 8px",
                            overflow: "hidden",
                            touchAction: isScheduled && onReschedule ? "none" : "auto",
                            zIndex: isDragging ? 5 : 1,
                            boxShadow: isDragging ? "0 4px 10px rgba(0,0,0,0.25)" : "none",
                          }}
                        >
                          {blocker && <AlertTriangle size={11} color="#7A3E1D" style={{ flexShrink: 0, marginRight: 4 }} />}
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
                          {batch.brewDaysPlanned > 1 && (
                            <span
                              style={{
                                flexShrink: 0,
                                marginLeft: 6,
                                background: "rgba(22, 25, 26, 0.25)",
                                borderRadius: 10,
                                padding: "1px 6px",
                                fontSize: 10,
                                fontFamily: "'JetBrains Mono', monospace",
                                color: "#16191A",
                              }}
                            >
                              ×{batch.brewDaysPlanned}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </>
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
export function EditScheduledBatchModal({ batch, tanks, batches, recipes, onSave, onCreate, onDelete, onClose, nextNumber, presetTankId, presetStartDate }) {
  const calendarTanks = tanks.filter((t) => t.type !== "Mash Tun" && t.type !== "Kettle" && t.type !== "Barrel");
  const isNew = !batch;
  const [name, setName] = useState(batch ? batch.name : "");
  const [style, setStyle] = useState(batch ? batch.style || "" : "");
  const [volume, setVolume] = useState(batch ? batch.volume : 20);
  const [startDate, setStartDate] = useState(batch ? batch.startDate : presetStartDate || today());
  const [plannedDays, setPlannedDays] = useState(batch ? batch.plannedDays ?? "" : "");
  const [brewDaysPlanned, setBrewDaysPlanned] = useState(batch ? batch.brewDaysPlanned || 1 : 1);
  const [tankId, setTankId] = useState(batch ? batch.tankId || "" : presetTankId || "");
  const [recipeId, setRecipeId] = useState(batch ? batch.recipeId || "" : "");
  const [splitMode, setSplitMode] = useState(batch ? (batch.splitTanks || []).length > 0 : false);
  const [splitRows, setSplitRows] = useState(
    batch && batch.splitTanks && batch.splitTanks.length > 0
      ? batch.splitTanks.map((s) => ({ id: uid(), tankId: s.tankId, volume: String(s.volume) }))
      : [{ id: uid(), tankId: "", volume: "" }]
  );
  const [saving, setSaving] = useState(false);

  // Same live-extension logic as the calendar itself — a batch running
  // past its estimate still genuinely blocks the tank, so this needs to
  // check that, not just the original planned end date.
  const conflictingBatch = useMemo(() => {
    const checkTankIds = splitMode ? splitRows.map((r) => r.tankId).filter(Boolean) : tankId ? [tankId] : [];
    if (checkTankIds.length === 0) return null;
    for (const otherBatch of batches) {
      if (batch && otherBatch.id === batch.id) continue;
      if (!batchTankIds(otherBatch).some((id) => checkTankIds.includes(id))) continue;
      const fullyDone = otherBatch.stage === "Packaged" && remainingVolume(otherBatch) === 0;
      if (fullyDone) continue;
      const estimatedEnd = otherBatch.plannedDays ? addDays(otherBatch.startDate, otherBatch.plannedDays) : addDays(today(), 1);
      const liveFloor = addDays(today(), 1);
      const end = estimatedEnd > liveFloor ? estimatedEnd : liveFloor;
      if (otherBatch.startDate <= startDate && end >= startDate) return otherBatch;
    }
    return null;
  }, [tankId, splitMode, splitRows, startDate, batches, batch]);

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
    const finalSplitTanks = splitMode
      ? splitRows
          .filter((r) => r.tankId && Number(r.volume) > 0)
          .map((r) => {
            const t = tanks.find((tk) => tk.id === r.tankId);
            return { tankId: r.tankId, tankName: t ? t.name : "", volume: Number(r.volume) || 0, additions: [] };
          })
      : [];
    if (isNew) {
      await onCreate({
        id: uid(),
        number: nextNumber,
        name: name.trim(),
        style: style.trim() || "Unspecified",
        productType: activeRecipe ? activeRecipe.productType || "Beer" : "Beer",
        volume: Number(volume) || 0,
        og: null,
        fg: null,
        mashPh: null,
        mashTemp: null,
        preBoilGravity: null,
        topUpWater: null,
        phIntoTank: null,
        sgIntoTank: null,
        stage: "Brewing",
        startDate,
        recipeId: recipeId || null,
        recipeName: activeRecipe ? activeRecipe.name : null,
        tankId: splitMode ? null : tank ? tank.id : null,
        tankName: splitMode ? null : tank ? tank.name : null,
        brewStage: null,
        splitTanks: finalSplitTanks,
        ingredients: [],
        schedule: [],
        readings: [],
        plannedDays: plannedDays === "" ? null : Number(plannedDays),
        brewDaysPlanned: Number(brewDaysPlanned) || 1,
      });
    } else {
      await onSave(batch.id, {
        name: name.trim(),
        style,
        volume: Number(volume) || 0,
        startDate,
        plannedDays: plannedDays === "" ? null : Number(plannedDays),
        brewDaysPlanned: Number(brewDaysPlanned) || 1,
        tankId: splitMode ? null : tank ? tank.id : null,
        tankName: splitMode ? null : tank ? tank.name : null,
        splitTanks: finalSplitTanks,
        recipeId: recipeId || null,
        recipeName: activeRecipe ? activeRecipe.name : null,
        readings: batch.readings.map((r, i) => (i === 0 ? { ...r, date: startDate } : r)),
      });
    }
    setSaving(false);
    onClose();
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const handleDelete = () => setConfirmDelete(true);

  return (
    <>
    <Modal title={isNew ? "Schedule a brew" : "Edit scheduled brew"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C9A3C", fontSize: 12, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px", lineHeight: 1.5 }}>
          {isNew
            ? "Just block out the slot — no recipe, ingredients, or gravity readings needed yet. Fill those in on the day you actually brew."
            : "This is scheduled for a future date and hasn't started brewing yet — change anything below, or remove it entirely."}
        </div>

        {conflictingBatch && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "#7A3E1D", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 5, padding: "10px 12px", lineHeight: 1.5 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5 }}>
              <strong>{conflictingBatch.name}</strong> is still in this tank and hasn't moved out yet — this can't actually be brewed on {startDate} until that's cleared. Pick a later date, a different tank, or move {conflictingBatch.name} along first.
            </span>
          </div>
        )}

        <RecipeSearchField recipes={searchableRecipes} value={recipeId} onSelect={applyRecipe} />

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
        <div>
          <NumberField label="Batches to fill tank" value={brewDaysPlanned} onChange={setBrewDaysPlanned} step="1" />
          <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 4 }}>
            For a tank that takes more than one brew to fill — shows as a note on the calendar. Log each actual brew day from the batch itself once brewing starts.
          </div>
        </div>

        <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 4, overflow: "hidden" }}>
          {[
            [false, "One tank"],
            [true, "Split across tanks"],
          ].map(([mode, label]) => (
            <button
              key={String(mode)}
              onClick={() => setSplitMode(mode)}
              style={{
                flex: 1,
                background: splitMode === mode ? "#5C9A3C" : "#F5F1E4",
                border: "none",
                padding: "9px",
                color: splitMode === mode ? "#16191A" : "#5C6B54",
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {!splitMode ? (
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Tank</span>
            <select
              value={tankId}
              onChange={(e) => setTankId(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
            >
              <option value="">Unassigned</option>
              {sortedTanks(calendarTanks).map((t) => {
                const currentlyOccupied = tankIsOccupied(batches, t.id, batch?.id);
                const occupied = currentlyOccupied && startDate <= today();
                const occupant = currentlyOccupied ? occupyingBatch(batches, t.id, batch?.id) : null;
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
        ) : (
          <div>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>Tanks</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 5 }}>
              {splitRows.map((row) => (
                <div key={row.id} style={{ display: "flex", gap: 8 }}>
                  <select
                    value={row.tankId}
                    onChange={(e) => setSplitRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, tankId: e.target.value } : r)))}
                    style={{ flex: 2, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13.5 }}
                  >
                    <option value="">Pick a tank</option>
                    {sortedTanks(calendarTanks).map((t) => {
                      const currentlyOccupied = tankIsOccupied(batches, t.id, batch?.id);
                      const occupied = currentlyOccupied && startDate <= today();
                      return (
                        <option key={t.id} value={t.id} disabled={occupied}>
                          {t.name} ({t.capacity}L){occupied ? " — occupied" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <input
                    type="number"
                    step="0.5"
                    value={row.volume}
                    onChange={(e) => setSplitRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, volume: e.target.value } : r)))}
                    placeholder="Litres"
                    style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13.5 }}
                  />
                  {splitRows.length > 1 && (
                    <button
                      onClick={() => setSplitRows((prev) => prev.filter((r) => r.id !== row.id))}
                      style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
                      aria-label="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setSplitRows((prev) => [...prev, { id: uid(), tankId: "", volume: "" }])}
              style={{ marginTop: 8, background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", width: "100%", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
            >
              + Add another tank
            </button>
          </div>
        )}

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
          {saving ? "Saving…" : isNew ? "Schedule it" : "Save changes"}
        </button>
        {!isNew && (
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
        )}
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

// Lets Home show only what's actually useful day to day — hides the
// informational sections, never the time-sensitive ones (today's tasks,
// reminders, the tank wall itself stay put regardless), so there's no
// way to accidentally hide something that actually needs seeing.
export function CustomizeHomeModal({ hiddenSections, onToggle, onClose }) {
  const sections = [
    { key: "upcomingBrews", label: "Upcoming brews", description: "The strip showing scheduled brews ahead of time" },
    { key: "recentlyViewed", label: "Recently viewed", description: "Batches you've opened recently" },
    { key: "recentActivity", label: "Recent activity", description: "A log of what's changed lately" },
    { key: "needsAttention", label: "Needs attention", description: "Low stock and purchase orders awaiting delivery" },
  ];

  return (
    <Modal title="Customize Home" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Choose which sections show on Home. This is saved on this device only, so it won't affect anyone else who logs in here.
        </div>
        {sections.map((s) => {
          const hidden = hiddenSections.includes(s.key);
          return (
            <label key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer" }}>
              <div>
                <div style={{ color: "#2A3324", fontSize: 14 }}>{s.label}</div>
                <div style={{ color: "#9BA88A", fontSize: 12 }}>{s.description}</div>
              </div>
              <input type="checkbox" checked={!hidden} onChange={() => onToggle(s.key)} style={{ flexShrink: 0, width: 18, height: 18 }} />
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

export function HomeView({
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
  reminders,
  onAddReminder,
  onToggleReminder,
  onReorder,
}) {
  const [addingTodayReminder, setAddingTodayReminder] = useState(false);
  const [newTodayReminderText, setNewTodayReminderText] = useState("");
  const todayReminders = reminders.filter((r) => r.dueDate === today());

  const lowStock = inventory.filter((it) => it.qty <= it.threshold);
  const openOrders = purchaseOrders.filter((po) => po.status === "Sent");
  const upcomingScheduled = batches
    .filter((b) => isScheduledBatch(b))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .slice(0, 4);

  const daysSince = (dateStr) => Math.floor((new Date(today()) - new Date(dateStr)) / 86400000);

  const brewTasks = [...fermentingBatches, ...conditioningBatches]
    .filter((b) => !isScheduledBatch(b))
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

  const maintenanceByEquipment = {};
  foodSafetyRecords
    .filter((r) => r.category === "maintenance" && r.equipmentName)
    .forEach((r) => {
      const existing = maintenanceByEquipment[r.equipmentName];
      if (!existing || r.date > existing.date) maintenanceByEquipment[r.equipmentName] = r;
    });
  const overdueMaintenance = Object.values(maintenanceByEquipment).filter((r) => r.dueDate && r.dueDate < today());

  const foodSafetyTasks = [
    ...(!dailyDone ? [{ label: "Daily food safety checklist not done today" }] : []),
    ...(!weeklyDone ? [{ label: "Weekly food safety checklist not done in the last 7 days" }] : []),
    ...(!monthlyDone ? [{ label: "Monthly food safety checklist not done in the last month" }] : []),
    ...overdueCalibrations.map((r) => ({ label: `${r.equipmentName} calibration overdue (was due ${r.dueDate})` })),
    ...overdueMaintenance.map((r) => ({ label: `${r.equipmentName} maintenance overdue (was due ${r.dueDate})` })),
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
  const [hiddenHomeSections, setHiddenHomeSections] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("brewpoint-hidden-home-sections") || "[]");
    } catch {
      return [];
    }
  });
  const [showCustomizeHome, setShowCustomizeHome] = useState(false);
  const toggleHomeSection = (key) => {
    setHiddenHomeSections((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem("brewpoint-hidden-home-sections", JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const dismissSetup = () => {
    setSetupDismissed(true);
    try {
      localStorage.setItem("brewpoint-setup-dismissed", "true");
    } catch {}
  };

  const stats = [
    ["Fermenting", fermentingBatches.filter((b) => b.startDate <= today()).length, STAGE_COLOR.Primary, "batches"],
    ["Conditioning", conditioningBatches.length, STAGE_COLOR.Conditioning, "batches"],
    ["Packaging", inProgressBatches.length, "#D4A24C", "batches"],
    ["Packaged Batches", packagedBatches.length, "#9BA88A", "batches"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <button
        onClick={() => setShowCustomizeHome(true)}
        style={{ alignSelf: "flex-end", background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: -14 }}
      >
        Customize
      </button>
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

      {upcomingScheduled.length > 0 && !hiddenHomeSections.includes("upcomingBrews") && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Upcoming brews</span>
            <button
              onClick={() => onGoTo("production")}
              style={{ background: "none", border: "none", color: "#5C9A3C", fontSize: 12, fontFamily: "'Inter', sans-serif", cursor: "pointer", padding: 0 }}
            >
              View calendar
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {upcomingScheduled.map((b) => (
              <button
                key={b.id}
                onClick={() => onGoTo("production")}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  background: "#FBF8F0",
                  border: "1px dashed #B8AD8A",
                  borderRadius: 6,
                  padding: "8px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 130,
                }}
              >
                <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, color: "#2A3324", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {b.name}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#9B8F6F" }}>
                  {b.startDate}{b.tankName ? ` · ${b.tankName}` : b.splitTanks && b.splitTanks.length > 0 ? ` · ${b.splitTanks.length} tanks` : ""}
                </span>
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

      {(todayReminders.length > 0 || addingTodayReminder) && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Today</div>
            <button
              onClick={() => setAddingTodayReminder(true)}
              style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
            >
              + Add
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: totalTasks > 0 ? 0 : undefined }}>
            {todayReminders.map((r) => (
              <div
                key={r.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6 }}
              >
                <button
                  onClick={() => onToggleReminder(r.id, !r.done)}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `1.5px solid ${r.done ? "#5C9A3C" : "#C9D1AC"}`,
                    background: r.done ? "#5C9A3C" : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    cursor: "pointer",
                  }}
                >
                  {r.done && <CheckCircle2 size={12} color="#FFFFFF" />}
                </button>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#2A3324", textDecoration: r.done ? "line-through" : "none", opacity: r.done ? 0.6 : 1 }}>
                  {r.text}
                </div>
                <div style={{ width: 7, height: 7, borderRadius: 4, background: userColor(r.userName), flexShrink: 0 }} title={r.userName} />
              </div>
            ))}
            {addingTodayReminder && (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  autoFocus
                  type="text"
                  value={newTodayReminderText}
                  onChange={(e) => setNewTodayReminderText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTodayReminderText.trim()) {
                      onAddReminder(newTodayReminderText.trim(), today());
                      setNewTodayReminderText("");
                      setAddingTodayReminder(false);
                    }
                    if (e.key === "Escape") setAddingTodayReminder(false);
                  }}
                  placeholder="Add a reminder for today…"
                  style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
                />
                <button
                  onClick={() => {
                    if (!newTodayReminderText.trim()) { setAddingTodayReminder(false); return; }
                    onAddReminder(newTodayReminderText.trim(), today());
                    setNewTodayReminderText("");
                    setAddingTodayReminder(false);
                  }}
                  style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 14px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {(() => {
        const brewDayBatches = batches.filter((b) => {
          if (b.stage !== "Brewing") return false;
          if (b.startDate > today()) return false;
          if (b.mergedIntoBatchId) return false;
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
                    .map((t) => {
                      const occ = occupyingBatch(batches, t.id);
                      // A batch that's only scheduled hasn't actually
                      // started yet — the tank is genuinely still empty,
                      // so show its real state (CIP/sanitised) with a
                      // small note, not a fake "brewing" display.
                      const isScheduled = occ && occ.startDate > today();
                      return (
                        <TankWallCard
                          key={t.id}
                          tank={t}
                          batch={isScheduled ? null : occ}
                          scheduledBatch={isScheduled ? occ : null}
                          onOpen={onOpenBatch}
                          onQuickLog={onQuickLog}
                          onCycleClean={onCycleClean}
                          onSetCleanStage={onSetCleanStage}
                        />
                      );
                    })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {recentBatches.length > 0 && !hiddenHomeSections.includes("recentlyViewed") && (
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

      {activityLog.length > 0 && !hiddenHomeSections.includes("recentActivity") && (
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
        // A second brew day merged into its batch isn't a batch of its own.
        batches.filter((b) => !b.mergedIntoBatchId && b.startDate).forEach((b) => {
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
        // Only batches with a cost worked out count towards the average.
        batches.filter((b) => !b.mergedIntoBatchId && b.startDate && (b.ingredientCost || 0) > 0).forEach((b) => {
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

      {(lowStock.length > 0 || openOrders.length > 0) && !hiddenHomeSections.includes("needsAttention") && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
            Needs attention
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {lowStock.map((it) => (
              <div
                key={it.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "#F8F5EA",
                  border: "1px solid #E3D3A0",
                  borderRadius: 5,
                  fontSize: 13.5,
                }}
              >
                <button
                  onClick={() => onGoTo("inventory")}
                  style={{ display: "flex", alignItems: "center", gap: 6, color: "#2A3324", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0 }}
                >
                  <AlertTriangle size={13} color="#5C9A3C" style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name} running low</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#5C9A3C", fontSize: 12, flexShrink: 0 }}>
                    {item_qty(it)} {it.unit}
                  </span>
                </button>
                {onReorder && (
                  <button
                    onClick={() => onReorder(it)}
                    style={{ flexShrink: 0, marginLeft: 10, background: "#5C9A3C", border: "none", borderRadius: 4, padding: "5px 10px", color: "#16191A", fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    Reorder
                  </button>
                )}
              </div>
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
      {showCustomizeHome && (
        <CustomizeHomeModal hiddenSections={hiddenHomeSections} onToggle={toggleHomeSection} onClose={() => setShowCustomizeHome(false)} />
      )}
    </div>
  );
}
