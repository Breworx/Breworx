import { useState, Suspense } from "react";
import { Trash2, FlaskConical } from "lucide-react";
// Charts: recharts is imported directly. Lazy-loading each piece separately
// (as this used to) breaks recharts — a chart only draws children it
// recognises by type, so lazy-wrapped bars, lines and axes were skipped and
// every chart rendered as an empty frame.
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { EmptyState, Modal, TextField } from "./ui";
import { batchSpecDeviations } from "../lib/brewing";
import { activeRecipesByFamily, triangleTestSignificance, uid } from "../lib/production";
import { today } from "../lib/utils";

// A hand-built trend line, same approach as every other visual in this
// app — no external charting library, no container-measuring quirks that
// can silently render blank. Fixed viewBox scaled by the browser itself,
// so it can't end up with a zero-size drawing surface.
export function TrendChart({ points, valueKey, color, formatValue }) {
  const clean = points.filter((p) => p[valueKey] != null);
  if (clean.length < 2) return null;

  const values = clean.map((p) => p[valueKey]);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV;
  const pad = range === 0 ? Math.abs(minV) * 0.05 || 1 : range * 0.15;
  const lo = minV - pad;
  const hi = maxV + pad;

  const W = 600;
  const H = 160;
  const marginL = 46;
  const marginB = 22;
  const marginT = 10;
  const plotW = W - marginL - 14;
  const plotH = H - marginB - marginT;

  const xFor = (i) => marginL + (clean.length === 1 ? plotW / 2 : (i / (clean.length - 1)) * plotW);
  const yFor = (v) => marginT + plotH - ((v - lo) / (hi - lo)) * plotH;

  const linePath = clean.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p[valueKey]).toFixed(1)}`).join(" ");
  const gridValues = [lo + (hi - lo) * 0.1, lo + (hi - lo) * 0.5, lo + (hi - lo) * 0.9];

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
        {gridValues.map((v, i) => (
          <g key={i}>
            <line x1={marginL} x2={W} y1={yFor(v)} y2={yFor(v)} stroke="#EBE8D6" strokeWidth="1" />
            <text x="0" y={yFor(v) + 4} fontSize="11" fontFamily="'JetBrains Mono', monospace" fill="#9BA88A">
              {formatValue(v)}
            </text>
          </g>
        ))}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {clean.map((p, i) => (
          <circle key={p.id || i} cx={xFor(i)} cy={yFor(p[valueKey])} r="3.5" fill={color} />
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", color: "#9BA88A", marginLeft: marginL, marginTop: 2 }}>
        <span>{clean[0].date}</span>
        <span>{clean[clean.length - 1].date}</span>
      </div>
    </div>
  );
}

// Cross-batch quality tracking — the actual point of formal sensory
// scoring is spotting whether a recipe is tasting consistent batch to
// batch, which a score sitting on one batch's own page can't show. This
// pulls every scored batch of each recipe into one trend, plus release
// sign-offs and triangle test results, all in one dedicated area.
export function QcApprovalModal({ onClose, onSave }) {
  const [approvedBy, setApprovedBy] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (!approvedBy.trim()) return;
    onSave({ approvedBy: approvedBy.trim(), date, notes: notes.trim() });
    onClose();
  };

  return (
    <Modal title="Sign off for release" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          A formal record that someone reviewed this batch and approved it to move forward — who signed off, and when.
        </div>
        <TextField label="Approved by (required)" value={approvedBy} onChange={setApprovedBy} placeholder="Your name" />
        <TextField label="Date" type="date" value={date} onChange={setDate} />
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
          disabled={!approvedBy.trim()}
          style={{
            background: approvedBy.trim() ? "#5C9A3C" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: approvedBy.trim() ? "#16191A" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            cursor: approvedBy.trim() ? "pointer" : "default",
          }}
        >
          Confirm sign-off
        </button>
      </div>
    </Modal>
  );
}

export function TriangleTestModal({ batches, existingTest, onClose, onSave }) {
  const [testDate, setTestDate] = useState(existingTest?.testDate || today());
  const [batchAQuery, setBatchAQuery] = useState(existingTest?.batchAName || "");
  const [batchBQuery, setBatchBQuery] = useState(existingTest?.batchBName || "");
  const [batchAId, setBatchAId] = useState(existingTest?.batchAId || null);
  const [batchBId, setBatchBId] = useState(existingTest?.batchBId || null);
  const [focusedField, setFocusedField] = useState(null);
  const [purpose, setPurpose] = useState(existingTest?.purpose || "");
  const [responses, setResponses] = useState(existingTest?.responses || [{ id: uid(), tasterName: "", correct: true }]);

  const matches = (q) => (q.trim().length === 0 ? [] : batches.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6));

  const addResponse = () => setResponses((prev) => [...prev, { id: uid(), tasterName: "", correct: true }]);
  const updateResponse = (id, patch) => setResponses((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeResponse = (id) => setResponses((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const canSubmit = batchAQuery.trim() && batchBQuery.trim() && responses.some((r) => r.tasterName.trim());

  const submit = () => {
    if (!canSubmit) return;
    onSave({
      id: existingTest?.id,
      testDate,
      batchAId,
      batchAName: batchAQuery.trim(),
      batchBId,
      batchBName: batchBQuery.trim(),
      purpose: purpose.trim(),
      responses: responses.filter((r) => r.tasterName.trim()).map((r) => ({ tasterName: r.tasterName.trim(), correct: r.correct })),
    });
    onClose();
  };

  return (
    <Modal title="Triangle test" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 13 }}>
          Each taster is given three samples — two from one batch, one from the other, arranged randomly — and asked which one is the odd one out. Record whether each taster got it right; with enough tasters, this shows whether the two batches are genuinely distinguishable, not just scored differently.
        </div>
        <TextField label="Date" type="date" value={testDate} onChange={setTestDate} />
        <div style={{ position: "relative" }}>
          <TextField
            label="Batch A"
            value={batchAQuery}
            onChange={(v) => { setBatchAQuery(v); setBatchAId(null); }}
          />
          <input style={{ display: "none" }} onFocus={() => setFocusedField("a")} />
          <div onFocus={() => setFocusedField("a")} onBlur={() => setTimeout(() => setFocusedField(null), 150)} tabIndex={-1}>
            {focusedField === "a" && matches(batchAQuery).length > 0 && (
              <div style={{ position: "absolute", zIndex: 5, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, width: "100%", marginTop: 2 }}>
                {matches(batchAQuery).map((b) => (
                  <button
                    key={b.id}
                    onMouseDown={() => { setBatchAQuery(b.name); setBatchAId(b.id); setFocusedField(null); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: "none", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                  >
                    {b.name} <span style={{ color: "#9BA88A", fontSize: 11 }}>#{b.number}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <TextField
            label="Batch B"
            value={batchBQuery}
            onChange={(v) => { setBatchBQuery(v); setBatchBId(null); }}
          />
          <div onFocus={() => setFocusedField("b")} onBlur={() => setTimeout(() => setFocusedField(null), 150)} tabIndex={-1}>
            {focusedField === "b" && matches(batchBQuery).length > 0 && (
              <div style={{ position: "absolute", zIndex: 5, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, width: "100%", marginTop: 2 }}>
                {matches(batchBQuery).map((b) => (
                  <button
                    key={b.id}
                    onMouseDown={() => { setBatchBQuery(b.name); setBatchBId(b.id); setFocusedField(null); }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: "none", color: "#2A3324", fontSize: 13, cursor: "pointer" }}
                  >
                    {b.name} <span style={{ color: "#9BA88A", fontSize: 11 }}>#{b.number}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <TextField label="Purpose (optional)" value={purpose} onChange={setPurpose} placeholder="e.g. confirming a recipe tweak didn't change the flavor" />

        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Taster responses</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {responses.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                value={r.tasterName}
                onChange={(e) => updateResponse(r.id, { tasterName: e.target.value })}
                placeholder="Taster name"
                style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
              />
              <button
                onClick={() => updateResponse(r.id, { correct: !r.correct })}
                style={{
                  flexShrink: 0,
                  background: r.correct ? "#EBF3E4" : "#FBE5D2",
                  border: `1px solid ${r.correct ? "#5C9A3C" : "#E3B37A"}`,
                  borderRadius: 4,
                  padding: "8px 12px",
                  color: r.correct ? "#2A3324" : "#7A3E1D",
                  fontSize: 12.5,
                  cursor: "pointer",
                  width: 100,
                }}
              >
                {r.correct ? "Correct" : "Incorrect"}
              </button>
              <button onClick={() => removeResponse(r.id)} style={{ flexShrink: 0, background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: "4px" }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addResponse} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#5C9A3C", fontSize: 12.5, cursor: "pointer", padding: 0 }}>
          + Add another taster
        </button>

        {(() => {
          const validResponses = responses.filter((r) => r.tasterName.trim());
          const total = validResponses.length;
          const correct = validResponses.filter((r) => r.correct).length;
          if (total === 0) return null;
          const { significant } = triangleTestSignificance(correct, total);
          return (
            <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px", fontSize: 12.5 }}>
              <div style={{ color: "#2A3324" }}>
                {correct}/{total} correct — <span style={{ color: significant ? "#B5502F" : "#5C9A3C" }}>{significant ? "statistically distinguishable" : "not statistically distinguishable"}</span>
              </div>
              {total < 18 && <div style={{ color: "#9BA88A", marginTop: 2 }}>Fewer than 18 tasters — below the usual minimum for a reliable result.</div>}
            </div>
          );
        })()}

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
          Save triangle test
        </button>
      </div>
    </Modal>
  );
}

export function QualityControlView({ recipes, batches, onOpenBatch, onLogTriangleTest, triangleTests, onOpenTriangleTest }) {
  const recipeTrends = activeRecipesByFamily(recipes)
    .map((r) => {
      const scoredBatches = batches
        .filter((b) => b.recipeId === r.id && (b.sensoryScores || []).length > 0)
        .map((b) => {
          const values = b.sensoryScores.map((s) => s.scores?.overall).filter((v) => v != null);
          const avgOverall = values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
          return { batch: b, avgOverall, tasterCount: b.sensoryScores.length };
        })
        .filter((x) => x.avgOverall != null)
        .sort((a, b2) => (a.batch.startDate || "").localeCompare(b2.batch.startDate || ""));
      return { recipe: r, scoredBatches };
    })
    .filter((rt) => rt.scoredBatches.length > 0);

  const approvedBatches = batches.filter((b) => b.qcApproval).sort((a, b) => (b.qcApproval.date || "").localeCompare(a.qcApproval.date || ""));

  // Only recent, non-cancelled batches — an old batch from before a
  // recipe's tolerance was even set shouldn't show up as a stale flag
  // forever.
  const specDeviations = batches
    .filter((b) => b.stage !== "Cancelled")
    .map((b) => {
      const recipe = recipes.find((r) => r.id === b.recipeId);
      const deviations = batchSpecDeviations(b, recipe);
      return deviations.length > 0 ? { batch: b, deviations } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.batch.startDate || "").localeCompare(a.batch.startDate || ""));

  return (
    <div>
      {specDeviations.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>Spec deviations</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {specDeviations.map(({ batch, deviations }) => (
              <button
                key={batch.id}
                onClick={() => onOpenBatch(batch.id)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <span style={{ color: "#7A3E1D", fontSize: 13.5 }}>{batch.name}</span>
                <span style={{ color: "#7A3E1D", fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>
                  {deviations.map((d) => `${d.metric} ${d.direction} (${d.actual.toFixed(3)} vs ${d.target.toFixed(3)}±${d.tolerance})`).join(", ")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Consistency by recipe</div>
      </div>

      {recipeTrends.length === 0 ? (
        <EmptyState icon={FlaskConical} title="No sensory scores yet" subtitle="Once a couple of batches of the same recipe have been scored, their consistency over time will show up here." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 26 }}>
          {recipeTrends.map(({ recipe, scoredBatches }) => {
            const chartData = scoredBatches.map((x) => ({ label: x.batch.name, overall: Math.round(x.avgOverall * 10) / 10 }));
            const latest = scoredBatches[scoredBatches.length - 1].avgOverall;
            const first = scoredBatches[0].avgOverall;
            const trendDelta = scoredBatches.length > 1 ? Math.round((latest - first) * 10) / 10 : null;
            return (
              <div key={recipe.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, color: "#2A3324" }}>{recipe.name}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#9BA88A" }}>
                    {scoredBatches.length} batch{scoredBatches.length !== 1 ? "es" : ""} scored
                    {trendDelta != null && (
                      <span style={{ color: trendDelta < -0.5 ? "#B5502F" : "#5C9A3C", marginLeft: 8 }}>
                        {trendDelta > 0 ? "+" : ""}{trendDelta} since first
                      </span>
                    )}
                  </div>
                </div>
                {chartData.length > 1 ? (
                  <Suspense fallback={<div style={{ height: 120 }} />}>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={chartData} margin={{ top: 5, right: 14, left: -20, bottom: 0 }}>
                        <CartesianGrid stroke="#DDE0C8" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" stroke="#9BA88A" fontSize={10} tick={false} />
                        <YAxis domain={[0, 5]} stroke="#9BA88A" fontSize={11} />
                        <Tooltip contentStyle={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, fontSize: 12 }} labelStyle={{ color: "#5C6B54" }} />
                        <Line type="monotone" dataKey="overall" stroke="#5C9A3C" strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </Suspense>
                ) : (
                  <div style={{ color: "#9BA88A", fontSize: 12.5 }}>Only one batch scored so far — a trend needs at least two.</div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {scoredBatches.map((x) => (
                    <button
                      key={x.batch.id}
                      onClick={() => onOpenBatch(x.batch.id)}
                      style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 20, padding: "3px 10px", color: "#5C6B54", fontSize: 11.5, cursor: "pointer" }}
                    >
                      {x.batch.name}: {x.avgOverall.toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>Triangle tests</div>
        <button
          onClick={onLogTriangleTest}
          style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0 }}
        >
          + Log a triangle test
        </button>
      </div>
      {triangleTests.length === 0 ? (
        <div style={{ color: "#9BA88A", fontSize: 13, marginBottom: 26 }}>
          No triangle tests logged yet — a recognized method for checking whether two batches are actually distinguishable, not just scored differently.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 26 }}>
          {[...triangleTests].reverse().map((t) => {
            const total = t.responses.length;
            const correct = t.responses.filter((r) => r.correct).length;
            const { significant } = triangleTestSignificance(correct, total);
            return (
              <button
                key={t.id}
                onClick={() => onOpenTriangleTest(t)}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
              >
                <div>
                  <div style={{ color: "#2A3324", fontSize: 13.5 }}>{t.batchAName} vs {t.batchBName}</div>
                  {t.purpose && <div style={{ color: "#9BA88A", fontSize: 11.5, marginTop: 2 }}>{t.purpose}</div>}
                  {total < 18 && <div style={{ color: "#9BA88A", fontSize: 11, marginTop: 2 }}>Fewer than 18 tasters — below the usual minimum for a reliable result</div>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, color: "#5C6B54" }}>{correct}/{total} correct</div>
                  <div style={{ fontSize: 11, color: significant ? "#B5502F" : "#5C9A3C", marginTop: 2 }}>
                    {significant ? "Distinguishable" : "Not distinguishable"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>Recent release sign-offs</div>
      {approvedBatches.length === 0 ? (
        <div style={{ color: "#9BA88A", fontSize: 13 }}>No batches formally signed off yet — this happens from a batch's own page once it's ready to release.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {approvedBatches.slice(0, 10).map((b) => (
            <button
              key={b.id}
              onClick={() => onOpenBatch(b.id)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, cursor: "pointer", textAlign: "left", width: "100%", boxSizing: "border-box" }}
            >
              <span style={{ color: "#2A3324", fontSize: 13.5 }}>{b.name}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, color: "#9BA88A" }}>{b.qcApproval.approvedBy} · {b.qcApproval.date}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
