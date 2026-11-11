import { useState, useEffect } from "react";
import { ChevronLeft, CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { rowToBatch, rowToFoodSafetyRecord, rowToExciseItemCode, rowToExciseReturn } from "../lib/mappers";
import { ExciseAuditReport, containersLabel } from "./excise";
import { FoodSafetyAuditReport } from "./foodSafety";
import { Modal, TextField } from "./ui";
import { exciseAuditMonths, round3 } from "../lib/excise";
import { CONTAINERS, packagedVolume, packagingEvents } from "../lib/production";
import { today } from "../lib/utils";

// ─── Auditor share links ────────────────────────────────────────────────────
// A read-only link plus a PIN that the owner sends to an auditor. Nothing is
// read from tables directly: the public page calls get_audit_share, which
// checks the token, expiry, switch-off and PIN (locking after 5 wrong tries)
// and returns only what that link includes — never costs or sales.
export const auditShareUrl = (token) => `${window.location.origin}/audit/${token}`;
export const fmtNzDate = (d) => (d ? new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "");
export const randomPin = () => String(Math.floor(100000 + Math.random() * 900000));
export const isoDaysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

export function AuditSharesModal({ scope, userName, onClose }) {
  const [shares, setShares] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [label, setLabel] = useState("");
  // Links always include every area; costs and prices are never included.
  const foodSafety = true;
  const excise = true;
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(365));
  const [dateTo, setDateTo] = useState(today());
  const [expiresDays, setExpiresDays] = useState(14);
  const [pin, setPin] = useState(randomPin);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState("");

  const load = async () => {
    const { data, error: err } = await supabase
      .from("audit_shares")
      .select("id, token, label, include_food_safety, include_excise, date_from, date_to, expires_at, revoked_at, created_by, created_at, view_count, last_viewed_at")
      .order("created_at", { ascending: false });
    if (err) setLoadError(err.message);
    else setShares(data || []);
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError("");
    if (!/^[0-9]{4,8}$/.test(pin)) return setError("PIN must be 4 to 8 digits.");
    if (!foodSafety && !excise) return setError("Choose Food Safety, Excise or both.");
    setCreating(true);
    const { data, error: err } = await supabase.rpc("create_audit_share", {
      p_label: label,
      p_food_safety: foodSafety,
      p_excise: excise,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_expires_days: Number(expiresDays),
      p_pin: pin,
      p_created_by: userName || "",
    });
    setCreating(false);
    if (err) return setError(err.message);
    setCreated({ url: auditShareUrl(data.token), pin, label });
    setLabel("");
    setPin(randomPin());
    load();
  };

  const revoke = async (id) => {
    const { error: err } = await supabase.rpc("revoke_audit_share", { p_id: id });
    if (err) setLoadError(err.message);
    load();
  };

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1800);
    } catch {}
  };

  const shareLink = async () => {
    if (!created) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Audit records", text: "Read-only audit records. I'll send the PIN separately.", url: created.url });
      } catch {}
    } else copy(created.url, "url");
  };

  const statusOf = (sh) => {
    if (sh.revoked_at) return { text: "Switched off", color: "#9BA88A" };
    if (new Date(sh.expires_at) < new Date()) return { text: "Expired", color: "#9BA88A" };
    return { text: `Active until ${fmtNzDate(sh.expires_at)}`, color: "#3F7A28" };
  };

  const toggleRow = (on, setOn, text) => (
    <button
      onClick={() => setOn(!on)}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, fontSize: 13.5, cursor: "pointer", textAlign: "left", color: "#2A3324" }}
    >
      <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${on ? "#5C9A3C" : "#C9D1AC"}`, background: on ? "#5C9A3C" : "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {on && <CheckCircle2 size={13} color="#16191A" />}
      </div>
      {text}
    </button>
  );
  const smallBtn = { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" };
  const sectionLabel = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" };

  return (
    <Modal title="Share with auditor" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {created ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#EEF3E4", border: "1px solid #C9D9B0", borderRadius: 6, padding: 14 }}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 15, color: "#2A3324" }}>Link ready{created.label ? ` — ${created.label}` : ""}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, wordBreak: "break-all", color: "#2A3324", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px" }}>{created.url}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={shareLink} style={{ ...smallBtn, flex: 1 }}>Send link</button>
              <button onClick={() => copy(created.url, "url")} style={{ ...smallBtn, flex: 1 }}>{copied === "url" ? "Copied!" : "Copy link"}</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 13, color: "#2A3324" }}>
                PIN: <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.12em" }}>{created.pin}</span>
              </div>
              <button onClick={() => copy(created.pin, "pin")} style={smallBtn}>{copied === "pin" ? "Copied!" : "Copy PIN"}</button>
            </div>
            <div style={{ fontSize: 12, color: "#5C6B54", lineHeight: 1.45 }}>
              Send the PIN separately from the link, e.g. text the PIN and email the link. The PIN is only shown now. If it's lost, switch this link off and make a new one.
            </div>
            <button onClick={() => setCreated(null)} style={{ ...smallBtn, alignSelf: "flex-start" }}>Make another link</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: "#5C6B54", lineHeight: 1.45 }}>
              Makes a read-only link to everything in Brewpoint: batches and brew logs, packaging, ingredient lots, purchase orders, suppliers, customers and orders, tanks and kegs, recipes, food safety and excise. The auditor needs the link and the PIN, doesn't need to log in, and can't change anything. Costs, prices and sales totals are never shown.
            </div>
            <TextField label="Who it's for (optional)" value={label} onChange={setLabel} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <TextField label="Records from" type="date" value={dateFrom} onChange={setDateFrom} />
              <TextField label="Records to" type="date" value={dateTo} onChange={setDateTo} />
            </div>
            <div style={sectionLabel}>Link works for</div>
            <div style={{ display: "flex", border: "1px solid #DDE0C8", borderRadius: 5, overflow: "hidden" }}>
              {[7, 14, 30].map((d) => (
                <button key={d} onClick={() => setExpiresDays(d)} style={{ flex: 1, background: expiresDays === d ? "#5C9A3C" : "#F5F1E4", border: "none", padding: 9, color: expiresDays === d ? "#16191A" : "#5C6B54", fontSize: 13, cursor: "pointer" }}>
                  {d} days
                </button>
              ))}
            </div>
            <TextField label="PIN (4–8 digits)" value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 8))} />
            {error && <div style={{ fontSize: 12.5, color: "#B5502F" }}>{error}</div>}
            <button
              onClick={create}
              disabled={creating}
              style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: 12, color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: creating ? "default" : "pointer", opacity: creating ? 0.6 : 1 }}
            >
              {creating ? "Creating…" : "Create link"}
            </button>
          </>
        )}

        <div style={{ ...sectionLabel, marginTop: 6 }}>Your links</div>
        {loadError && <div style={{ fontSize: 12.5, color: "#B5502F" }}>{loadError}</div>}
        {shares === null && !loadError && <div style={{ fontSize: 12.5, color: "#9BA88A" }}>Loading…</div>}
        {shares && shares.length === 0 && <div style={{ fontSize: 12.5, color: "#9BA88A" }}>No links yet.</div>}
        {shares &&
          shares.map((sh) => {
            const st = statusOf(sh);
            const active = st.color === "#3F7A28";
            return (
              <div key={sh.id} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: "#2A3324", fontWeight: 500 }}>{sh.label || "Audit link"}</span>
                  <span style={{ fontSize: 11.5, color: st.color, whiteSpace: "nowrap" }}>{st.text}</span>
                </div>
                <div style={{ fontSize: 12, color: "#5C6B54" }}>
                  Records {fmtNzDate(sh.date_from)} – {fmtNzDate(sh.date_to)}
                </div>
                <div style={{ fontSize: 12, color: "#5C6B54" }}>
                  {sh.view_count > 0 ? `Opened ${sh.view_count} time${sh.view_count === 1 ? "" : "s"}, last ${new Date(sh.last_viewed_at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Not opened yet"}
                </div>
                {active && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button onClick={() => copy(auditShareUrl(sh.token), sh.id)} style={smallBtn}>{copied === sh.id ? "Copied!" : "Copy link"}</button>
                    <button onClick={() => revoke(sh.id)} style={{ ...smallBtn, color: "#B5502F", borderColor: "#E3B37A" }}>Switch off</button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </Modal>
  );
}

// Read-only pages for each area of an auditor link. Data arrives already
// stripped of costs and prices by get_audit_share; nothing here can write.
export const auStyles = {
  page: { minHeight: "100vh", background: "#F5F1E4", fontFamily: "'Inter', sans-serif", color: "#2A3324" },
  bar: { position: "sticky", top: 0, zIndex: 2, background: "#F5F1E4", borderBottom: "1px solid #DDE0C8", padding: "12px 16px", display: "flex", alignItems: "center", gap: 10 },
  body: { maxWidth: 860, margin: "0 auto", padding: "18px 16px 60px" },
  h1: { fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 22, margin: "0 0 4px" },
  h2: { fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, margin: "22px 0 8px", borderBottom: "1px solid #DDE0C8", paddingBottom: 5 },
  card: { background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "10px 12px", marginBottom: 8 },
  muted: { color: "#5C6B54", fontSize: 12.5 },
  th: { textAlign: "left", fontWeight: 500, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase", color: "#5C6B54", padding: "6px 8px", borderBottom: "1px solid #DDE0C8", whiteSpace: "nowrap" },
  td: { fontSize: 12.5, padding: "6px 8px", borderBottom: "1px solid #F0EDE0", verticalAlign: "top" },
};

export function AuPage({ title, subtitle, onBack, children }) {
  return (
    <div style={auStyles.page}>
      <div style={auStyles.bar}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "#5C6B54", cursor: "pointer", fontSize: 14, padding: 4 }}>
          <ChevronLeft size={18} /> Back
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => window.print()} style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "6px 10px", color: "#5C6B54", fontSize: 12.5, cursor: "pointer" }}>Print</button>
      </div>
      <div style={auStyles.body}>
        <h1 style={auStyles.h1}>{title}</h1>
        {subtitle && <div style={{ ...auStyles.muted, marginBottom: 12 }}>{subtitle}</div>}
        {children}
      </div>
    </div>
  );
}

// cols: [label, row => value]
export function AuTable({ cols, rows, empty = "Nothing recorded." }) {
  if (!rows || rows.length === 0) return <div style={{ ...auStyles.muted, padding: "4px 0" }}>{empty}</div>;
  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>{cols.map(([l]) => <th key={l} style={auStyles.th}>{l}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>{cols.map(([l, f]) => <td key={l} style={auStyles.td}>{f(r) ?? ""}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuSearch({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5, padding: "10px 12px", fontSize: 14, marginBottom: 12, color: "#2A3324" }}
    />
  );
}

export const auMatch = (q, ...vals) => !q || vals.some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase()));
export const auArr = (v) => (Array.isArray(v) ? v : []);
export const auContainer = (key) => CONTAINERS.find((c) => c.key === key)?.label || key || "";

export function AuditorBatchDetail({ batch: b, onBack }) {
  const events = packagingEvents(b);
  const qc = b.qcApproval && typeof b.qcApproval === "object" && !Array.isArray(b.qcApproval) ? b.qcApproval : null;
  const facts = [
    ["Batch", `#${b.number}`],
    ["Product", [b.productType, b.style].filter(Boolean).join(" · ")],
    ["Recipe", b.recipeName],
    ["Brewed", b.startDate],
    ["Stage", b.stage],
    ["Tank", b.tankName || auArr(b.splitTanks).map((t) => t.tankName).join(", ")],
    ["Volume", b.volume != null ? `${b.volume} L` : ""],
    ["OG / FG", [b.og, b.fg].filter((x) => x != null).map((x) => Number(x).toFixed(3)).join(" / ")],
    ["Label ABV", b.labelAbv != null ? `${b.labelAbv}%` : ""],
    ["Mash pH / temp", [b.mashPh, b.mashTemp != null ? `${b.mashTemp}°C` : null].filter((x) => x != null && x !== "").join(" / ")],
  ].filter(([, v]) => v !== "" && v != null);
  return (
    <AuPage title={b.name} subtitle={`Batch #${b.number}`} onBack={onBack}>
      <div style={{ ...auStyles.card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {facts.map(([l, v]) => (
          <div key={l}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A" }}>{l}</div>
            <div style={{ fontSize: 13.5 }}>{v}</div>
          </div>
        ))}
      </div>
      <h2 style={auStyles.h2}>Ingredients &amp; lots</h2>
      <AuTable cols={[["Ingredient", (r) => r.name], ["Category", (r) => r.category], ["Qty", (r) => `${r.qty ?? ""} ${r.unit || ""}`], ["Lot", (r) => r.lotNumber]]} rows={auArr(b.ingredients)} />
      {auArr(b.brewDays).length > 0 && (
        <>
          <h2 style={auStyles.h2}>Brew days</h2>
          <AuTable cols={[["Date", (r) => r.date], ["Volume", (r) => (r.volume != null ? `${r.volume} L` : "")], ["OG", (r) => r.og], ["From batch", (r) => r.fromBatchName], ["Ingredients & lots", (r) => auArr(r.ingredients).map((i) => `${i.name}${i.lotNumber ? ` (${i.lotNumber})` : ""}`).join(", ")]]} rows={auArr(b.brewDays)} />
        </>
      )}
      <h2 style={auStyles.h2}>Fermentation readings</h2>
      <AuTable cols={[["Date", (r) => String(r.date || "").slice(0, 16).replace("T", " ")], ["Gravity", (r) => (r.gravity != null ? Number(r.gravity).toFixed(3) : "")], ["Temp", (r) => (r.temp != null ? `${r.temp}°C` : "")], ["pH", (r) => r.ph], ["Note", (r) => r.note]]} rows={auArr(b.readings)} />
      {auArr(b.diacetylTests).length > 0 && (
        <>
          <h2 style={auStyles.h2}>Diacetyl tests</h2>
          <AuTable cols={[["Date", (r) => r.date], ["Result", (r) => r.result], ["Notes", (r) => r.notes]]} rows={auArr(b.diacetylTests)} />
        </>
      )}
      {auArr(b.labMeasurements).length > 0 && (
        <>
          <h2 style={auStyles.h2}>Lab measurements</h2>
          <AuTable cols={[["Date", (r) => r.date], ["Gravity", (r) => r.gravity], ["pH", (r) => r.ph], ["CO₂ vols", (r) => r.co2Volumes], ["DO", (r) => r.dissolvedOxygen], ["By", (r) => r.measuredBy], ["Notes", (r) => r.notes]]} rows={auArr(b.labMeasurements)} />
        </>
      )}
      {qc && (
        <>
          <h2 style={auStyles.h2}>QC approval</h2>
          <div style={auStyles.card}>{[qc.date, qc.approvedBy && `approved by ${qc.approvedBy}`, qc.notes].filter(Boolean).join(" · ")}</div>
        </>
      )}
      <h2 style={auStyles.h2}>Packaging</h2>
      <AuTable cols={[["Date", (r) => r.date], ["Packaged", (r) => containersLabel(r)], ["Litres", (r) => round3(packagedVolume(r))]]} rows={events} empty="Not packaged yet." />
      {b.packaging?.discarded != null && <div style={{ ...auStyles.muted, marginTop: 6 }}>Discarded / loss: {b.packaging.discarded} L</div>}
      {auArr(b.faults).length > 0 && (
        <>
          <h2 style={auStyles.h2}>Faults noted</h2>
          <div style={auStyles.card}>{auArr(b.faults).map((f) => (typeof f === "string" ? f : f.name || f.label || JSON.stringify(f))).join(", ")}</div>
        </>
      )}
      {(auArr(b.notes).length > 0 || auArr(b.tastingLog).length > 0) && (
        <>
          <h2 style={auStyles.h2}>Notes &amp; tasting</h2>
          {auArr(b.notes).map((n, i) => (
            <div key={n.id || i} style={auStyles.card}>
              <div style={auStyles.muted}>{String(n.date || "").slice(0, 10)}</div>
              {n.text}
            </div>
          ))}
          {auArr(b.tastingLog).map((t, i) => (
            <div key={t.id || i} style={auStyles.card}>
              <div style={auStyles.muted}>Tasting {String(t.date || "").slice(0, 10)}</div>
              {[auArr(t.tags).join(", "), t.notes].filter(Boolean).join(" — ")}
            </div>
          ))}
        </>
      )}
    </AuPage>
  );
}

export function AuditorBatches({ batches, onBack }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  if (open) return <AuditorBatchDetail batch={open} onBack={() => setOpen(null)} />;
  const lotHit = (b) => auArr(b.ingredients).some((i) => auMatch(q, i.lotNumber, i.name));
  const shown = batches.filter((b) => auMatch(q, b.number, b.name, b.style, b.tankName) || (q && lotHit(b)));
  return (
    <AuPage title="Batches" subtitle={`${batches.length} batches. Search by batch number, beer or an ingredient lot number.`} onBack={onBack}>
      <AuSearch value={q} onChange={setQ} placeholder="Search batches or lot numbers" />
      {shown.map((b) => (
        <button key={b.id} onClick={() => setOpen(b)} style={{ ...auStyles.card, display: "flex", width: "100%", textAlign: "left", cursor: "pointer", justifyContent: "space-between", gap: 10 }}>
          <span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#5C6B54" }}>#{b.number}</span> <span style={{ fontSize: 14 }}>{b.name}</span>
            <div style={auStyles.muted}>{[b.startDate && `brewed ${b.startDate}`, b.tankName, b.stage].filter(Boolean).join(" · ")}</div>
          </span>
          <span style={{ ...auStyles.muted, whiteSpace: "nowrap" }}>{packagingEvents(b).length ? `${round3(packagingEvents(b).reduce((s, e) => s + packagedVolume(e), 0))} L packaged` : ""}</span>
        </button>
      ))}
      {shown.length === 0 && <div style={auStyles.muted}>No matches.</div>}
    </AuPage>
  );
}

export function AuditorInventory({ items, consumables, onBack }) {
  const [q, setQ] = useState("");
  const all = [...items, ...consumables];
  const shown = all.filter((i) => auMatch(q, i.name, i.category) || auArr(i.lots).some((l) => auMatch(q, l.lotNumber, l.poNumber)));
  return (
    <AuPage title="Ingredients & packaging stock" subtitle="Current stock with the lots received, for traceability." onBack={onBack}>
      <AuSearch value={q} onChange={setQ} placeholder="Search items, lot or PO numbers" />
      {shown.map((i) => (
        <div key={i.id} style={auStyles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14 }}>{i.name}</span>
            <span style={auStyles.muted}>{i.category} · {Number(i.qty ?? 0)} {i.unit}</span>
          </div>
          {auArr(i.lots).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <AuTable cols={[["Lot", (l) => l.lotNumber], ["Received", (l) => l.date], ["PO", (l) => l.poNumber], ["Qty", (l) => l.qty], ["Remaining", (l) => l.remainingQty]]} rows={auArr(i.lots)} />
            </div>
          )}
        </div>
      ))}
      {shown.length === 0 && <div style={auStyles.muted}>No matches.</div>}
    </AuPage>
  );
}

export function AuditorPurchases({ orders, onBack }) {
  return (
    <AuPage title="Purchase orders & receiving" subtitle="Ingredients received, with supplier lot numbers." onBack={onBack}>
      {orders.map((p) => (
        <div key={p.id} style={auStyles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14 }}>{p.po_number} · {p.supplier}</span>
            <span style={auStyles.muted}>{p.status}</span>
          </div>
          <div style={auStyles.muted}>Ordered {p.order_date || "—"}{p.received_date ? ` · received ${p.received_date}` : ""}</div>
          <div style={{ marginTop: 6 }}>
            <AuTable cols={[["Item", (l) => l.name], ["Qty", (l) => `${l.qty ?? ""} ${l.unit || ""}`], ["Lot", (l) => l.lotNumber]]} rows={auArr(p.lines)} />
          </div>
        </div>
      ))}
      {orders.length === 0 && <div style={auStyles.muted}>No purchase orders in this period.</div>}
    </AuPage>
  );
}

export function AuditorSuppliers({ suppliers, documents, onBack }) {
  return (
    <AuPage title="Suppliers" subtitle="Approval status and documents on file." onBack={onBack}>
      {suppliers.map((s) => {
        const docs = documents.filter((d) => d.supplier_id === s.id);
        return (
          <div key={s.id} style={auStyles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 14 }}>{s.name}</span>
              <span style={{ fontSize: 12, color: s.approved ? "#3F7A28" : "#B5502F" }}>{s.approved ? "Approved" : "Not approved"}</span>
            </div>
            {s.approved_notes && <div style={auStyles.muted}>{s.approved_notes}</div>}
            <div style={auStyles.muted}>{[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ")}</div>
            {docs.length > 0 && (
              <div style={{ ...auStyles.muted, marginTop: 4 }}>
                Documents: {docs.map((d) => `${d.name}${d.expiry_date ? ` (expires ${d.expiry_date})` : ""}`).join(", ")}
              </div>
            )}
          </div>
        );
      })}
      {suppliers.length === 0 && <div style={auStyles.muted}>No suppliers recorded.</div>}
    </AuPage>
  );
}

export function AuditorCustomers({ customers, orders, onBack }) {
  const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
  const lineText = (l) =>
    l.mixedPackTypeName ? `${l.qty} × ${l.mixedPackTypeName}` : `${l.qty ?? ""} × ${l.containerLabel || auContainer(l.containerKey)} ${l.batchName || ""}`.trim();
  return (
    <AuPage title="Customers & sales orders" subtitle="Who received which batches, for recall traceability. Prices are not shown." onBack={onBack}>
      <h2 style={{ ...auStyles.h2, marginTop: 0 }}>Sales orders ({orders.length})</h2>
      <AuTable
        cols={[["Date", (o) => o.order_date], ["Order", (o) => o.order_number], ["Customer", (o) => byId[o.customer_id]?.name || ""], ["Status", (o) => o.status], ["Items", (o) => auArr(o.lines).map(lineText).join(", ")]]}
        rows={orders}
        empty="No sales orders in this period."
      />
      <h2 style={auStyles.h2}>Customers ({customers.length})</h2>
      <AuTable cols={[["Name", (c) => c.name], ["Type", (c) => c.type], ["Contact", (c) => [c.contact_name, c.phone, c.email].filter(Boolean).join(" · ")], ["Address", (c) => c.address]]} rows={customers} empty="No customers recorded." />
    </AuPage>
  );
}

export function AuditorEquipment({ tanks, kegs, pestStations, onBack }) {
  return (
    <AuPage title="Tanks, kegs & pest stations" onBack={onBack}>
      <h2 style={{ ...auStyles.h2, marginTop: 0 }}>Tanks</h2>
      <AuTable
        cols={[["Tank", (t) => t.name], ["Type", (t) => t.type], ["Capacity", (t) => (t.capacity != null ? `${t.capacity} L` : "")], ["Status", (t) => t.clean_status], ["Recent use", (t) => auArr(t.history).slice(-3).reverse().map((h) => `${String(h.date || "").slice(0, 10)} ${h.batchName || h.type || ""}`.trim()).join("; ")]]}
        rows={tanks}
      />
      <h2 style={auStyles.h2}>Kegs</h2>
      <AuTable cols={[["Keg", (k) => k.keg_number], ["Size", (k) => (k.size_l ? `${k.size_l} L` : "")], ["Status", (k) => k.status], ["Batch", (k) => k.current_batch_name], ["With", (k) => k.current_customer_name], ["Sent", (k) => k.sent_date]]} rows={kegs} empty="No kegs tracked." />
      <h2 style={auStyles.h2}>Pest control stations</h2>
      <AuTable cols={[["Station", (p) => p.label], ["Location", (p) => p.location], ["Type", (p) => p.type], ["Active", (p) => (p.active === false ? "No" : "Yes")]]} rows={pestStations} empty="No stations set up." />
    </AuPage>
  );
}

export function AuditorRecipes({ recipes, yeast, onBack }) {
  return (
    <AuPage title="Recipes & yeast" onBack={onBack}>
      {recipes.map((r) => (
        <div key={r.id} style={auStyles.card}>
          <div style={{ fontSize: 14 }}>{r.name}{r.version ? ` (v${r.version})` : ""}</div>
          <div style={auStyles.muted}>{[r.product_type, r.style, r.volume && `${r.volume} L`, r.og && `OG ${Number(r.og).toFixed(3)}`, r.fg && `FG ${Number(r.fg).toFixed(3)}`].filter(Boolean).join(" · ")}</div>
          <div style={{ ...auStyles.muted, marginTop: 4 }}>{auArr(r.ingredients).map((i) => `${i.name} ${i.qty ?? ""}${i.unit || ""}`.trim()).join(", ")}</div>
        </div>
      ))}
      <h2 style={auStyles.h2}>Yeast harvests</h2>
      <AuTable cols={[["Harvested", (y) => y.harvest_date], ["Strain", (y) => y.strain_name], ["Gen", (y) => y.generation], ["From batch", (y) => y.source_batch_name], ["Used", (y) => (y.used ? y.used_date || "Yes" : "No")]]} rows={yeast} empty="No yeast harvests in this period." />
    </AuPage>
  );
}

export function AuditSharePage({ token }) {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);

  const submit = async () => {
    if (!pin) return;
    setStatus("loading");
    setError("");
    const { data: res, error: err } = await supabase.rpc("get_audit_share", { p_token: token, p_pin: pin, p_user_agent: navigator.userAgent });
    if (err || !res) {
      setStatus("idle");
      return setError("Couldn't load the records. Check your connection and try again.");
    }
    if (res.error === "bad_pin") {
      setStatus("idle");
      return setError("That PIN isn't right. After 5 wrong tries the link locks for 15 minutes.");
    }
    if (res.error === "locked") {
      setStatus("idle");
      return setError("Too many wrong PINs. This link is locked for 15 minutes.");
    }
    if (res.error) return setStatus("unavailable");
    const abvMethod = res.company?.excise_abv_method || "measured";
    const batches = (res.batches || []).map(rowToBatch);
    const exciseReturns = (res.excise_returns || []).map(rowToExciseReturn);
    const exciseItemCodes = (res.excise_item_codes || []).map(rowToExciseItemCode);
    const fromKey = String(res.share.date_from).slice(0, 7);
    const toKey = String(res.share.date_to).slice(0, 7);
    const months = res.share.include_excise
      ? exciseAuditMonths({ batches, abvMethod, exciseReturns, exciseItemCodes, todayStr: today() }).months.filter((m) => m.period >= fromKey && m.period <= toKey)
      : [];
    setData({
      companyName: res.company?.name || "",
      share: res.share,
      records: (res.food_safety_records || []).map(rowToFoodSafetyRecord),
      batches,
      months,
      abvMethod,
      inventory: res.inventory_items || [],
      consumables: res.consumables || [],
      purchaseOrders: res.purchase_orders || [],
      suppliers: res.suppliers || [],
      supplierDocuments: res.supplier_documents || [],
      customers: res.customers || [],
      salesOrders: res.sales_orders || [],
      tanks: res.tanks || [],
      kegs: res.kegs || [],
      recipes: res.recipes || [],
      yeast: res.yeast_harvests || [],
      pestStations: res.pest_stations || [],
    });
    setStatus("ready");
    setPin("");
  };

  const shell = (children) => (
    <div style={{ minHeight: "100vh", background: "#F5F1E4", fontFamily: "'Inter', sans-serif", color: "#2A3324", display: "flex", justifyContent: "center", padding: "48px 18px" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>{children}</div>
    </div>
  );
  const heading = (t) => <h1 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 24, margin: "0 0 8px" }}>{t}</h1>;

  if (status === "unavailable") {
    return shell(
      <>
        {heading("Link not available")}
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5 }}>This audit link has expired or been switched off. Ask the brewery to send you a new one.</p>
      </>
    );
  }

  if (status === "ready" && data) {
    const period = `${fmtNzDate(data.share.date_from)} – ${fmtNzDate(data.share.date_to)}`;
    if (open === "foodsafety") return <FoodSafetyAuditReport records={data.records} companyName={data.companyName} periodLabelOverride={period} closeLabel="Back" onClose={() => setOpen(null)} />;
    if (open === "excise") return <ExciseAuditReport months={data.months} batches={data.batches} companyName={data.companyName} abvMethod={data.abvMethod} closeLabel="Back" onClose={() => setOpen(null)} />;
    const back = () => setOpen(null);
    if (open === "batches") return <AuditorBatches batches={data.batches.filter((b) => !b.mergedIntoBatchId)} onBack={back} />;
    if (open === "inventory") return <AuditorInventory items={data.inventory} consumables={data.consumables} onBack={back} />;
    if (open === "purchases") return <AuditorPurchases orders={data.purchaseOrders} onBack={back} />;
    if (open === "suppliers") return <AuditorSuppliers suppliers={data.suppliers} documents={data.supplierDocuments} onBack={back} />;
    if (open === "customers") return <AuditorCustomers customers={data.customers} orders={data.salesOrders} onBack={back} />;
    if (open === "equipment") return <AuditorEquipment tanks={data.tanks} kegs={data.kegs} pestStations={data.pestStations} onBack={back} />;
    if (open === "recipes") return <AuditorRecipes recipes={data.recipes} yeast={data.yeast} onBack={back} />;
    const card = (key, title, sub) => (
      <button
        onClick={() => setOpen(key)}
        style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", textAlign: "left", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 8, padding: "16px 18px", cursor: "pointer", marginBottom: 10 }}
      >
        <span style={{ fontFamily: "'Oswald', sans-serif", fontSize: 17, color: "#2A3324" }}>{title}</span>
        <span style={{ fontSize: 12.5, color: "#5C6B54" }}>{sub}</span>
      </button>
    );
    return shell(
      <>
        <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "#5C6B54" }}>{data.companyName}</div>
        {heading("Audit records")}
        <p style={{ color: "#5C6B54", fontSize: 13.5, lineHeight: 1.5, margin: "0 0 22px" }}>
          Read-only. Records from {period}. This link works until {fmtNzDate(data.share.expires_at)}. Every page can be printed or saved as a PDF.
        </p>
        {data.share.include_food_safety && card("foodsafety", "Food Safety audit report", `${data.records.length} records: checklists, corrective actions, calibration, training, pest control, mock recalls and more`)}
        {data.share.include_excise && card("excise", "Excise audit report", `${data.months.filter((m) => m.status !== "nil" || m.ret).length} months: TSW returns compared with packaging runs and batch detail`)}
        {card("batches", "Batches & brew logs", `${data.batches.filter((b) => !b.mergedIntoBatchId).length} batches: ingredients and lots, readings, lab and QC checks, packaging`)}
        {card("inventory", "Ingredient & packaging stock", `${data.inventory.length + data.consumables.length} items with received lots`)}
        {card("purchases", "Purchase orders & receiving", `${data.purchaseOrders.length} orders with supplier lot numbers`)}
        {card("suppliers", "Suppliers", `${data.suppliers.length} suppliers: approval status and documents`)}
        {card("customers", "Customers & sales orders", `${data.salesOrders.length} orders, ${data.customers.length} customers: who received which batches`)}
        {card("equipment", "Tanks, kegs & pest stations", `${data.tanks.length} tanks, ${data.kegs.length} kegs, ${data.pestStations.length} pest stations`)}
        {card("recipes", "Recipes & yeast", `${data.recipes.length} recipes, ${data.yeast.length} yeast harvests`)}
      </>
    );
  }

  return shell(
    <>
      {heading("Audit records")}
      <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5, margin: "0 0 20px" }}>A brewery has shared read-only records with you. Enter the PIN they sent you.</p>
      <input
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="PIN"
        style={{ width: "100%", boxSizing: "border-box", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px", fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.2em", textAlign: "center", color: "#2A3324" }}
      />
      {error && <div style={{ fontSize: 13, color: "#B5502F", marginTop: 10, lineHeight: 1.4 }}>{error}</div>}
      <button
        onClick={submit}
        disabled={!pin || status === "loading"}
        style={{ width: "100%", marginTop: 14, background: pin ? "#5C9A3C" : "#E8E4D4", border: "none", borderRadius: 6, padding: 14, color: pin ? "#16191A" : "#A3AC94", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, cursor: pin ? "pointer" : "default" }}
      >
        {status === "loading" ? "Opening…" : "Open records"}
      </button>
    </>
  );
}
