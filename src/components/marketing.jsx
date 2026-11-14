import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { Modal } from "./ui";
import { BRANDS, THEMES, renderEmail, starterBlocks } from "../lib/marketingEmail";
import { computeSuggestions } from "../lib/suggestions";

// ─── Marketing: HubSpot-style email marketing inside Brewpoint ──────────────
// Emails (campaigns), Contacts, Automations and Settings. Sending, A/B
// tests, scheduling and the daily limit are handled by the marketing-send
// edge function; opens/clicks/bounces come back through marketing-events.

const ink = "#2A3324", muted = "#5C6B54", line = "#DDE0C8", field = "#F5F1E4", green = "#5C9A3C";
const card = { background: "#fff", border: `1px solid ${line}`, borderRadius: 8, padding: 14 };
const inputS = { width: "100%", boxSizing: "border-box", background: field, border: `1px solid ${line}`, borderRadius: 4, padding: "9px 10px", color: ink, fontFamily: "'Inter', sans-serif", fontSize: 14 };
const labelS = { fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: muted };
const btn = (primary) => ({ background: primary ? green : "#fff", color: primary ? "#fff" : ink, border: primary ? "none" : `1px solid ${line}`, borderRadius: 5, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', sans-serif" });
const chip = (on) => ({ background: on ? green : "#fff", color: on ? "#fff" : ink, border: `1px solid ${on ? green : line}`, borderRadius: 20, padding: "5px 11px", fontSize: 12.5, cursor: "pointer", fontFamily: "'Inter', sans-serif" });

const STATUS_LABEL = { draft: "Draft", scheduled: "Scheduled", testing: "A/B testing", sending: "Sending", sent: "Sent", cancelled: "Cancelled" };
const STATUS_COLOR = { draft: "#9BA88A", scheduled: "#D9A441", testing: "#B8925A", sending: "#5C9A3C", sent: "#2A3324", cancelled: "#B5523B" };

function Field({ label, children }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={labelS}>{label}</span>{children}</label>;
}
function Text({ label, value, onChange, placeholder, type = "text" }) {
  return <Field label={label}><input type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={inputS} /></Field>;
}
function Area({ label, value, onChange, rows = 4, placeholder }) {
  return <Field label={label}><textarea rows={rows} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ ...inputS, resize: "vertical", lineHeight: 1.45 }} /></Field>;
}

async function callEngine(body) {
  const { data, error } = await supabase.functions.invoke("marketing-send", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function uploadImage(file, companyId) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${companyId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("marketing-assets").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from("marketing-assets").getPublicUrl(path).data.publicUrl;
}

function ImagePicker({ label, value, onChange, companyId, onError }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <Field label={label}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {value ? <img src={value} alt="" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 4, border: `1px solid ${line}` }} /> : <div style={{ width: 54, height: 54, borderRadius: 4, border: `1px dashed ${line}`, display: "flex", alignItems: "center", justifyContent: "center", color: muted, fontSize: 11 }}>none</div>}
        <button type="button" style={btn(false)} disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : value ? "Change" : "Upload artwork"}</button>
        {value && <button type="button" style={{ ...btn(false), color: "#B5523B" }} onClick={() => onChange("")}>Remove</button>}
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp" style={{ display: "none" }} onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) { onError?.("That image is over 10 MB — export a smaller one."); return; }
          setBusy(true);
          try { onChange(await uploadImage(f, companyId)); } catch (err) { onError?.(`Upload failed: ${err.message || err}`); } finally { setBusy(false); }
        }} />
      </div>
    </Field>
  );
}

const BLOCK_TYPES = [
  ["hero", "Big banner image"], ["heading", "Heading"], ["text", "Text"], ["image", "Image"], ["images2", "Two images"],
  ["beer", "Beer / cider feature"], ["callout", "Callout box"], ["button", "Button"], ["divider", "Divider"], ["spacer", "Space"], ["social", "Social links"],
];
const newBlock = (type) => ({
  hero: { type, image: "", link: "" }, heading: { type, text: "Heading", size: "lg" }, text: { type, text: "" },
  image: { type, image: "", alt: "", link: "", caption: "" }, images2: { type, left: "", right: "" },
  beer: { type, name: "", style: "", abv: "", description: "", image: "", tag: "New", url: "" },
  callout: { type, text: "", emoji: "🍻" }, button: { type, label: "Order now", url: "" }, divider: { type }, spacer: { type },
  social: { type, instagram: "", facebook: "", website: "" },
}[type]);

function BlockEditor({ block, onChange, companyId, onError, beerNames }) {
  const set = (k) => (v) => onChange({ ...block, [k]: v });
  const img = (k, label) => <ImagePicker label={label} value={block[k]} onChange={set(k)} companyId={companyId} onError={onError} />;
  switch (block.type) {
    case "hero": return <>{img("image", "Banner artwork (wide works best)")}<Text label="Link (optional)" value={block.link} onChange={set("link")} placeholder="https://" /></>;
    case "heading": return <><Text label="Heading" value={block.text} onChange={set("text")} /><Field label="Size"><select value={block.size || "lg"} onChange={(e) => set("size")(e.target.value)} style={inputS}><option value="xl">Huge</option><option value="lg">Large</option><option value="md">Medium</option></select></Field></>;
    case "text": return <Area label="Text — blank line = new paragraph, **bold**, {{first_name}}" rows={5} value={block.text} onChange={set("text")} />;
    case "image": return <>{img("image", "Image")}<Text label="Caption (optional)" value={block.caption} onChange={set("caption")} /><Text label="Link (optional)" value={block.link} onChange={set("link")} placeholder="https://" /></>;
    case "images2": return <>{img("left", "Left image")}{img("right", "Right image")}</>;
    case "beer": return (
      <>
        <Field label="Name"><input list="mkt-beers" value={block.name} onChange={(e) => set("name")(e.target.value)} style={inputS} /><datalist id="mkt-beers">{beerNames.map((n) => <option key={n} value={n} />)}</datalist></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8 }}><Text label="Style" value={block.style} onChange={set("style")} /><Text label="ABV %" value={block.abv} onChange={set("abv")} /></div>
        <Area label="Description" rows={3} value={block.description} onChange={set("description")} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><Text label="Badge" value={block.tag} onChange={set("tag")} placeholder="New / Limited / Back!" /><Text label="Link (optional)" value={block.url} onChange={set("url")} /></div>
        {img("image", "Can / label / tap artwork")}
      </>
    );
    case "callout": return <><div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8 }}><Text label="Emoji" value={block.emoji} onChange={set("emoji")} /><Text label="Text" value={block.text} onChange={set("text")} /></div></>;
    case "button": return <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}><Text label="Button text" value={block.label} onChange={set("label")} /><Text label="Link" value={block.url} onChange={set("url")} placeholder="https:// or mailto:" /></div>;
    case "social": return <><Text label="Instagram link" value={block.instagram} onChange={set("instagram")} /><Text label="Facebook link" value={block.facebook} onChange={set("facebook")} /><Text label="Website" value={block.website} onChange={set("website")} /></>;
    default: return <div style={{ color: muted, fontSize: 13 }}>No settings.</div>;
  }
}

function Preview({ content, settings, contact }) {
  const html = useMemo(() => renderEmail({ ...content, settings: settings || {}, contact: contact || { first_name: "Sam", company_name: "The Local" }, unsubscribeUrl: "#" }).html, [content, settings, contact]);
  return <iframe title="Email preview" srcDoc={html} style={{ width: "100%", height: 640, border: `1px solid ${line}`, borderRadius: 8, background: "#fff" }} sandbox="" />;
}

// Shared editor for a campaign or an automation's email.
function ContentEditor({ value, onChange, companyId, settings, onError, beerNames }) {
  const [open, setOpen] = useState(null);
  const blocks = value.blocks || [];
  const setBlocks = (b) => onChange({ ...value, blocks: b });
  const move = (i, d) => { const b = [...blocks]; const j = i + d; if (j < 0 || j >= b.length) return; [b[i], b[j]] = [b[j], b[i]]; setBlocks(b); setOpen(j); };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="mkt-editor">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
{Object.keys(BRANDS).length > 1 && <Field label="Brand"><select value={value.brand} onChange={(e) => onChange({ ...value, brand: e.target.value })} style={inputS}>{Object.entries(BRANDS).map(([k, b]) => <option key={k} value={k}>{b.name}</option>)}</select></Field>}
          <Field label="Look"><select value={value.theme || "classic"} onChange={(e) => onChange({ ...value, theme: e.target.value })} style={inputS}>{Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select></Field>
        </div>
        <div style={{ ...labelS, marginTop: 6 }}>Content</div>
        {blocks.map((b, i) => (
          <div key={i} style={{ ...card, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" onClick={() => setOpen(open === i ? null : i)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 13.5, color: ink, fontWeight: 600, fontFamily: "'Inter', sans-serif", padding: 2 }}>
                {(BLOCK_TYPES.find(([t]) => t === b.type) || [b.type, b.type])[1]}
                <span style={{ fontWeight: 400, color: muted }}>{b.text || b.name || b.label ? ` — ${String(b.text || b.name || b.label).slice(0, 34)}` : ""}</span>
              </button>
              <button type="button" title="Up" onClick={() => move(i, -1)} style={{ ...btn(false), padding: "3px 8px" }}>↑</button>
              <button type="button" title="Down" onClick={() => move(i, 1)} style={{ ...btn(false), padding: "3px 8px" }}>↓</button>
              <button type="button" title="Remove" onClick={() => { setBlocks(blocks.filter((_, k) => k !== i)); setOpen(null); }} style={{ ...btn(false), padding: "3px 8px", color: "#B5523B" }}>✕</button>
            </div>
            {open === i && <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}><BlockEditor block={b} onChange={(nb) => setBlocks(blocks.map((x, k) => (k === i ? nb : x)))} companyId={companyId} onError={onError} beerNames={beerNames} /></div>}
          </div>
        ))}
        <Field label="Add a block">
          <select value="" onChange={(e) => { if (!e.target.value) return; setBlocks([...blocks, newBlock(e.target.value)]); setOpen(blocks.length); }} style={inputS}>
            <option value="">+ Add…</option>
            {BLOCK_TYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div>
        <div style={{ ...labelS, marginBottom: 6 }}>Preview (how it looks in their inbox)</div>
        <Preview content={value} settings={settings} />
      </div>
    </div>
  );
}

// ─── Audience ───────────────────────────────────────────────────────────────
function AudiencePicker({ audience, onChange, allTags, beerNames, likely = [] }) {
  const a = audience || {};
  const toggle = (k, v) => { const cur = a[k] || []; onChange({ ...a, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }); };
  const [count, setCount] = useState(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("marketing_audience_ids", { p_audience: a });
      if (live) setCount(error ? null : (data || []).length);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [JSON.stringify(a)]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Object.keys(BRANDS).length > 1 && <div>
        <div style={labelS}>Lists</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{Object.entries(BRANDS).map(([k, b]) => <button type="button" key={k} style={chip((a.lists || []).includes(k))} onClick={() => toggle("lists", k)}>{b.short}</button>)}</div>
      </div>}
      <div>
        <div style={labelS}>Tags (any of)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{allTags.map((t) => <button type="button" key={t} style={chip((a.tags || []).includes(t))} onClick={() => toggle("tags", t)}>{t}</button>)}</div>
      </div>
      <div>
        <div style={labelS}>Has ordered (any of)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{beerNames.map((n) => <button type="button" key={n} style={chip((a.beers || []).includes(n.toLowerCase()))} onClick={() => toggle("beers", n.toLowerCase())}>{n}</button>)}</div>
      </div>
      {likely.length > 0 && (
        <div>
          <div style={labelS}>Likely to want (suggestions)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{likely.map((b) => { const on = (a.likely_beers || []).includes(b.key); return <button type="button" key={b.key} style={chip(on)} onClick={() => { const lb = on ? (a.likely_beers || []).filter((x) => x !== b.key) : [...(a.likely_beers || []), b.key]; const ids = [...new Set(likely.filter((x) => lb.includes(x.key)).flatMap((x) => x.contactIds))]; onChange({ ...a, likely_beers: lb, contact_ids: lb.length ? (ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]) : undefined }); }}>{b.name}{b.isNew ? " (new)" : ""} · {b.contactIds.length}</button>; })}</div>
          {(a.likely_beers || []).length > 0 && <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>Only venues the suggestions pick for these beers.</div>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Text label="Not ordered in (days)" type="number" value={a.not_ordered_days ?? ""} onChange={(v) => onChange({ ...a, not_ordered_days: v ? Number(v) : undefined })} />
        <Text label="Ordered within (days)" type="number" value={a.ordered_within_days ?? ""} onChange={(v) => onChange({ ...a, ordered_within_days: v ? Number(v) : undefined })} />
      </div>
      <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>{count == null ? "Counting…" : `${count} subscribed ${count === 1 ? "person" : "people"} will get this`}{!(a.lists || []).length && !(a.tags || []).length && !(a.beers || []).length && !a.not_ordered_days && !a.ordered_within_days ? <span style={{ fontWeight: 400, color: muted }}> (everyone subscribed)</span> : null}</div>
    </div>
  );
}

// ─── Campaign editor ────────────────────────────────────────────────────────
function CampaignEditor({ campaign, onClose, onSaved, companyId, settings, allTags, beerNames, showToast, likely }) {
  const [c, setC] = useState(campaign);
  const [step, setStep] = useState("design");
  const [busy, setBusy] = useState(false);
  const [abOn, setAbOn] = useState(!!campaign.subject_b);
  const locked = ["sending", "sent", "testing"].includes(c.status);
  const save = async (extra = {}) => {
    const row = { name: c.name, brand: c.brand, theme: c.theme, subject: c.subject, subject_b: abOn ? c.subject_b || null : null, preheader: c.preheader, blocks: c.blocks, audience: c.audience || {}, scheduled_at: c.scheduled_at || null, ab_percent: abOn ? Number(c.ab_percent) || 20 : null, ab_wait_hours: Number(c.ab_wait_hours) || 4, updated_at: new Date().toISOString(), ...extra };
    const { data, error } = await supabase.from("marketing_campaigns").update(row).eq("id", c.id).select().single();
    if (error) throw error;
    setC(data); onSaved?.(data); return data;
  };
  const doSave = async () => { setBusy(true); try { await save(); showToast("success", "Saved."); } catch (e) { showToast("error", e.message); } finally { setBusy(false); } };
  const doTest = async (variant) => {
    setBusy(true);
    try { await save(); const r = await callEngine({ action: "test", content: { ...c, subject_b: abOn ? c.subject_b : null }, variant }); showToast("success", `Test sent to ${r.to}.`); }
    catch (e) { showToast("error", e.message); } finally { setBusy(false); }
  };
  const doSend = async () => {
    if (!c.subject) { showToast("error", "Add a subject line first."); return; }
    const when = c.scheduled_at ? new Date(c.scheduled_at) : null;
    if (!window.confirm(when && when > new Date() ? `Schedule this for ${when.toLocaleString("en-NZ")}?` : "Send this email now?")) return;
    setBusy(true);
    try {
      await save();
      const r = await callEngine({ action: "queue", campaignId: c.id });
      if (r.scheduled) showToast("success", "Scheduled — it'll go out automatically.");
      else showToast("success", r.testing ? `A/B test started — ${r.queued} people get the test, the winner goes to the rest later.` : `Sending to ${r.queued} people. Anything over today's limit goes tomorrow.`);
      onClose();
    } catch (e) { showToast("error", e.message); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={c.name || "Email"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["design", "1. Design"], ["details", "2. Subject & A/B"], ["audience", "3. Who gets it"], ["send", "4. Send"]].map(([k, l]) => <button key={k} type="button" style={chip(step === k)} onClick={() => setStep(k)}>{l}</button>)}
        </div>
        {locked && <div style={{ fontSize: 13, color: "#B5523B" }}>This email has already gone out, so it can't be changed. Duplicate it to send a new version.</div>}
        <fieldset disabled={locked} style={{ border: "none", padding: 0, margin: 0 }}>
          {step === "design" && <ContentEditor value={c} onChange={setC} companyId={companyId} settings={settings} onError={(m) => showToast("error", m)} beerNames={beerNames} />}
          {step === "details" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 560 }}>
              <Text label="Internal name" value={c.name} onChange={(v) => setC({ ...c, name: v })} />
              <Text label="Subject line" value={c.subject} onChange={(v) => setC({ ...c, subject: v })} placeholder="e.g. New hazy just landed 🍺" />
              <Text label="Preview text (shows after the subject in the inbox)" value={c.preheader} onChange={(v) => setC({ ...c, preheader: v })} />
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={abOn} onChange={(e) => setAbOn(e.target.checked)} /> A/B test two subject lines</label>
              {abOn && (
                <>
                  <Text label="Subject line B" value={c.subject_b} onChange={(v) => setC({ ...c, subject_b: v })} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <Text label="Test group (% of list)" type="number" value={c.ab_percent ?? 20} onChange={(v) => setC({ ...c, ab_percent: v })} />
                    <Text label="Pick winner after (hours)" type="number" value={c.ab_wait_hours ?? 4} onChange={(v) => setC({ ...c, ab_wait_hours: v })} />
                  </div>
                  <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.45 }}>Half the test group gets A, half gets B. After the wait, whichever got more opens goes to everyone else automatically.</div>
                </>
              )}
            </div>
          )}
          {step === "audience" && <div style={{ maxWidth: 640 }}><AudiencePicker audience={c.audience} onChange={(a) => setC({ ...c, audience: a })} allTags={allTags} beerNames={beerNames} likely={likely} /></div>}
          {step === "send" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
              <Text label="Send at (leave empty to send now)" type="datetime-local" value={c.scheduled_at ? toLocalInput(c.scheduled_at) : ""} onChange={(v) => setC({ ...c, scheduled_at: v ? new Date(v).toISOString() : null })} />
              <div style={{ fontSize: 13, color: muted, lineHeight: 1.5 }}>
                From: <b>{settings?.from_email ? `${settings.from_name || "Double Cone Brewing"} <${settings.from_email}>` : "not set — add it in Settings"}</b><br />
                Sends up to {settings?.daily_limit ?? 100} a day; anything over carries on the next day.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={btn(false)} disabled={busy} onClick={() => doTest("A")}>Send me a test</button>
                {abOn && <button type="button" style={btn(false)} disabled={busy} onClick={() => doTest("B")}>Test subject B</button>}
                <button type="button" style={btn(true)} disabled={busy} onClick={doSend}>{c.scheduled_at && new Date(c.scheduled_at) > new Date() ? "Schedule" : "Send now"}</button>
              </div>
            </div>
          )}
        </fieldset>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: `1px solid ${line}`, paddingTop: 12 }}>
          <button type="button" style={btn(false)} onClick={onClose}>Close</button>
          {!locked && <button type="button" style={btn(true)} disabled={busy} onClick={doSave}>Save</button>}
        </div>
      </div>
    </Modal>
  );
}
function toLocalInput(iso) {
  const d = new Date(iso); const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── Report ─────────────────────────────────────────────────────────────────
function CampaignReport({ campaign, onClose, contacts }) {
  const [sends, setSends] = useState(null);
  useEffect(() => { supabase.from("marketing_sends").select("*").eq("campaign_id", campaign.id).then(({ data }) => setSends(data || [])); }, [campaign.id]);
  const by = (f) => (sends || []).filter(f).length;
  const out = by((s) => !["queued", "skipped", "failed"].includes(s.status));
  const pct = (n) => (out ? `${Math.round((n / out) * 100)}%` : "–");
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const unsubs = (sends || []).filter((s) => { const c = contactById.get(s.contact_id); return c?.unsubscribed_at && s.sent_at && c.unsubscribed_at >= s.sent_at; }).length;
  const stats = [["Sent", out], ["Waiting", by((s) => s.status === "queued")], ["Delivered", by((s) => s.delivered_at)], ["Opened", by((s) => s.opened_at), pct(by((s) => s.opened_at))], ["Clicked", by((s) => s.clicked_at), pct(by((s) => s.clicked_at))], ["Bounced", by((s) => s.bounced_at)], ["Unsubscribed", unsubs]];
  const ab = campaign.subject_b ? ["A", "B"].map((v) => { const s = (sends || []).filter((x) => x.variant === v && x.status !== "queued"); const o = s.filter((x) => x.opened_at).length; return [v, v === "A" ? campaign.subject : campaign.subject_b, s.length, s.length ? Math.round((o / s.length) * 100) : 0]; }) : null;
  return (
    <Modal wide title={`${campaign.name} — results`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {sends == null ? <div>Loading…</div> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {stats.map(([l, n, p]) => <div key={l} style={card}><div style={labelS}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: ink }}>{n}</div>{p && <div style={{ fontSize: 12, color: muted }}>{p}</div>}</div>)}
            </div>
            {ab && (
              <div style={card}>
                <div style={{ ...labelS, marginBottom: 6 }}>A/B test {campaign.ab_winner ? `— winner: ${campaign.ab_winner}` : "— still running"}</div>
                {ab.map(([v, subj, n, rate]) => <div key={v} style={{ fontSize: 13.5, padding: "3px 0" }}><b>{v}</b> “{subj}” — {n} sent, {rate}% opened</div>)}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: muted }}>Opens are an estimate — some email apps (like Apple Mail) load images automatically, others block them.</div>
            <div style={{ maxHeight: 340, overflowY: "auto", border: `1px solid ${line}`, borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {(sends || []).sort((a, b) => (b.clicked_at ? 2 : b.opened_at ? 1 : 0) - (a.clicked_at ? 2 : a.opened_at ? 1 : 0)).map((s) => {
                    const c = contactById.get(s.contact_id);
                    return <tr key={s.id} style={{ borderBottom: `1px solid ${line}` }}><td style={{ padding: "6px 8px" }}>{c?.company_name || [c?.first_name, c?.last_name].filter(Boolean).join(" ") || s.email}<div style={{ color: muted, fontSize: 11.5 }}>{s.email}</div></td><td style={{ padding: "6px 8px", textAlign: "right", color: s.status === "bounced" || s.status === "failed" ? "#B5523B" : ink }}>{s.status}{s.variant ? ` · ${s.variant}` : ""}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Contacts ───────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function ContactModal({ contact, onClose, onSave, allTags }) {
  const [c, setC] = useState(contact);
  const [tagText, setTagText] = useState((contact.tags || []).join(", "));
  return (
    <Modal title={contact.id ? "Edit contact" : "Add contact"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Text label="Email" value={c.email} onChange={(v) => setC({ ...c, email: v })} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><Text label="First name" value={c.first_name} onChange={(v) => setC({ ...c, first_name: v })} /><Text label="Last name" value={c.last_name} onChange={(v) => setC({ ...c, last_name: v })} /></div>
        <Text label="Business / venue" value={c.company_name} onChange={(v) => setC({ ...c, company_name: v })} />
        <Text label="Tags (comma separated)" value={tagText} onChange={setTagText} placeholder={allTags.slice(0, 4).join(", ")} />
        {Object.keys(BRANDS).length > 1 && <div><div style={labelS}>Lists</div><div style={{ display: "flex", gap: 6, marginTop: 6 }}>{Object.entries(BRANDS).map(([k, b]) => <button type="button" key={k} style={chip((c.lists || []).includes(k))} onClick={() => setC({ ...c, lists: (c.lists || []).includes(k) ? c.lists.filter((x) => x !== k) : [...(c.lists || []), k] })}>{b.short}</button>)}</div></div>}
        <Field label="Status"><select value={c.status} onChange={(e) => setC({ ...c, status: e.target.value })} style={inputS}><option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option></select></Field>
        <Text label="How they agreed to emails" value={c.consent} onChange={(v) => setC({ ...c, consent: v })} placeholder="e.g. signed up at the bar, existing customer" />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" style={btn(false)} onClick={onClose}>Cancel</button><button type="button" style={btn(true)} onClick={() => onSave({ ...c, email: String(c.email || "").trim().toLowerCase(), tags: tagText.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) })}>Save</button></div>
      </div>
    </Modal>
  );
}

function ContactsTab({ contacts, reload, companyId, allTags, showToast }) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [edit, setEdit] = useState(null);
  const fileRef = useRef(null);
  const shown = contacts.filter((c) => (!tag || (c.tags || []).includes(tag)) && (!q || [c.email, c.first_name, c.last_name, c.company_name].join(" ").toLowerCase().includes(q.toLowerCase())));
  const save = async (c) => {
    if (!c.email.includes("@")) { showToast("error", "That email doesn't look right."); return; }
    const row = { company_id: companyId, email: c.email, first_name: c.first_name || null, last_name: c.last_name || null, company_name: c.company_name || null, tags: c.tags, lists: c.lists?.length ? c.lists : ["double-cone"], status: c.status, consent: c.consent || null, unsubscribed_at: c.status === "unsubscribed" ? c.unsubscribed_at || new Date().toISOString() : null, source: c.source || "manual" };
    const { error } = c.id ? await supabase.from("marketing_contacts").update(row).eq("id", c.id) : await supabase.from("marketing_contacts").insert(row);
    if (error) { showToast("error", error.message.includes("duplicate") ? "That email is already a contact." : error.message); return; }
    setEdit(null); reload();
  };
  const importCsv = async (file) => {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { showToast("error", "That file looks empty."); return; }
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const iE = col("email"), iF = col("first name", "firstname", "first"), iL = col("last name", "lastname", "surname"), iC = col("company", "business", "venue"), iT = col("tags", "tag"), iS = col("unsubscribed", "opted out", "status");
    if (iE < 0) { showToast("error", "Couldn't find an Email column."); return; }
    const out = [];
    for (const r of rows.slice(1)) {
      const email = String(r[iE] || "").trim().toLowerCase();
      if (!email.includes("@")) continue;
      const comp = iC >= 0 ? String(r[iC] || "").trim() : "";
      const st = iS >= 0 ? String(r[iS] || "").toLowerCase() : "";
      out.push({ company_id: companyId, email, first_name: iF >= 0 ? r[iF]?.trim() || null : null, last_name: iL >= 0 ? r[iL]?.trim() || null : null, company_name: comp && !/^\d+$/.test(comp) ? comp : null, tags: ["imported", ...(iT >= 0 ? String(r[iT] || "").split(/[;,]/).map((t) => t.trim().toLowerCase()).filter(Boolean) : [])], status: /unsub|opt|true|yes/.test(st) ? "unsubscribed" : "subscribed", consent: "Imported from a list", source: "import" });
    }
    const existing = new Set(contacts.map((c) => c.email.toLowerCase()));
    const seen = new Set();
    const fresh = out.filter((o) => !existing.has(o.email) && !seen.has(o.email) && seen.add(o.email));
    const { error } = fresh.length ? await supabase.from("marketing_contacts").insert(fresh) : { error: null };
    if (error) { showToast("error", error.message); return; }
    showToast("success", `Imported ${fresh.length} new contacts${out.length - fresh.length ? ` (${out.length - fresh.length} were already there)` : ""}.`);
    reload();
  };
  const counts = { all: contacts.length, sub: contacts.filter((c) => c.status === "subscribed").length };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" style={{ ...inputS, maxWidth: 260 }} />
        <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ ...inputS, maxWidth: 180 }}><option value="">All tags</option>{allTags.map((t) => <option key={t}>{t}</option>)}</select>
        <div style={{ flex: 1 }} />
        <button type="button" style={btn(false)} onClick={() => fileRef.current?.click()}>Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importCsv(f); }} />
        <button type="button" style={btn(true)} onClick={() => setEdit({ email: "", tags: [], lists: ["double-cone"], status: "subscribed" })}>Add contact</button>
      </div>
      <div style={{ fontSize: 13, color: muted }}>{counts.sub} subscribed of {counts.all}. Customers with an email in Brewpoint are added automatically.</div>
      <div style={{ border: `1px solid ${line}`, borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        {shown.map((c) => (
          <button type="button" key={c.id} onClick={() => setEdit(c)} style={{ display: "flex", width: "100%", textAlign: "left", gap: 10, alignItems: "center", padding: "10px 12px", border: "none", borderBottom: `1px solid ${line}`, background: "#fff", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}</div>
              <div style={{ fontSize: 12, color: muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[c.first_name, c.email].filter(Boolean).join(" · ")}</div>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "45%" }}>{(c.tags || []).slice(0, 3).map((t) => <span key={t} style={{ fontSize: 11, background: field, borderRadius: 10, padding: "2px 7px", color: muted }}>{t}</span>)}</div>
            <span style={{ fontSize: 11.5, color: c.status === "subscribed" ? green : "#B5523B", minWidth: 80, textAlign: "right" }}>{c.status}</span>
          </button>
        ))}
        {!shown.length && <div style={{ padding: 16, color: muted, fontSize: 14 }}>No contacts match.</div>}
      </div>
      {edit && <ContactModal contact={edit} allTags={allTags} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

// ─── Automations ────────────────────────────────────────────────────────────
const AUTO_PRESETS = [
  { trigger: "welcome", name: "Welcome new contacts", desc: "Sends once to anyone added to your list in the last few days.", params: { within_days: 3 }, subject: "Kia ora {{first_name|there}} 👋", blocks: [{ type: "heading", text: "Welcome aboard!", size: "xl" }, { type: "text", text: "Kia ora {{first_name|there}},\n\nThanks for being on our list — you'll be first to hear about new releases, seasonal drops and events." }, { type: "button", label: "See what's pouring", url: "" }] },
  { trigger: "no_order", name: "Reorder nudge", desc: "Customers who haven't ordered in a while. Uses real order history from Xero/Upstock.", params: { days: 42 }, subject: "Running low, {{first_name|there}}?", blocks: [{ type: "heading", text: "Time for a top-up? 🍺", size: "lg" }, { type: "text", text: "Hey {{first_name|there}},\n\nIt's been a little while since your last order — here's what's fresh and ready to go." }, { type: "button", label: "Reply to order", url: "" }] },
  { trigger: "first_order", name: "First order thank-you", desc: "Sends once to a customer after their very first order.", params: { within_days: 3 }, subject: "Cheers for your first order!", blocks: [{ type: "heading", text: "Cheers for backing us! 🙌", size: "lg" }, { type: "text", text: "Hi {{first_name|there}},\n\nThanks for your first order. If you ever need tap badges, coasters or a hand with anything, just reply to this email." }] },
  { trigger: "tag_added", name: "Tag follow-up", desc: "Sends once to anyone with a chosen tag (e.g. 'tasting' after a tasting visit).", params: { tag: "tasting" }, subject: "Great to see you!", blocks: [{ type: "heading", text: "Thanks for having us!", size: "lg" }, { type: "text", text: "Hi {{first_name|there}},\n\nGreat to catch up and pour you a few. Here's a recap of what we tasted." }] },
];

function AutomationsTab({ automations, reload, companyId, settings, beerNames, showToast }) {
  const [edit, setEdit] = useState(null);
  const [stats, setStats] = useState({});
  useEffect(() => {
    supabase.from("marketing_sends").select("automation_id, status, opened_at").not("automation_id", "is", null).then(({ data }) => {
      const s = {}; for (const r of data || []) { s[r.automation_id] = s[r.automation_id] || { sent: 0, opened: 0 }; if (r.status !== "queued") s[r.automation_id].sent++; if (r.opened_at) s[r.automation_id].opened++; } setStats(s);
    });
  }, [automations]);
  const add = async (p) => {
    const { error } = await supabase.from("marketing_automations").insert({ company_id: companyId, name: p.name, trigger: p.trigger, params: p.params, subject: p.subject, blocks: p.blocks, theme: "fun" });
    if (error) showToast("error", error.message); else reload();
  };
  const saveAuto = async (a) => {
    const { error } = await supabase.from("marketing_automations").update({ name: a.name, params: a.params, subject: a.subject, preheader: a.preheader, blocks: a.blocks, brand: a.brand, theme: a.theme, active: a.active, cooldown_days: Number(a.cooldown_days) || 30 }).eq("id", a.id);
    if (error) showToast("error", error.message); else { reload(); setEdit(null); showToast("success", a.active ? "Saved — it's running." : "Saved (switched off)."); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13.5, color: muted, lineHeight: 1.5 }}>Automations check every hour and send by themselves. Nobody gets the same one twice (reorder nudges wait the cool-down before repeating).</div>
      {automations.map((a) => (
        <div key={a.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: ink }}>{a.name}</div>
            <div style={{ fontSize: 12.5, color: muted }}>{AUTO_PRESETS.find((p) => p.trigger === a.trigger)?.desc} {stats[a.id] ? `· ${stats[a.id].sent} sent, ${stats[a.id].opened} opened` : ""}</div>
          </div>
          <span style={{ fontSize: 12, color: a.active ? green : muted }}>{a.active ? "On" : "Off"}</span>
          <button type="button" style={btn(false)} onClick={() => setEdit(a)}>Edit</button>
        </div>
      ))}
      <div style={{ ...labelS, marginTop: 8 }}>Add an automation</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
        {AUTO_PRESETS.map((p) => <button type="button" key={p.trigger} onClick={() => add(p)} style={{ ...card, textAlign: "left", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}><div style={{ fontWeight: 600, color: ink }}>+ {p.name}</div><div style={{ fontSize: 12.5, color: muted, marginTop: 4 }}>{p.desc}</div></button>)}
      </div>
      {edit && <AutomationEditor auto={edit} onClose={() => setEdit(null)} onSave={saveAuto} companyId={companyId} settings={settings} beerNames={beerNames} showToast={showToast} />}
    </div>
  );
}

function AutomationEditor({ auto, onClose, onSave, companyId, settings, beerNames, showToast }) {
  const [a, setA] = useState(auto);
  const p = a.params || {};
  const setP = (k, v) => setA({ ...a, params: { ...p, [k]: v } });
  const test = async () => { try { const r = await callEngine({ action: "test", content: a }); showToast("success", `Test sent to ${r.to}.`); } catch (e) { showToast("error", e.message); } };
  return (
    <Modal wide title={a.name} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          <Text label="Name" value={a.name} onChange={(v) => setA({ ...a, name: v })} />
          <Text label="Subject" value={a.subject} onChange={(v) => setA({ ...a, subject: v })} />
          {a.trigger === "no_order" && <Text label="No order for (days)" type="number" value={p.days ?? 42} onChange={(v) => setP("days", Number(v) || 42)} />}
          {a.trigger === "tag_added" && <Text label="Tag" value={p.tag} onChange={(v) => setP("tag", v.trim().toLowerCase())} />}
          {a.trigger === "no_order" && <Text label="Repeat no sooner than (days)" type="number" value={a.cooldown_days} onChange={(v) => setA({ ...a, cooldown_days: v })} />}
        </div>
        <ContentEditor value={a} onChange={setA} companyId={companyId} settings={settings} onError={(m) => showToast("error", m)} beerNames={beerNames} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${line}`, paddingTop: 12, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={!!a.active} onChange={(e) => setA({ ...a, active: e.target.checked })} /> Switched on</label>
          <div style={{ display: "flex", gap: 8 }}><button type="button" style={btn(false)} onClick={test}>Send me a test</button><button type="button" style={btn(false)} onClick={onClose}>Close</button><button type="button" style={btn(true)} onClick={() => onSave(a)}>Save</button></div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────
function SettingsTab({ settings, companyId, reload, showToast }) {
  const [s, setS] = useState(settings || { daily_limit: 100, brand_logos: {} });
  const [status, setStatus] = useState(null);
  useEffect(() => { callEngine({ action: "status" }).then(setStatus).catch((e) => setStatus({ error: e.message })); }, []);
  const save = async () => {
    const row = { company_id: companyId, from_name: s.from_name || null, from_email: (s.from_email || "").trim() || null, reply_to: (s.reply_to || "").trim() || null, business_address: s.business_address || null, daily_limit: Number(s.daily_limit) || 100, brand_logos: s.brand_logos || {}, suggestions_enabled: s.suggestions_enabled !== false, test_email: (s.test_email || "").trim() || null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("marketing_settings").upsert(row);
    if (error) showToast("error", error.message); else { showToast("success", "Saved."); reload(); }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 620 }}>
      <div style={card}>
        <div style={{ ...labelS, marginBottom: 6 }}>Sending connection</div>
        {!status ? <div style={{ fontSize: 13 }}>Checking…</div> : status.error ? <div style={{ fontSize: 13, color: "#B5523B" }}>{status.error}</div> : (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: ink }}>
            Email service: <b style={{ color: status.hasKey ? green : "#B5523B" }}>{status.hasKey ? "connected" : "not connected yet"}</b><br />
            Domain: <b style={{ color: status.domain?.status === "verified" ? green : "#B5523B" }}>{status.domain ? `${status.domain.name} — ${status.domain.status}` : "not set up"}</b><br />
            Sent today: {status.sentToday} of {status.dailyLimit} · Waiting to send: {status.queued}
          </div>
        )}
      </div>
      <Text label="From name" value={s.from_name} onChange={(v) => setS({ ...s, from_name: v })} placeholder="Double Cone Brewing" />
      <Text label="From email (must be on your verified domain)" value={s.from_email} onChange={(v) => setS({ ...s, from_email: v })} placeholder="hello@doubleconebrewing.co.nz" />
      <Text label="Replies go to" value={s.reply_to} onChange={(v) => setS({ ...s, reply_to: v })} placeholder="steve@doubleconebrewing.co.nz" />
      <Text label="Send tests to" value={s.test_email} onChange={(v) => setS({ ...s, test_email: v })} />
      <Area label="Business address (required in every marketing email by NZ law)" rows={2} value={s.business_address} onChange={(v) => setS({ ...s, business_address: v })} />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45 }}><input type="checkbox" checked={s.suggestions_enabled !== false} onChange={(e) => setS({ ...s, suggestions_enabled: e.target.checked })} style={{ marginTop: 3 }} /><span><b>Product suggestions</b> — suggest what to pitch each venue (on customer pages, the Suggestions tab and email audiences). Learns from every new order.</span></label>
      <Text label="Most emails per day" type="number" value={s.daily_limit} onChange={(v) => setS({ ...s, daily_limit: v })} />
      <div style={{ fontSize: 12.5, color: muted, marginTop: -6 }}>Resend's free plan allows 100 a day (3,000 a month). Bigger sends carry on the next day automatically.</div>
      {Object.entries(BRANDS).map(([k, b]) => <ImagePicker key={k} label={`${b.name} logo`} value={(s.brand_logos || {})[k]} onChange={(url) => setS({ ...s, brand_logos: { ...(s.brand_logos || {}), [k]: url } })} companyId={companyId} onError={(m) => showToast("error", m)} />)}
      <div><button type="button" style={btn(true)} onClick={save}>Save settings</button></div>
    </div>
  );
}

// ─── Main view ──────────────────────────────────────────────────────────────
export function MarketingView({ companyId, batches = [], salesOrders = [], availableStock = [], customers = [], showToast, userId }) {
  const [tab, setTab] = useState("emails");
  const [campaigns, setCampaigns] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [report, setReport] = useState(null);
  const [newKind, setNewKind] = useState(false);

  const reload = async () => {
    const [c, k, a, s] = await Promise.all([
      supabase.from("marketing_campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("marketing_contacts").select("*").order("company_name", { ascending: true, nullsFirst: false }),
      supabase.from("marketing_automations").select("*").order("created_at"),
      supabase.from("marketing_settings").select("*").maybeSingle(),
    ]);
    setCampaigns(c.data || []); setContacts(k.data || []); setAutomations(a.data || []); setSettings(s.data || null); setLoading(false);
  };
  useEffect(() => { reload(); const t = setInterval(reload, 30000); return () => clearInterval(t); }, []);

  const suggestionsOn = settings ? settings.suggestions_enabled !== false : true;
  const sugg = useMemo(() => (suggestionsOn ? computeSuggestions({ salesOrders, availableStock, batches }) : { byCustomer: new Map(), beers: [] }), [suggestionsOn, salesOrders, availableStock, batches]);
  const contactByCustomer = useMemo(() => { const m = new Map(); for (const c of contacts) if (c.customer_id && c.status === "subscribed" && !m.has(c.customer_id)) m.set(c.customer_id, c.id); return m; }, [contacts]);
  const likely = useMemo(() => {
    const m = new Map();
    for (const [cust, list] of sugg.byCustomer) {
      const cid = contactByCustomer.get(cust);
      if (!cid) continue;
      for (const sItem of list.slice(0, 3)) {
        if (!m.has(sItem.beerKey)) m.set(sItem.beerKey, { key: sItem.beerKey, name: sItem.beerName, isNew: !!sItem.isNew, contactIds: [] });
        m.get(sItem.beerKey).contactIds.push(cid);
      }
    }
    return [...m.values()].sort((a, b) => b.contactIds.length - a.contactIds.length);
  }, [sugg, contactByCustomer]);
  const allTags = useMemo(() => [...new Set(contacts.flatMap((c) => c.tags || []))].sort(), [contacts]);
  const beerNames = useMemo(() => [...new Set(batches.filter((b) => !b.mergedIntoBatchId).map((b) => String(b.name || "").replace(/\s*[—-]\s*(brew day.*|[AB])$/i, "").replace(/\s+\d+L$/i, "").trim()).filter(Boolean))].sort(), [batches]);

  const create = async (kind, brand) => {
    const { data, error } = await supabase.from("marketing_campaigns").insert({ company_id: companyId, name: `${kind === "blank" ? "New email" : kind === "new-release" ? "New release" : kind === "event" ? "Event invite" : "What's pouring"} — ${new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}`, brand, theme: kind === "event" ? "bold" : "fun", blocks: starterBlocks(kind, brand), audience: {}, created_by: userId || null }).select().single();
    if (error) { showToast("error", error.message); return; }
    setNewKind(false); setCampaigns((p) => [data, ...p]); setEditing(data);
  };
  const duplicate = async (c) => {
    const { data, error } = await supabase.from("marketing_campaigns").insert({ company_id: companyId, name: `${c.name} (copy)`, brand: c.brand, theme: c.theme, subject: c.subject, preheader: c.preheader, blocks: c.blocks, audience: c.audience }).select().single();
    if (error) showToast("error", error.message); else { setCampaigns((p) => [data, ...p]); setEditing(data); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.name}"?`)) return;
    const { error } = await supabase.from("marketing_campaigns").delete().eq("id", c.id);
    if (error) showToast("error", error.message); else reload();
  };
  const cancel = async (c) => { try { const r = await callEngine({ action: "cancel", campaignId: c.id }); showToast("success", `Stopped — ${r.cancelled} unsent emails cancelled.`); reload(); } catch (e) { showToast("error", e.message); } };

  if (loading) return <div style={{ color: muted, padding: 20 }}>Loading marketing…</div>;
  const needsSetup = !settings?.from_email || !settings?.business_address;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`@media (max-width: 900px){ .mkt-editor{ grid-template-columns: 1fr !important; } }`}</style>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["emails", "Emails"], ["contacts", `Contacts (${contacts.filter((c) => c.status === "subscribed").length})`], ...(suggestionsOn ? [["suggestions", "Suggestions"]] : []), ["automations", "Automations"], ["settings", "Settings"]].map(([k, l]) => <button key={k} type="button" style={chip(tab === k)} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {needsSetup && tab !== "settings" && <div style={{ ...card, background: "#FFF8E8", borderColor: "#E9D9A8", fontSize: 13.5 }}>Before sending: add your From email and business address in <button type="button" onClick={() => setTab("settings")} style={{ background: "none", border: "none", color: green, cursor: "pointer", padding: 0, fontWeight: 600 }}>Settings</button>.</div>}

      {tab === "emails" && (
        <>
          <div><button type="button" style={btn(true)} onClick={() => setNewKind(true)}>New email</button></div>
          {campaigns.map((c) => (
            <div key={c.id} style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 600, color: ink }}>{c.name}</div>
                <div style={{ fontSize: 12.5, color: muted }}>{c.subject || "No subject yet"}{c.status === "scheduled" && c.scheduled_at ? ` · ${new Date(c.scheduled_at).toLocaleString("en-NZ", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}{c.sent_at ? ` · sent ${new Date(c.sent_at).toLocaleDateString("en-NZ")}` : ""}</div>
              </div>
              <span style={{ fontSize: 12, color: STATUS_COLOR[c.status], fontWeight: 600 }}>{STATUS_LABEL[c.status]}</span>
              {["sending", "sent", "testing"].includes(c.status) && <button type="button" style={btn(false)} onClick={() => setReport(c)}>Results</button>}
              {["sending", "testing", "scheduled"].includes(c.status) && <button type="button" style={btn(false)} onClick={() => cancel(c)}>Stop</button>}
              <button type="button" style={btn(false)} onClick={() => setEditing(c)}>{["draft", "scheduled"].includes(c.status) ? "Edit" : "View"}</button>
              <button type="button" style={btn(false)} onClick={() => duplicate(c)}>Duplicate</button>
              {c.status === "draft" && <button type="button" style={{ ...btn(false), color: "#B5523B" }} onClick={() => remove(c)}>Delete</button>}
            </div>
          ))}
          {!campaigns.length && <div style={{ color: muted, fontSize: 14 }}>No emails yet — tap New email to make your first one.</div>}
        </>
      )}
      {tab === "contacts" && <ContactsTab contacts={contacts} reload={reload} companyId={companyId} allTags={allTags} showToast={showToast} />}
      {tab === "suggestions" && <SuggestionsTab sugg={sugg} customers={customers} contactByCustomer={contactByCustomer} likely={likely} onEmail={async (beer) => {
        const { data, error } = await supabase.from("marketing_campaigns").insert({ company_id: companyId, name: `${beer.name} — suggested venues`, brand: "double-cone", theme: "fun", blocks: starterBlocks("new-release", "double-cone").map((b) => (b.type === "beer" ? { ...b, name: beer.name, tag: beer.isNew ? "New" : "Pouring now" } : b)), audience: { likely_beers: [beer.key], contact_ids: beer.contactIds }, created_by: userId || null }).select().single();
        if (error) { showToast("error", error.message); return; }
        setCampaigns((p) => [data, ...p]); setEditing(data); setTab("emails");
      }} />}
      {tab === "automations" && <AutomationsTab automations={automations} reload={reload} companyId={companyId} settings={settings} beerNames={beerNames} showToast={showToast} />}
      {tab === "settings" && <SettingsTab settings={settings} companyId={companyId} reload={reload} showToast={showToast} />}

      {newKind && (
        <Modal title="New email" onClose={() => setNewKind(false)}>
          <NewEmailPicker onPick={create} />
        </Modal>
      )}
      {editing && <CampaignEditor campaign={editing} onClose={() => { setEditing(null); reload(); }} onSaved={(d) => setCampaigns((p) => p.map((x) => (x.id === d.id ? d : x)))} companyId={companyId} settings={settings} allTags={allTags} beerNames={beerNames} showToast={showToast} likely={likely} />}
      {report && <CampaignReport campaign={report} contacts={contacts} onClose={() => setReport(null)} />}
    </div>
  );
}

function NewEmailPicker({ onPick }) {
  const [brand, setBrand] = useState("double-cone");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Object.keys(BRANDS).length > 1 && <div style={{ display: "flex", gap: 6 }}>{Object.entries(BRANDS).map(([k, b]) => <button type="button" key={k} style={chip(brand === k)} onClick={() => setBrand(k)}>{b.name}</button>)}</div>}
      {[["new-release", "New release 🍺", "Big banner, the beer, a callout and an order button"], ["whats-pouring", "What's pouring", "A few beers with stock badges"], ["event", "Event invite 🎉", "Banner, details and an RSVP button"], ["blank", "Blank", "Start from scratch"]].map(([k, l, d]) => (
        <button type="button" key={k} onClick={() => onPick(k, brand)} style={{ ...card, textAlign: "left", cursor: "pointer", fontFamily: "'Inter', sans-serif" }}><div style={{ fontWeight: 600, color: ink }}>{l}</div><div style={{ fontSize: 12.5, color: muted }}>{d}</div></button>
      ))}
    </div>
  );
}

// ─── Suggestions: who to pitch what ─────────────────────────────────────────
function SuggestionsTab({ sugg, customers, contactByCustomer, likely, onEmail }) {
  const [beer, setBeer] = useState("");
  const custName = new Map(customers.map((c) => [c.id, c.name]));
  const rows = [...sugg.byCustomer.entries()]
    .map(([cid, list]) => [cid, beer ? list.filter((x) => x.beerKey === beer) : list])
    .filter(([, list]) => list.length)
    .sort((a, b) => b[1][0].score - a[1][0].score);
  const sel = likely.find((b) => b.key === beer);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13.5, color: muted, lineHeight: 1.5 }}>Worked out from every order (Xero, Upstock and Brewpoint): what similar venues buy, what each venue has stopped ordering, the time of year, and new beers coming through the tanks. It updates itself as new orders come in.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={beer} onChange={(e) => setBeer(e.target.value)} style={{ ...inputS, maxWidth: 260 }}>
          <option value="">All beers</option>
          {sugg.beers.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
        </select>
        {sel && sel.contactIds.length > 0 && <button type="button" style={btn(true)} onClick={() => onEmail(sel)}>Email these {sel.contactIds.length} venues about {sel.name}</button>}
      </div>
      {rows.map(([cid, list]) => (
        <div key={cid} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontWeight: 600, color: ink }}>{custName.get(cid) || "Customer"}</div>
            {!contactByCustomer.get(cid) && <span style={{ fontSize: 11.5, color: muted }}>no email on file</span>}
          </div>
          {list.slice(0, beer ? 1 : 3).map((x) => (
            <div key={x.beerKey} style={{ marginTop: 8, borderLeft: `3px solid ${x.isNew ? "#D9A441" : green}`, paddingLeft: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: ink }}>{x.beerName}{x.isNew ? " · new" : ""}</div>
              <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.45 }}>{x.reasons.join(" · ")}</div>
            </div>
          ))}
        </div>
      ))}
      {!rows.length && <div style={{ color: muted, fontSize: 14 }}>Nothing to suggest right now.</div>}
    </div>
  );
}
