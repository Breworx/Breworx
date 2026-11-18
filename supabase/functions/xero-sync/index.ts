// Supabase Edge Function: xero-sync
//
// The Xero sales check, run on the server so stock, orders and back orders
// stay up to date with the app closed. Same logic the app uses (copied in
// lib/ by scripts/copy-edge-libs.sh):
//   1. read Xero sales invoices + credit notes since the sync start, plus
//      every open draft (Upstock orders)
//   2. take sold stock off the batches it came from (planXeroSales)
//   3. turn invoices and drafts into read-only orders (planXeroOrders);
//      drafts hold stock and show back orders, deleted drafts drop off
//
// Called by:
//   - pg_cron every 2 minutes (run_xero_sync), with the x-keepalive-secret
//     header: every company with the sales check on
//   - the xero-webhook function when Xero says an invoice changed, same
//     header plus { tenantId }: just that company
//   - the app ("check now" / on open), with the user's sign-in: their company
// A lock (try_xero_sync_lock) makes sure only one check runs at a time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { availableStockList, isOpenXeroDraft, planXeroSales, setBeerAliasMap, uid } from "./lib/production.js";
import { planXeroOrders } from "./lib/xeroOrders.js";
import { rowToBatch, rowToCustomer, rowToMixedPackAssembly, rowToSalesOrder, salesOrderToRow } from "./lib/mappers.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const todayNZ = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date());

async function getValidConnection(supabase, conn) {
  if (Date.now() < new Date(conn.token_expires_at).getTime() - 60000) return { accessToken: conn.access_token, tenantId: conn.tenant_id };
  const clientId = (Deno.env.get("XERO_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("XERO_CLIENT_SECRET") || "").trim();
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  if (!res.ok) {
    await supabase.from("xero_connections").update({ keepalive_failed_at: new Date().toISOString() }).eq("company_id", conn.company_id);
    return { error: "Could not refresh Xero connection — please reconnect in Settings." };
  }
  await supabase.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token, token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() }).eq("company_id", conn.company_id);
  return { accessToken: t.access_token, tenantId: conn.tenant_id };
}

async function xeroGet(path, accessToken, tenantId) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, retryAfter: Number(res.headers.get("retry-after")) || null, limitProblem: res.headers.get("x-rate-limit-problem") || null };
}

// Same shape as xero-api's listSales.
async function listSales(since, accessToken, tenantId) {
  const [y, m, d] = since.split("-").map(Number);
  const dateWhere = `Date>=DateTime(${y},${m},${d})`;
  const docs = [];
  const seen = new Set();
  const collect = async (endpoint, key, type, extraWhere) => {
    for (let page = 1; page <= 50; page += 1) {
      const where = encodeURIComponent(`Type=="${type}" AND ${extraWhere || dateWhere}`);
      const res = await xeroGet(`${endpoint}?where=${where}&page=${page}`, accessToken, tenantId);
      if (!res.ok) return { error: res.data, status: res.status, retryAfter: res.retryAfter, limitProblem: res.limitProblem };
      const list = res.data[key] || [];
      list.forEach((doc) => {
        const status = doc.Status;
        if (!["AUTHORISED", "PAID", "VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(status)) return;
        const docId = doc.InvoiceID || doc.CreditNoteID;
        if (seen.has(docId)) return;
        seen.add(docId);
        const lines = (doc.LineItems || [])
          .filter((l) => l.ItemCode && Number(l.Quantity))
          .map((l) => ({ lineId: l.LineItemID, itemCode: l.ItemCode, description: l.Description || "", qty: Number(l.Quantity), unitAmount: Number(l.UnitAmount) || 0, lineAmount: Number(l.LineAmount) || 0, taxAmount: Number(l.TaxAmount) || 0, discountRate: Number(l.DiscountRate) || 0 }));
        if (lines.length === 0) return;
        docs.push({
          docId,
          docType: type === "ACCREC" ? "invoice" : "credit",
          number: doc.InvoiceNumber || doc.CreditNoteNumber || "",
          reference: doc.Reference || "",
          date: doc.DateString ? String(doc.DateString).slice(0, 10) : null,
          status,
          contactName: doc.Contact ? doc.Contact.Name : "",
          contactId: doc.Contact ? doc.Contact.ContactID : "",
          lineAmountTypes: doc.LineAmountTypes || "Exclusive",
          lines,
        });
      });
      if (list.length < 100) break;
    }
    return {};
  };
  // One invoice query for recent invoices plus any open drafts (older drafts
  // included), and one for credit notes — 2 Xero calls per check.
  for (const [ep, key, type, extra] of [["Invoices", "Invoices", "ACCREC", `(${dateWhere} OR Status=="DRAFT" OR Status=="SUBMITTED")`], ["CreditNotes", "CreditNotes", "ACCRECCREDIT"]]) {
    const r = await collect(ep, key, type, extra);
    if (r.error) return r;
  }
  return { docs };
}


// ── Branded codes share stock with the house beer ──
// Craftys Hazy (CHAZY) is Base Camp (BC50) in a different name, but Xero
// counts each item code separately and won't approve a draft for a code
// it thinks it has none of. So before a draft is approved, move what's
// needed across in Xero from a code for the same beer that has spare:
// a $0 supplier credit note takes it off the house code and a $0 bill puts
// it on the branded one (Xero's own way to adjust stock), both to the
// "Inventory Adjustments" contact with an offset line on the adjustment
// account. Codes only count as the same beer when they're mapped to the
// same product and container with the same pack size.
async function xeroPut(endpoint, body, accessToken, tenantId) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${endpoint}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function planStockMoves({ docs, salesMap, items }) {
  const demand = {};
  const forDocs = {};
  (docs || []).forEach((d) => {
    if (d.docType !== "invoice" || !(d.status === "DRAFT" || d.status === "SUBMITTED")) return;
    d.lines.forEach((l) => {
      const code = String(l.itemCode);
      demand[code] = (demand[code] || 0) + Math.abs(Number(l.qty) || 0);
      (forDocs[code] = forDocs[code] || new Set()).add(d.number || "draft");
    });
  });
  const groups = {};
  (salesMap || []).forEach((m) => {
    if (m.ignore || !m.product_key) return;
    const key = `${m.product_key}|${Number(m.units_per_xero_unit) || 1}`;
    (groups[key] = groups[key] || []).push(String(m.xero_item_code));
  });
  const stock = {};
  (items || []).forEach((i) => { if (i.IsTrackedAsInventory) stock[String(i.Code)] = Number(i.QuantityOnHand) || 0; });
  const moves = [];
  Object.values(groups).forEach((codes) => {
    const tracked = [...new Set(codes)].filter((c) => c in stock);
    if (tracked.length < 2) return;
    const qoh = Object.fromEntries(tracked.map((c) => [c, stock[c]]));
    tracked.forEach((code) => {
      let short = (demand[code] || 0) - qoh[code];
      if (short <= 0) return;
      tracked
        .filter((c) => c !== code)
        .map((c) => ({ c, spare: qoh[c] - (demand[c] || 0) }))
        .filter((x) => x.spare > 0)
        .sort((a, b) => b.spare - a.spare)
        .forEach(({ c, spare }) => {
          if (short <= 0) return;
          const qty = Math.min(short, spare);
          moves.push({ from: c, to: code, qty, refs: [...(forDocs[code] || [])] });
          qoh[c] -= qty; qoh[code] += qty; short -= qty;
        });
    });
  });
  return moves;
}

async function balanceBrandedStock(supabase, companyId, settings, docs, salesMap, xc) {
  const hasDrafts = (docs || []).some((d) => d.docType === "invoice" && (d.status === "DRAFT" || d.status === "SUBMITTED"));
  if (!hasDrafts || !settings.adjustment_account_code) return [];
  // Only worth asking Xero for stock when a draft uses a code that shares its
  // product with another code, and then only when those drafts changed or
  // every hour — Xero allows 5,000 calls a day and this runs every 2 minutes.
  const groupSize = {};
  (salesMap || []).forEach((m) => { if (!m.ignore && m.product_key) { const k = `${m.product_key}|${Number(m.units_per_xero_unit) || 1}`; groupSize[k] = (groupSize[k] || 0) + 1; } });
  const codeGroup = {};
  (salesMap || []).forEach((m) => { if (!m.ignore && m.product_key) codeGroup[String(m.xero_item_code)] = `${m.product_key}|${Number(m.units_per_xero_unit) || 1}`; });
  const relevant = [];
  (docs || []).forEach((d) => { if (d.docType === "invoice" && (d.status === "DRAFT" || d.status === "SUBMITTED")) d.lines.forEach((l) => { const g = codeGroup[String(l.itemCode)]; if (g && groupSize[g] > 1) relevant.push(`${d.docId}:${l.itemCode}:${l.qty}`); }); });
  if (!relevant.length) return [];
  const sig = relevant.sort().join("|");
  const recent = settings.stock_move_checked_at && Date.now() - new Date(settings.stock_move_checked_at).getTime() < 60 * 60 * 1000;
  if (sig === settings.stock_move_sig && recent) return [];
  await supabase.from("xero_settings").update({ stock_move_sig: sig, stock_move_checked_at: new Date().toISOString() }).eq("company_id", companyId);
  const itemsRes = await xeroGet("Items", xc.accessToken, xc.tenantId);
  if (!itemsRes.ok) return [];
  const moves = planStockMoves({ docs, salesMap, items: itemsRes.data.Items || [] });
  if (!moves.length) return [];
  const where = encodeURIComponent('Name=="Inventory Adjustments"');
  const contactRes = await xeroGet(`Contacts?where=${where}`, xc.accessToken, xc.tenantId);
  const contactId = contactRes.ok && contactRes.data.Contacts && contactRes.data.Contacts[0] ? contactRes.data.Contacts[0].ContactID : null;
  if (!contactId) return [];
  const today = todayNZ();
  const done = [];
  for (const mv of moves) {
    const ref = `Brewpoint stock move: ${mv.qty} x ${mv.from} to ${mv.to}${mv.refs.length ? ` for ${mv.refs.join(", ")}` : ""}`;
    const doc = (type, code) => ({
      Type: type, Contact: { ContactID: contactId }, Date: today, DueDate: today, Status: "AUTHORISED", LineAmountTypes: "NoTax", Reference: ref,
      LineItems: [
        { ItemCode: code, Quantity: mv.qty, UnitAmount: 0, Description: ref },
        { Description: "Inventory adjustment offset", Quantity: 1, UnitAmount: 0, AccountCode: settings.adjustment_account_code },
      ],
    });
    const out = await xeroPut("CreditNotes", { CreditNotes: [doc("ACCPAYCREDIT", mv.from)] }, xc.accessToken, xc.tenantId);
    if (!out.ok) { console.error("stock move out failed", JSON.stringify(out.data).slice(0, 500)); continue; }
    const inn = await xeroPut("Invoices", { Invoices: [doc("ACCPAY", mv.to)] }, xc.accessToken, xc.tenantId);
    if (!inn.ok) { console.error("stock move in failed", JSON.stringify(inn.data).slice(0, 500)); continue; }
    done.push(mv);
  }
  return done;
}

const all = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
};

async function syncCompany(supabase, conn) {
  const companyId = conn.company_id;
  // The company owner, for the activity log (connected_by is a name, not an id).
  const ownerRows = await all(supabase.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").limit(1));
  const ownerId = ownerRows[0]?.id || null;
  const settingsRows = await all(supabase.from("xero_settings").select("*").eq("company_id", companyId));
  const settings = settingsRows[0];
  if (!settings || !settings.sales_sync_enabled) return { companyId, skipped: "sales check off" };
  if (settings.sync_paused_until && new Date(settings.sync_paused_until).getTime() > Date.now()) return { companyId, skipped: `waiting out Xero's rate limit until ${settings.sync_paused_until}` };
  const { data: locked } = await supabase.rpc("try_xero_sync_lock", { p_company: companyId, p_seconds: 120 });
  if (!locked) return { companyId, skipped: "already running" };
  try {
    const xc = await getValidConnection(supabase, conn);
    if (xc.error) return { companyId, error: xc.error };
    const since = settings.sales_sync_from || todayNZ();
    const sales = await listSales(since, xc.accessToken, xc.tenantId);
    if (sales.error) {
      if (sales.status === 429) {
        // Xero's rate limit: wait as long as it asks (at least 5 minutes)
        // before trying again, so the retries don't keep the limit pinned.
        const wait = Math.max(300, Math.min(86400, sales.retryAfter || 0));
        const until = new Date(Date.now() + wait * 1000).toISOString();
        await supabase.from("xero_settings").update({ sync_paused_until: until }).eq("company_id", companyId);
        return { companyId, error: `Xero rate limit (${sales.limitProblem || "unknown"}) — paused until ${until}` };
      }
      return { companyId, error: "Could not read sales from Xero" };
    }
    const docs = sales.docs;

    const [batchRows, orderRows, mpaRows, salesMap, itemMappings, ledger, customerRows, aliasRows] = await Promise.all([
      all(supabase.from("batches").select("*").eq("company_id", companyId)),
      all(supabase.from("sales_orders").select("*").eq("company_id", companyId)),
      all(supabase.from("mixed_pack_assemblies").select("*").eq("company_id", companyId)),
      all(supabase.from("xero_sales_item_map").select("*").eq("company_id", companyId)),
      all(supabase.from("xero_item_mappings").select("*").eq("company_id", companyId)),
      all(supabase.from("xero_stock_sales").select("*").eq("company_id", companyId)),
      all(supabase.from("customers").select("*").eq("company_id", companyId)),
      all(supabase.from("beer_aliases").select("batch_name, beer_name").eq("company_id", companyId)),
    ]);
    setBeerAliasMap(Object.fromEntries(aliasRows.map((r) => [String(r.batch_name).toLowerCase(), r.beer_name])));
    let batches = batchRows.map(rowToBatch);
    const salesOrders = orderRows.map(rowToSalesOrder);
    const mpa = mpaRows.map(rowToMixedPackAssembly);
    let customers = customerRows.map(rowToCustomer);

    // ── Stock: take Xero sales off the batches ──
    const approved = new Set(docs.filter((d) => d.status === "AUTHORISED" || d.status === "PAID").map((d) => d.docId));
    const available = availableStockList(batches, salesOrders.filter((o) => !(isOpenXeroDraft(o) && approved.has(o.xeroDocId))), mpa);
    const plan = planXeroSales({ docs, ledger, salesMap, itemMappings, batches, available, brewpointOrderNumbers: salesOrders.filter((o) => o.source !== "xero").map((o) => o.orderNumber) });
    if (plan.rows.length) {
      const rows = plan.rows.map((r) => {
        const { id: _id, created_at: _c, ...rest } = r;
        return { ...rest, company_id: companyId };
      });
      const { error } = await supabase.from("xero_stock_sales").upsert(rows, { onConflict: "company_id,xero_line_id" });
      if (error) return { companyId, error: `ledger: ${error.message}` };
    }
    for (const c of plan.batchChanges) {
      const { error } = await supabase.from("batches").update({ xero_sold: c.xeroSold }).eq("id", c.id);
      if (error) return { companyId, error: `batch: ${error.message}` };
    }
    const changed = Object.fromEntries(plan.batchChanges.map((c) => [c.id, c.xeroSold]));
    batches = batches.map((b) => (changed[b.id] ? { ...b, xeroSold: changed[b.id] } : b));

    // ── Orders: invoices and drafts ──
    const ownNumbers = salesOrders.filter((o) => o.source !== "xero").map((o) => o.orderNumber);
    let op = planXeroOrders({ docs, batches, salesMap, itemMappings, customers, brewpointOrderNumbers: ownNumbers });
    if (op.newContacts.length) {
      const { data, error } = await supabase
        .from("customers")
        .insert(op.newContacts.map((c) => ({ company_id: companyId, name: c.name, type: "Wholesale", xero_contact_id: c.contactId, xero_contact_name: c.name, notes: "Imported from Xero" })))
        .select();
      if (!error && data) {
        customers = [...customers, ...data.map(rowToCustomer)];
        op = planXeroOrders({ docs, batches, salesMap, itemMappings, customers, brewpointOrderNumbers: ownNumbers });
      }
    }
    const orderUpserts = op.orders.map(({ contactId: _c, contactName: _n, ...o }) => {
      const row = salesOrderToRow(o, companyId);
      delete row.id;
      delete row.proofs_of_delivery;
      return { ...row, user_id: ownerId };
    });
    for (let i = 0; i < orderUpserts.length; i += 100) {
      const { error } = await supabase.from("sales_orders").upsert(orderUpserts.slice(i, i + 100), { onConflict: "company_id,xero_doc_id" });
      if (error) return { companyId, error: `orders: ${error.message}` };
    }
    const listed = new Set(docs.map((d) => d.docId));
    const removeIds = new Set(op.removeDocIds);
    salesOrders.forEach((o) => { if (isOpenXeroDraft(o) && !listed.has(o.xeroDocId)) removeIds.add(o.xeroDocId); });
    const gone = salesOrders.filter((o) => o.source === "xero" && removeIds.has(o.xeroDocId)).map((o) => o.id);
    if (gone.length) await supabase.from("sales_orders").delete().in("id", gone);

    // Keep branded codes (Craftys Hazy etc.) stocked from the house beer in Xero.
    let moved = [];
    try { moved = await balanceBrandedStock(supabase, companyId, settings, docs, salesMap, xc); } catch (e) { console.error("stock moves", e); }

    const now = new Date().toISOString();
    await supabase.from("xero_settings").update({ last_sales_sync: now }).eq("company_id", companyId);
    const s = plan.summary;
    const draftsBefore = new Set(salesOrders.filter(isOpenXeroDraft).map((o) => o.xeroDocId));
    const newDrafts = op.orders.filter((o) => o.status === "Confirmed" && !draftsBefore.has(o.xeroDocId)).length;
    const parts = [];
    if (s.applied > 0) parts.push(`took ${Math.round(s.units)} units off for ${s.applied} sale line${s.applied === 1 ? "" : "s"}`);
    if (s.reversed > 0) parts.push(`gave back ${s.reversed} voided`);
    if (newDrafts > 0) parts.push(`${newDrafts} new draft order${newDrafts === 1 ? "" : "s"} holding stock`);
    if (gone.length > 0) parts.push(`${gone.length} order${gone.length === 1 ? "" : "s"} removed (deleted in Xero)`);
    moved.forEach((mv) => parts.push(`moved ${mv.qty} ${mv.from} to ${mv.to} in Xero${mv.refs.length ? ` for ${mv.refs.join(", ")}` : ""}`));
    if (parts.length && ownerId) {
      await supabase.from("activity_log").insert({ id: uid(), user_id: ownerId, company_id: companyId, action: "synced", entity_type: "stock", entity_name: "Xero sales", description: `Xero check: ${parts.join(", ")}`, user_name: "Xero (automatic)" });
    }
    return { companyId, applied: s.applied, reversed: s.reversed, short: s.short, unmapped: s.unmapped, units: s.units, orders: op.orders.length, removed: gone.length, newDrafts, moved, summary: parts.join(", ") };
  } finally {
    await supabase.rpc("release_xero_sync_lock", { p_company: companyId });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const body = await req.json().catch(() => ({}));
    let companyFilter = null;
    let tenantFilter = null;
    const given = req.headers.get("x-keepalive-secret") || "";
    if (given) {
      const { data: secret } = await supabase.rpc("get_xero_keepalive_secret");
      if (!secret || given !== secret) return json({ error: "Not allowed" }, 401);
      if (body.tenantId) tenantFilter = String(body.tenantId);
    } else {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = token ? await supabase.auth.getUser(token) : { data: null };
      if (!u?.user) return json({ error: "Not signed in" }, 401);
      const { data: p } = await supabase.from("profiles").select("company_id").eq("id", u.user.id).maybeSingle();
      if (!p?.company_id) return json({ error: "No company found for this user" }, 400);
      companyFilter = p.company_id;
    }
    let q = supabase.from("xero_connections").select("*");
    if (companyFilter) q = q.eq("company_id", companyFilter);
    if (tenantFilter) q = q.eq("tenant_id", tenantFilter);
    const conns = await all(q);
    if (companyFilter && !conns.length) return json({ error: "Not connected to Xero" }, 400);
    const results = [];
    for (const conn of conns) {
      try {
        results.push(await syncCompany(supabase, conn));
      } catch (e) {
        results.push({ companyId: conn.company_id, error: String(e) });
      }
    }
    return json(companyFilter ? results[0] : { results });
  } catch (err) {
    return json({ error: "Unexpected error", detail: String(err) }, 500);
  }
});
