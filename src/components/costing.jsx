import { useState, useMemo, useEffect } from "react";
import { ChevronLeft, Plus, Trash2, Copy, AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { COSTING_FORMATS, DEFAULT_COSTING, costProduct, costingFromRecipe, priceForMargin } from "../lib/costing";
import { normItemName, uid } from "../lib/production";
import { PRODUCT_TYPES } from "../lib/excise";
import { today } from "../lib/utils";

// ─── Costing ────────────────────────────────────────────────────────────────
// Price a product before deciding to make it: ingredients from stock prices
// (or the old costing sheet where stock has none), excise at today's rate,
// packaging and delivery per keg or case, and the margin at your sale price.
// Everything is editable per costing; company defaults fill the gaps.

const money = (n, dp = 2) => (n == null || !Number.isFinite(n) ? "—" : `$${n.toFixed(dp)}`);
const pct = (n) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(0)}%`);
const marginColour = (p) => (p == null ? "#9BA88A" : p < 15 ? "#B5502F" : p < 30 ? "#8A6D0B" : "#3F7A2A");
const input = { width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 9px", color: "#2A3324", fontSize: 14, fontFamily: "'Inter', sans-serif" };
const mono = { fontFamily: "'JetBrains Mono', monospace" };
const card = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 14px", marginBottom: 12 };
const head = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 };
const btn = { background: "#5C9A3C", border: "none", borderRadius: 5, padding: "9px 13px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
const btn2 = { background: "#FFFFFF", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontSize: 12.5, cursor: "pointer", fontFamily: "'Inter', sans-serif", display: "inline-flex", alignItems: "center", gap: 6 };
const label = { fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase", color: "#5C6B54", marginBottom: 4, display: "block" };

// Text or number box that saves when you leave it (or press Enter).
function Field({ value, onCommit, type = "number", placeholder, style, step = "any", prefix, suffix, ariaLabel }) {
  const shown = value == null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    if (draft === shown) return;
    if (type === "number") onCommit(draft.trim() === "" ? null : Number(draft));
    else onCommit(draft);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, ...style }}>
      {prefix && <span style={{ fontSize: 13, color: "#5C6B54" }}>{prefix}</span>}
      <input
        aria-label={ariaLabel}
        type={type}
        inputMode={type === "number" ? "decimal" : undefined}
        step={step}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        style={{ ...input, ...(type === "number" ? mono : {}) }}
      />
      {suffix && <span style={{ fontSize: 13, color: "#5C6B54", whiteSpace: "nowrap" }}>{suffix}</span>}
    </div>
  );
}

const flagText = (l) => {
  if (l.flag === "odd") return `Stock price $${l.stockPrice}/${l.stockUnit} looks wrong — using $${l.sheetPrice}/${l.sheetUnit} from your sheet`;
  if (l.flag === "zero") return l.source === "sheet" ? `Stock has $0 for this — using $${l.sheetPrice}/${l.sheetUnit} from your sheet` : "Stock has $0 for this — set a price";
  if (l.flag === "missing") return l.source === "sheet" ? `No stock price — using $${l.sheetPrice}/${l.sheetUnit} from your sheet` : "No price — set one";
  return null;
};
const sourceText = (l) => (l.source === "stock" ? `stock${l.stockDate ? ` · ${String(l.stockDate).slice(0, 10)}` : ""}` : l.source === "sheet" ? "sheet" : l.source === "manual" ? "set by you" : "");

export function CostingView({ costing, inventory, recipes, labelStrengths, onSave, onFixStockPrice }) {
  const data = costing || {};
  const products = data.products || [];
  const [openId, setOpenId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fromRecipe, setFromRecipe] = useState("");
  const [query, setQuery] = useState("");
  const todayStr = today();
  const save = (patch) => onSave({ ...data, ...patch });
  const saveProduct = (id, patch) => save({ products: products.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: todayStr } : p)) });
  const addProduct = (p) => { save({ products: [p, ...products] }); setOpenId(p.id); };

  const costed = useMemo(
    () => products.map((p) => ({ p, c: costProduct(p, { inventory, costing: data, todayStr }) })),
    [products, inventory, data, todayStr],
  );
  const open = costed.find((x) => x.p.id === openId);
  const activeRecipes = recipes.filter((r) => r.isActive !== false).sort((a, b) => a.name.localeCompare(b.name));

  if (open) {
    return (
      <CostingDetail
        product={open.p}
        result={open.c}
        data={data}
        inventory={inventory}
        onBack={() => setOpenId(null)}
        onChange={(patch) => saveProduct(open.p.id, patch)}
        onSetPrice={(name, price, unit) => {
          const prices = { ...(data.prices || {}) };
          if (price == null) delete prices[normItemName(name)];
          else prices[normItemName(name)] = { price, unit, date: todayStr };
          save({ prices });
        }}
        onFixStockPrice={onFixStockPrice}
        onDuplicate={() => addProduct({ ...open.p, id: uid(), name: `${open.p.name} (copy)`, source: "copy", createdAt: todayStr, ingredients: (open.p.ingredients || []).map((l) => ({ ...l, id: uid() })) })}
        onDelete={() => { save({ products: products.filter((p) => p.id !== open.p.id) }); setOpenId(null); }}
      />
    );
  }

  const shown = costed.filter(({ p }) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 26, fontWeight: 500, color: "#2A3324", margin: "0 0 4px" }}>Costing</h1>
      <div style={{ fontSize: 13, color: "#5C6B54", lineHeight: 1.5, marginBottom: 14 }}>
        Cost a product before you decide to make it. Ingredients use your latest stock prices (freight included); anything stock has no good price for falls back to your costing sheet and is flagged. All figures ex GST.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button type="button" style={btn} onClick={() => addProduct({ id: uid(), name: "New product", productType: "Beer", yieldL: null, abv: null, ingredients: [], formats: {}, source: "new", createdAt: todayStr })}>
          <Plus size={15} /> New costing
        </button>
        <select value={fromRecipe} onChange={(e) => {
          const r = recipes.find((x) => x.id === e.target.value);
          setFromRecipe("");
          if (r) addProduct({ ...costingFromRecipe(r, labelStrengths, uid), createdAt: todayStr });
        }} style={{ ...input, width: "auto", flex: "1 1 180px", fontSize: 13 }}>
          <option value="">Start from a recipe…</option>
          {activeRecipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button type="button" style={btn2} onClick={() => setShowSettings((v) => !v)}><SettingsIcon size={14} /> Defaults</button>
      </div>

      {showSettings && <CostingDefaults data={data} onSave={save} />}

      {products.length > 6 && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search costings" style={{ ...input, marginBottom: 12 }} />
      )}

      {products.length === 0 && <div style={{ ...card, fontSize: 13, color: "#5C6B54" }}>No costings yet. Start a new one or copy a recipe.</div>}

      {shown.map(({ p, c }) => (
        <button key={p.id} type="button" onClick={() => setOpenId(p.id)} style={{ ...card, display: "block", width: "100%", textAlign: "left", cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <div style={{ fontSize: 15, color: "#2A3324", fontWeight: 500 }}>{p.name}</div>
            <div style={{ fontSize: 11.5, color: "#9BA88A", whiteSpace: "nowrap" }}>
              {p.abv ? `${p.abv}%` : "no ABV"} · {c.yieldL ? `${c.yieldL}L` : "no yield"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
            {c.formats.map((f) => (
              <div key={f.key} style={{ fontSize: 12 }}>
                <span style={{ color: "#5C6B54" }}>{f.label.replace(" × 330ml case", " case")} </span>
                <span style={{ ...mono, color: marginColour(f.marginPct) }}>{f.price != null ? pct(f.marginPct) : money(f.cost)}</span>
              </div>
            ))}
          </div>
          {c.flagged.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#8A6D0B", marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
              <AlertTriangle size={12} /> {c.flagged.length} ingredient price{c.flagged.length === 1 ? "" : "s"} to check
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function CostingDefaults({ data, onSave }) {
  const d = { ...DEFAULT_COSTING, ...(data.defaults || {}), formats: { ...DEFAULT_COSTING.formats, ...((data.defaults || {}).formats || {}) } };
  const setFormat = (key, field, v) => onSave({ defaults: { ...d, formats: { ...d.formats, [key]: { ...d.formats[key], [field]: v } } } });
  return (
    <div style={card}>
      <div style={head}>Defaults for new costings</div>
      <div style={{ fontSize: 12.5, color: "#5C6B54", marginBottom: 10, lineHeight: 1.5 }}>
        Used wherever a costing doesn't set its own. Change them here when can, label or keg prices move.
      </div>
      {COSTING_FORMATS.map((f) => (
        <div key={f.key} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: "#2A3324", marginBottom: 4 }}>{f.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            <div><span style={label}>{f.packagingLabel}</span><Field value={d.formats[f.key].packaging} onCommit={(v) => setFormat(f.key, "packaging", v)} prefix="$" /></div>
            <div><span style={label}>Delivery</span><Field value={d.formats[f.key].delivery} onCommit={(v) => setFormat(f.key, "delivery", v)} prefix="$" /></div>
            <div><span style={label}>Litres</span><Field value={d.formats[f.key].litres} onCommit={(v) => setFormat(f.key, "litres", v)} suffix="L" /></div>
          </div>
        </div>
      ))}
      <div style={{ maxWidth: 180 }}>
        <span style={label}>RRP markup</span>
        <Field value={d.rrpMarkupPct} onCommit={(v) => onSave({ defaults: { ...d, rrpMarkupPct: v } })} suffix="%" />
      </div>
    </div>
  );
}

const UNITS = ["kg", "g", "L", "ml", "pkg", "ea"];
const CATEGORIES = ["Grain", "Hops", "Yeast", "Juice", "Other"];

function CostingDetail({ product, result, data, inventory, onBack, onChange, onSetPrice, onFixStockPrice, onDuplicate, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [targets, setTargets] = useState({});
  const ings = product.ingredients || [];
  const setIng = (id, patch) => onChange({ ingredients: ings.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const setFormat = (key, field, v) => onChange({ formats: { ...(product.formats || {}), [key]: { ...((product.formats || {})[key] || {}), [field]: v } } });
  const stockNames = useMemo(() => [...new Set(inventory.map((i) => i.name))].sort(), [inventory]);
  const sheetNames = (data.sheetPrices || []).filter((p) => !p.stockName).map((p) => p.name);
  const r = result;
  const dutyPerL = r.duty.excise + r.duty.levy;

  return (
    <div style={{ maxWidth: 820 }}>
      <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 14 }}>
        <ChevronLeft size={16} /> All costings
      </button>

      <Field type="text" value={product.name} onCommit={(v) => onChange({ name: v.trim() || "Untitled" })} ariaLabel="Product name" style={{ marginBottom: 10 }} />

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>Type</span>
            <select value={product.productType || "Beer"} onChange={(e) => onChange({ productType: e.target.value })} style={input}>
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div><span style={label}>Litres you'll package</span><Field value={product.yieldL} onCommit={(v) => onChange({ yieldL: v })} suffix="L" /></div>
          <div><span style={label}>ABV (for excise)</span><Field value={product.abv} onCommit={(v) => onChange({ abv: v })} suffix="%" step="0.1" /></div>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, fontSize: 12.5, color: "#5C6B54" }}>
          <div>Ingredients <span style={{ ...mono, color: "#2A3324" }}>{money(r.ingredients)}</span></div>
          <div>Per litre <span style={{ ...mono, color: "#2A3324" }}>{r.yieldL ? money(r.ingredientsPerL) : "set litres"}</span></div>
          <div>Excise + levy per litre <span style={{ ...mono, color: "#2A3324" }}>{product.abv ? money(dutyPerL) : "set ABV"}</span></div>
        </div>
        {product.sheetExcisePerL != null && (
          <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 6 }}>
            Your sheet used {money(product.sheetExcisePerL)}/L excise{product.abv ? "" : " — enter the ABV to work it out at today's rate"}.
          </div>
        )}
      </div>

      <div style={card}>
        <div style={head}>Margins</div>
        {r.formats.map((f) => {
          const fs = (product.formats || {})[f.key] || {};
          return (
            <div key={f.key} style={{ borderTop: "1px solid #EEF0E2", paddingTop: 10, marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontSize: 14, color: "#2A3324", fontWeight: 500 }}>{f.label}</div>
                <div style={{ ...mono, fontSize: 14, color: marginColour(f.marginPct) }}>
                  {f.price != null ? `${money(f.margin)} · ${pct(f.marginPct)}` : "set a price"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginTop: 8 }}>
                <div><span style={label}>Sale price</span><Field value={fs.price} onCommit={(v) => setFormat(f.key, "price", v)} prefix="$" /></div>
                <div><span style={label}>{f.packagingLabel}</span><Field value={fs.packaging} placeholder={f.defaults.packaging != null ? String(f.defaults.packaging) : ""} onCommit={(v) => setFormat(f.key, "packaging", v)} prefix="$" /></div>
                <div><span style={label}>Delivery</span><Field value={fs.delivery} placeholder={f.defaults.delivery != null ? String(f.defaults.delivery) : ""} onCommit={(v) => setFormat(f.key, "delivery", v)} prefix="$" /></div>
                <div>
                  <span style={label}>Price for margin</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Field value={targets[f.key] ?? ""} onCommit={(v) => setTargets((t) => ({ ...t, [f.key]: v }))} suffix="%" />
                  </div>
                </div>
              </div>
              {targets[f.key] != null && targets[f.key] !== "" && priceForMargin(f.cost, Number(targets[f.key])) != null && (
                <div style={{ fontSize: 12.5, color: "#5C6B54", marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {targets[f.key]}% margin needs {money(priceForMargin(f.cost, Number(targets[f.key])))}
                  <button type="button" style={{ ...btn2, padding: "4px 9px" }} onClick={() => setFormat(f.key, "price", Math.round(priceForMargin(f.cost, Number(targets[f.key])) * 100) / 100)}>Use this price</button>
                </div>
              )}
              <div style={{ fontSize: 12, color: "#9BA88A", marginTop: 6, lineHeight: 1.5 }}>
                Cost {money(f.cost)} = liquid {money(f.liquid)} + excise {money(f.excise)} + {f.packagingLabel.toLowerCase()} {money(f.packaging)} + delivery {money(f.delivery)} · {f.litres}L
                {f.rrp != null && <> · RRP 6-pack {money(f.rrp)} (at {r.markup}% markup)</>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={card}>
        <div style={head}>Ingredients</div>
        <datalist id="costing-ingredients">
          {stockNames.map((n) => <option key={n} value={n} />)}
          {sheetNames.map((n) => <option key={`s-${n}`} value={n} />)}
        </datalist>
        {r.lines.map((l) => {
          const raw = ings.find((x) => x.id === l.id) || {};
          const warn = flagText(l);
          const fixable = l.item && (l.flag === "odd" || l.flag === "zero") && l.price != null;
          return (
            <div key={l.id} style={{ borderTop: "1px solid #EEF0E2", padding: "9px 0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 82px 70px 28px", gap: 6, alignItems: "center" }}>
                <IngredientName value={raw.name} onCommit={(v) => setIng(l.id, { name: v })} />
                <Field value={raw.qty} onCommit={(v) => setIng(l.id, { qty: v || 0 })} ariaLabel="Amount" />
                <select value={raw.unit || "kg"} onChange={(e) => setIng(l.id, { unit: e.target.value })} style={{ ...input, padding: "8px 4px" }}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => onChange({ ingredients: ings.filter((x) => x.id !== l.id) })} style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}><Trash2 size={14} /></button>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: "#5C6B54", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={mono}>{l.price != null ? `${money(l.price, l.price < 1 ? 4 : 2)}/${l.unit}` : "no price"}</span>
                  <span style={{ color: "#9BA88A" }}>{sourceText(l)}</span>
                  <PriceSetter line={l} onSet={(p) => onSetPrice(l.name, p, l.unit)} />
                </div>
                <div style={{ ...mono, fontSize: 13, color: "#2A3324" }}>{money(l.cost)}</div>
              </div>
              {warn && (
                <div style={{ fontSize: 11.5, color: l.price == null ? "#B5502F" : "#8A6D0B", marginTop: 4, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <AlertTriangle size={12} /> {warn}
                  {fixable && (
                    <button type="button" style={{ ...btn2, padding: "3px 8px", fontSize: 11.5 }} onClick={() => onFixStockPrice(l.item, l.price, l.unit)}>
                      Correct the stock price too
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" style={btn2} onClick={() => onChange({ ingredients: [...ings, { id: uid(), name: "", qty: 0, unit: "kg", category: CATEGORIES[0] }] })}>
            <Plus size={14} /> Add ingredient
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "#9BA88A", marginTop: 8, lineHeight: 1.5 }}>
          Pick a stock item to use its latest price. Prices you set here are used for costing only, unless you correct the stock price too.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 30 }}>
        <button type="button" style={btn2} onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
        {!confirmDelete ? (
          <button type="button" style={{ ...btn2, color: "#B5502F" }} onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete</button>
        ) : (
          <>
            <button type="button" style={{ ...btn2, color: "#FFFFFF", background: "#B5502F", borderColor: "#B5502F" }} onClick={onDelete}>Delete {product.name}</button>
            <button type="button" style={btn2} onClick={() => setConfirmDelete(false)}>Keep it</button>
          </>
        )}
      </div>
    </div>
  );
}

function IngredientName({ value, onCommit }) {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => setDraft(value || ""), [value]);
  return (
    <input
      list="costing-ingredients"
      value={draft}
      placeholder="Ingredient"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== (value || "") && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{ ...input, minWidth: 0 }}
    />
  );
}

// "Set price" → a small box; clearing it goes back to stock/sheet pricing.
function PriceSetter({ line, onSet }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, padding: 0, textDecoration: "underline" }}>
        {line.source === "manual" ? "change" : "set price"}
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <Field value={line.source === "manual" ? line.price : null} placeholder={line.price != null ? line.price.toFixed(2) : ""} onCommit={(v) => { onSet(v); setOpen(false); }} prefix="$" suffix={`/${line.unit}`} style={{ width: 150 }} />
      {line.source === "manual" && (
        <button type="button" onClick={() => { onSet(null); setOpen(false); }} style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 11.5 }}>use stock</button>
      )}
      <button type="button" aria-label="Cancel" onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 14 }}>×</button>
    </span>
  );
}
