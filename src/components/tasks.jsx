// Production tasks (keg cleaning, kegging, canning…) and the keg pool —
// Kegstar or own kegs counted in piles: dirty, clean, full, out.
import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Modal } from "./ui";
import { TASK_KINDS, taskKind } from "../lib/tasks";
import { addDays, today } from "../lib/utils";

const ink = "#2A3324";
const muted = "#5C6B54";
const faint = "#9BA88A";
const green = "#5C9A3C";
const warn = "#B5502F";
const input = { boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "8px 10px", color: ink, fontFamily: "'Inter', sans-serif", fontSize: 14 };
const btn = (primary) => ({ background: primary ? green : "#FFFFFF", border: primary ? "none" : "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: primary ? "#16191A" : ink, fontFamily: primary ? "'Oswald', sans-serif" : "'Inter', sans-serif", fontWeight: primary ? 500 : 400, fontSize: 13, cursor: "pointer" });
const label = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: faint };

export const fmtTaskDay = (iso) => {
  if (!iso) return "";
  const t = today();
  if (iso === t) return "Today";
  if (iso === addDays(t, 1)) return "Tomorrow";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
};

function KindDot({ kind, hollow }) {
  const c = taskKind(kind)?.color || faint;
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 5, flexShrink: 0, background: hollow ? "transparent" : c, border: `2px solid ${c}`, boxSizing: "border-box" }} />;
}

// One task line: tick, text, detail, move date, dismiss/delete.
export function TaskRow({ task, onAction, readOnly, showDate }) {
  const [moving, setMoving] = useState(false);
  const overdue = !task.done && task.dueDate < today();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: task.suggested ? "#FBFAF4" : "#FFFFFF", border: `1px ${task.suggested ? "dashed" : "solid"} ${overdue ? warn : "#DDE0C8"}`, borderRadius: 6 }}>
      {!readOnly ? (
        <button
          onClick={() => onAction(task, "toggle")}
          aria-label={task.done ? "Mark not done" : "Mark done"}
          style={{ width: 20, height: 20, marginTop: 1, borderRadius: 4, border: `1.5px solid ${task.done ? green : "#C9D1AC"}`, background: task.done ? green : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}
        >
          {task.done && <CheckCircle2 size={13} color="#FFFFFF" />}
        </button>
      ) : (
        <span style={{ marginTop: 5 }}><KindDot kind={task.kind} hollow={task.suggested} /></span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {!readOnly && <KindDot kind={task.kind} hollow={task.suggested} />}
          <span style={{ fontSize: 13.5, color: ink, textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.6 : 1 }}>{task.text}</span>
          {task.suggested && <span style={{ fontSize: 10.5, color: muted, background: "#EEF3E6", borderRadius: 10, padding: "1px 7px", display: "inline-flex", alignItems: "center", gap: 3 }}><Sparkles size={10} /> Suggested</span>}
        </div>
        {task.detail && <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>{task.detail}</div>}
        <div style={{ fontSize: 11.5, color: overdue ? warn : faint, marginTop: 3 }}>
          {showDate ? fmtTaskDay(task.dueDate) : ""}
          {overdue ? `${showDate ? " · " : ""}overdue` : ""}
          {task.done && task.doneBy ? `${showDate || overdue ? " · " : ""}done by ${task.doneBy}${task.qty ? ` (${task.qty})` : ""}` : ""}
        </div>
        {moving && !readOnly && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" defaultValue={task.dueDate} onChange={(e) => { if (e.target.value) { onAction(task, "move", e.target.value); setMoving(false); } }} style={{ ...input, padding: "5px 8px", fontSize: 13 }} />
            {[-1, 1, 2].map((n) => (
              <button key={n} type="button" style={{ ...btn(false), padding: "5px 9px", fontSize: 12 }} onClick={() => { onAction(task, "move", addDays(task.dueDate, n)); setMoving(false); }}>{n > 0 ? `+${n} day${n > 1 ? "s" : ""}` : "−1 day"}</button>
            ))}
          </div>
        )}
      </div>
      {!readOnly && !task.done && (
        <button type="button" onClick={() => setMoving((m) => !m)} style={{ background: "none", border: "none", color: muted, fontSize: 12, cursor: "pointer", padding: "2px 4px", flexShrink: 0 }}>Move</button>
      )}
      {!readOnly && (
        <button type="button" onClick={() => onAction(task, task.suggested ? "dismiss" : "delete")} aria-label={task.suggested ? "Not needed" : "Delete"} title={task.suggested ? "Not needed" : "Delete"} style={{ background: "none", border: "none", color: faint, cursor: "pointer", padding: 2, flexShrink: 0 }}>
          {task.suggested ? <X size={14} /> : <Trash2 size={13} />}
        </button>
      )}
    </div>
  );
}

function AddTaskForm({ date, onAdd, compact }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("other");
  const [day, setDay] = useState(date || today());
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), date || day, kind);
    setText("");
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...input, padding: "8px 6px" }}>
        {TASK_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
      </select>
      {!date && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={input} />}
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={compact ? "Add a task…" : "e.g. Clean 6 kegs, CIP Tank 3…"} style={{ ...input, flex: 1, minWidth: 160 }} />
      <button type="button" onClick={submit} style={btn(true)}>Add</button>
    </div>
  );
}

// The Production page's to-do list: overdue + the next fortnight.
export function TasksPanel({ tasks, onAction, onAdd, kegNeeds = [], readOnly, onOpenKegs }) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const until = addDays(today(), 14);
  const upcoming = tasks.filter((x) => !x.done && x.dueDate <= until);
  const doneToday = tasks.filter((x) => x.done && (x.doneAt || "").slice(0, 10) === today());
  const list = showAll ? upcoming : upcoming.slice(0, 8);
  const short = kegNeeds.filter((n) => n.short > 0);
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "'Oswald', sans-serif", fontSize: 16, color: ink }}>
          Tasks {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <span style={{ fontSize: 12.5, color: muted }}>{upcoming.length} in the next 2 weeks</span>
        <div style={{ flex: 1 }} />
        {!readOnly && <button type="button" onClick={() => setAdding((a) => !a)} style={{ ...btn(false), display: "flex", alignItems: "center", gap: 5, padding: "6px 10px" }}><Plus size={13} /> Add task</button>}
      </div>
      {open && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {adding && !readOnly && <div style={{ marginBottom: 6 }}><AddTaskForm onAdd={(t, d, k) => { onAdd(t, d, k); setAdding(false); }} /></div>}
          {short.length > 0 && (
            <div style={{ background: "#FBF1EA", border: "1px solid #E7C3AE", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: ink }}>
              <b>Kegs:</b> {short.map((n) => `need ${n.needed} × ${n.sizeL}L in the next 2 weeks, ${n.clean} clean${n.dirty ? `, ${n.dirty} to clean` : ""}`).join(" · ")}
              {onOpenKegs && <button type="button" onClick={onOpenKegs} style={{ background: "none", border: "none", color: green, cursor: "pointer", fontSize: 13, padding: "0 0 0 6px" }}>Keg pool →</button>}
            </div>
          )}
          {list.length === 0 && <div style={{ fontSize: 13, color: faint }}>Nothing due in the next two weeks.</div>}
          {list.map((x) => <TaskRow key={x.id} task={x} onAction={onAction} readOnly={readOnly} showDate />)}
          {upcoming.length > 8 && <button type="button" onClick={() => setShowAll((v) => !v)} style={{ background: "none", border: "none", color: green, cursor: "pointer", fontSize: 13, alignSelf: "flex-start", padding: 0 }}>{showAll ? "Show fewer" : `Show all ${upcoming.length}`}</button>}
          {doneToday.length > 0 && <div style={{ fontSize: 12, color: faint }}>Done today: {doneToday.map((x) => x.text).join(" · ")}</div>}
          <div style={{ fontSize: 11.5, color: faint, marginTop: 2 }}>Dashed ones are suggestions from what's in the tanks — tick, move or ✕ them and they're saved. They get better as you package and clean.</div>
        </div>
      )}
    </div>
  );
}

export function TaskDayModal({ date, tasks, onClose, onAdd, onAction, readOnly }) {
  const day = tasks.filter((x) => x.dueDate === date);
  const title = new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {day.map((x) => <TaskRow key={x.id} task={x} onAction={onAction} readOnly={readOnly} />)}
          {day.length === 0 && <div style={{ color: faint, fontSize: 13 }}>Nothing on this day yet.</div>}
        </div>
        {!readOnly && <AddTaskForm date={date} onAdd={onAdd} compact />}
      </div>
    </Modal>
  );
}

// Ticking off keg cleaning: how many of each went onto the clean pile.
export function KegCleanModal({ task, pools, onClose, onSave }) {
  const suggested = {};
  pools.forEach((p) => {
    const key = Object.keys(task?.kegs || {}).find((k) => Math.abs(Number(k.replace("kegs", "")) - p.sizeL) < 0.01);
    suggested[p.id] = key ? Math.min(task.kegs[key], p.dirty || task.kegs[key]) : "";
  });
  const [counts, setCounts] = useState(suggested);
  const [date, setDate] = useState(today());
  return (
    <Modal title="Kegs cleaned" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, color: muted }}>{task?.text ? `${task.text}. ` : ""}How many went onto the clean pile?</div>
        {pools.map((p) => (
          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, fontSize: 14, color: ink }}>{p.name} <span style={{ color: faint, fontSize: 12 }}>({p.dirty} dirty)</span></span>
            <input type="number" min="0" inputMode="numeric" value={counts[p.id] ?? ""} onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })} style={{ ...input, width: 90 }} />
          </label>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, fontSize: 13, color: muted }}>Cleaned on</span>
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} style={input} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ ...btn(true), flex: 1, padding: 11 }} onClick={() => onSave(task, counts, date)}>Save</button>
          {task?.text && <button type="button" style={btn(false)} onClick={() => onSave(task, {}, date)}>Just tick it off</button>}
        </div>
      </div>
    </Modal>
  );
}

function PoolEditor({ pool, onSave, onCancel, onDelete }) {
  const [p, setP] = useState(pool || { name: "Kegstar 50L", sizeL: 50, owner: "kegstar", total: "", dirty: "", clean: "" });
  const ok = p.name?.trim() && Number(p.sizeL) > 0;
  return (
    <div style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ flex: 2, minWidth: 140 }}><div style={label}>Name</div><input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} style={{ ...input, width: "100%" }} /></label>
        <label style={{ flex: 1, minWidth: 90 }}><div style={label}>Size</div>
          <select value={p.sizeL} onChange={(e) => setP({ ...p, sizeL: Number(e.target.value) })} style={{ ...input, width: "100%" }}>{[20, 30, 50].map((v) => <option key={v} value={v}>{v}L</option>)}</select>
        </label>
        <label style={{ flex: 1, minWidth: 110 }}><div style={label}>Whose</div>
          <select value={p.owner} onChange={(e) => setP({ ...p, owner: e.target.value })} style={{ ...input, width: "100%" }}><option value="kegstar">Kegstar (hired)</option><option value="own">Our own</option><option value="other">Other hire</option></select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["total", "How many we have"], ["dirty", "Dirty now"], ["clean", "Clean now"]].map(([k, l]) => (
          <label key={k} style={{ flex: 1, minWidth: 90 }}><div style={label}>{l}</div><input type="number" min="0" inputMode="numeric" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} style={{ ...input, width: "100%" }} /></label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!ok} style={{ ...btn(true), opacity: ok ? 1 : 0.5 }} onClick={() => onSave(p)}>Save</button>
        <button type="button" style={btn(false)} onClick={onCancel}>Cancel</button>
        <div style={{ flex: 1 }} />
        {onDelete && <button type="button" style={{ ...btn(false), color: warn }} onClick={onDelete}>Remove</button>}
      </div>
    </div>
  );
}

function PoolAction({ pool, kind, onDone, onMove }) {
  const [n, setN] = useState(kind === "count" ? { dirty: pool.dirty, clean: pool.clean } : "");
  const [note, setNote] = useState("");
  const titles = { clean: "Cleaned", in: "Kegs in to clean", fill: "Filled (not through packaging)" };
  const save = async () => { if (await onMove(pool, kind, n, today(), note || undefined)) onDone(); };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      {kind === "count" ? (
        <>
          <span style={{ fontSize: 12.5, color: muted }}>Counted:</span>
          <input type="number" min="0" value={n.dirty} onChange={(e) => setN({ ...n, dirty: e.target.value })} style={{ ...input, width: 70 }} /> <span style={{ fontSize: 12.5, color: muted }}>dirty</span>
          <input type="number" min="0" value={n.clean} onChange={(e) => setN({ ...n, clean: e.target.value })} style={{ ...input, width: 70 }} /> <span style={{ fontSize: 12.5, color: muted }}>clean</span>
        </>
      ) : (
        <>
          <span style={{ fontSize: 12.5, color: muted }}>{titles[kind]}:</span>
          <input type="number" min="1" inputMode="numeric" autoFocus value={n} onChange={(e) => setN(e.target.value)} style={{ ...input, width: 80 }} />
          {kind === "in" && <input placeholder="Note (e.g. new Kegstar delivery)" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, flex: 1, minWidth: 140 }} />}
        </>
      )}
      <button type="button" style={btn(true)} onClick={save}>Save</button>
      <button type="button" style={btn(false)} onClick={onDone}>Cancel</button>
    </div>
  );
}

// Keg pool: each kind of keg counted in piles. Full kegs come from finished
// stock; "out" is whatever's left of the total (at venues / back with Kegstar).
export function KegPoolsPanel({ pools, fullBySize = {}, kegNeeds = [], log = [], onSave, onDelete, onMove, readOnly }) {
  const [editing, setEditing] = useState(null); // pool | "new"
  const [action, setAction] = useState(null); // { id, kind }
  const [showLog, setShowLog] = useState(false);
  const fullFor = (p) => {
    const same = pools.filter((x) => Math.abs(x.sizeL - p.sizeL) < 0.01);
    const full = fullBySize[p.sizeL] || 0;
    return same.length > 1 ? Math.round(full / same.length) : full;
  };
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <div style={{ ...label, flex: 1 }}>Keg pool</div>
        {!readOnly && pools.length > 0 && editing !== "new" && <button type="button" style={{ ...btn(false), padding: "5px 10px", display: "flex", alignItems: "center", gap: 5 }} onClick={() => setEditing("new")}><Plus size={13} /> Add keg type</button>}
      </div>
      {pools.length === 0 && editing !== "new" && (
        <div style={{ background: "#FFFFFF", border: "1px dashed #C9D1AC", borderRadius: 8, padding: 16, fontSize: 13.5, color: muted, lineHeight: 1.5 }}>
          Count your kegs in piles instead of by number: how many you have, how many are dirty and how many are clean. Packaging takes them off the clean pile by itself, and the task list warns you when you'll be short.
          {!readOnly && <div style={{ marginTop: 10 }}><button type="button" style={btn(true)} onClick={() => setEditing("new")}>Set up your kegs</button></div>}
        </div>
      )}
      {editing === "new" && <PoolEditor onSave={async (p) => { await onSave(p); setEditing(null); }} onCancel={() => setEditing(null)} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: editing === "new" ? 10 : 0 }}>
        {pools.map((p) => {
          if (editing && editing !== "new" && editing.id === p.id) return <PoolEditor key={p.id} pool={p} onSave={async (np) => { await onSave({ ...np, id: p.id }); setEditing(null); }} onCancel={() => setEditing(null)} onDelete={() => { onDelete(p); setEditing(null); }} />;
          const full = fullFor(p);
          const out = Math.max(0, (p.total || 0) - p.dirty - p.clean - full);
          const need = kegNeeds.find((n) => Math.abs(n.sizeL - p.sizeL) < 0.01);
          const piles = [["Dirty", p.dirty, "#B98A3E"], ["Clean", p.clean, green], ["Full", full, "#3E7CB1"], [p.owner === "own" ? "Out" : "Out / back to hire", out, faint]];
          return (
            <div key={p.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 16, color: ink, flex: 1 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: faint }}>{p.total ? `${p.total} in total` : "Set a total"}</div>
                {!readOnly && <button type="button" onClick={() => setEditing(p)} style={{ background: "none", border: "none", color: muted, fontSize: 12, cursor: "pointer" }}>Edit</button>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 10 }}>
                {piles.map(([l, v, c]) => (
                  <div key={l} style={{ background: "#F8F5EA", borderRadius: 6, padding: "8px 6px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, color: c }}>{v}</div>
                    <div style={{ fontSize: 11, color: muted }}>{l}</div>
                  </div>
                ))}
              </div>
              {need && need.needed > 0 && (
                <div style={{ fontSize: 12.5, color: need.short ? warn : muted, marginTop: 8 }}>
                  Next 2 weeks: about {need.needed} × {p.sizeL}L needed for kegging{need.short ? ` — clean ${Math.min(need.short, need.dirty)} more${need.short > need.dirty ? `, and you're ${need.short - need.dirty} short overall` : ""}` : " — you've got enough clean"}.
                </div>
              )}
              {!readOnly && (action?.id === p.id ? (
                <PoolAction pool={p} kind={action.kind} onMove={onMove} onDone={() => setAction(null)} />
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  <button type="button" style={btn(true)} onClick={() => setAction({ id: p.id, kind: "clean" })}>Cleaned some</button>
                  <button type="button" style={btn(false)} onClick={() => setAction({ id: p.id, kind: "in" })}>Kegs in to clean</button>
                  <button type="button" style={btn(false)} onClick={() => setAction({ id: p.id, kind: "count" })}>Count them</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {log.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setShowLog((v) => !v)} style={{ background: "none", border: "none", color: muted, fontSize: 12.5, cursor: "pointer", padding: 0 }}>{showLog ? "Hide" : "Show"} keg history</button>
          {showLog && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {log.slice(0, 40).map((l) => {
                const pool = pools.find((p) => p.id === l.poolId);
                const what = { clean: `${l.qty} cleaned`, in: `${l.qty} in to clean`, fill: `${l.qty} filled`, count: "counted" }[l.kind] || l.kind;
                return <div key={l.id} style={{ fontSize: 12, color: muted }}>{fmtTaskDay(l.happenedOn)} · {pool?.name || "Kegs"}: {what}{l.note ? ` — ${l.note}` : ""}{l.userName ? ` · ${l.userName}` : ""}</div>;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
