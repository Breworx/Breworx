// Supabase Edge Function: xero-api
//
// Handles everything the Xero integration needs, keyed off an `action` in the request body:
//   - "listItems"     → returns the tracked items in the connected Xero org
//   - "listAllItems"  → returns every item with a code (tracked or not), for matching sales to beers
//   - "listAccounts"  → returns accounts suitable for the adjustment/offset line
//   - "postStock"     → posts a zero-dollar stock movement for a packaging event
//   - "listSales"     → returns sales invoices + customer credit notes since a date (two-way stock), plus every open draft
//   - "listContacts"  → returns active Xero contacts, for linking to a Brewpoint customer
//   - "createContact" → creates a new Xero contact from a Brewpoint customer's details
//   - "createInvoice" → creates a sales invoice (ACCREC) for a fulfilled sales order
//
// Uses the same secrets as xero-callback:
//   XERO_CLIENT_ID, XERO_CLIENT_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getValidConnection(supabase, companyId) {
  const { data: conn, error } = await supabase
    .from("xero_connections")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !conn) return { error: "Not connected to Xero" };

  const expiresAt = new Date(conn.token_expires_at).getTime();
  if (Date.now() < expiresAt - 60000) {
    return { accessToken: conn.access_token, tenantId: conn.tenant_id };
  }

  const clientId = (Deno.env.get("XERO_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("XERO_CLIENT_SECRET") || "").trim();
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const tokenRes = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) return { error: "Could not refresh Xero connection — please reconnect in Settings." };

  const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  await supabase
    .from("xero_connections")
    .update({ access_token: tokenData.access_token, refresh_token: tokenData.refresh_token, token_expires_at: newExpiresAt })
    .eq("company_id", companyId);

  return { accessToken: tokenData.access_token, tenantId: conn.tenant_id };
}

async function xeroFetch(path, accessToken, tenantId, options = {}) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function ensureAdjustmentContact(accessToken, tenantId) {
  const search = await xeroFetch(`Contacts?where=Name=="Inventory Adjustments"`, accessToken, tenantId);
  if (search.ok && search.data.Contacts && search.data.Contacts.length > 0) {
    return search.data.Contacts[0].ContactID;
  }
  const create = await xeroFetch("Contacts", accessToken, tenantId, {
    method: "PUT",
    body: JSON.stringify({ Contacts: [{ Name: "Inventory Adjustments" }] }),
  });
  if (create.ok && create.data.Contacts && create.data.Contacts.length > 0) {
    return create.data.Contacts[0].ContactID;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { action } = body;
    if (!action) return json({ error: "Missing action" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: "Not signed in" }, 401);

    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (profileError || !profileRow?.company_id) return json({ error: "No company found for this user" }, 400);

    const companyId = profileRow.company_id;

    const conn = await getValidConnection(supabase, companyId);
    if (conn.error) return json({ error: conn.error }, 400);
    const { accessToken, tenantId } = conn;

    if (action === "listItems") {
      const res = await xeroFetch("Items", accessToken, tenantId);
      if (!res.ok) return json({ error: "Could not fetch items from Xero", detail: res.data }, 400);
      const items = (res.data.Items || [])
        .filter((i) => i.IsTrackedAsInventory)
        .map((i) => ({ code: i.Code, name: i.Name }));
      return json({ items });
    }

    if (action === "listAllItems") {
      // Every item with a code — not just stock-tracked ones — so sales of
      // untracked items (e.g. a Craftys label) can still be matched to a beer.
      const res = await xeroFetch("Items", accessToken, tenantId);
      if (!res.ok) return json({ error: "Could not fetch items from Xero", detail: res.data }, 400);
      const items = (res.data.Items || [])
        .filter((i) => i.Code)
        .map((i) => ({ code: i.Code, name: i.Name || i.Code, tracked: !!i.IsTrackedAsInventory, qtyOnHand: i.IsTrackedAsInventory ? Number(i.QuantityOnHand) || 0 : null }));
      return json({ items });
    }

    if (action === "listAccounts") {
      const res = await xeroFetch("Accounts", accessToken, tenantId);
      if (!res.ok) return json({ error: "Could not fetch accounts from Xero", detail: res.data }, 400);
      const accounts = (res.data.Accounts || [])
        .filter((a) => ["EXPENSE", "OVERHEADS", "DIRECTCOSTS", "OTHER"].includes(a.Type) && a.Status === "ACTIVE")
        .map((a) => ({ code: a.Code, name: a.Name, type: a.Type }));
      return json({ accounts });
    }

    if (action === "postStock") {
      const { itemCode, quantity, direction, unitCost, adjustmentAccountCode, reference } = body;
      if (!itemCode || !quantity || !direction || !adjustmentAccountCode) {
        return json({ error: "Missing itemCode, quantity, direction, or adjustmentAccountCode" }, 400);
      }
      const contactId = await ensureAdjustmentContact(accessToken, tenantId);
      if (!contactId) return json({ error: "Could not find or create the 'Inventory Adjustments' contact in Xero" }, 400);

      const cost = Number(unitCost) || 0;
      const lineTotal = Math.round(cost * quantity * 100) / 100;

      const documentBody = {
        Type: direction === "increase" ? "ACCPAY" : "ACCPAYCREDIT",
        Contact: { ContactID: contactId },
        Date: new Date().toISOString().slice(0, 10),
        Status: "AUTHORISED",
        LineAmountTypes: "NoTax",
        Reference: reference || "Brewpoint packaging sync",
        LineItems: [
          { ItemCode: itemCode, Quantity: quantity, UnitAmount: cost, Description: reference || "Packaged stock" },
          { Description: "Inventory adjustment offset", Quantity: 1, UnitAmount: -lineTotal, AccountCode: adjustmentAccountCode },
        ],
      };

      const endpoint = direction === "increase" ? "Invoices" : "CreditNotes";
      const bodyKey = direction === "increase" ? "Invoices" : "CreditNotes";
      const res = await xeroFetch(endpoint, accessToken, tenantId, {
        method: "PUT",
        body: JSON.stringify({ [bodyKey]: [documentBody] }),
      });
      if (!res.ok) return json({ error: "Xero rejected the stock update", detail: res.data }, 400);

      return json({ success: true });
    }

    if (action === "listSales") {
      // Sales invoices and customer credit notes dated on or after `since`,
      // including voided/deleted ones (so the app can put stock back). Lines
      // without an item code are left out — they can't be matched to stock.
      const since = String(body.since || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) return json({ error: "Missing since date (YYYY-MM-DD)" }, 400);
      const [y, m, d] = since.split("-").map(Number);
      const dateWhere = `Date>=DateTime(${y},${m},${d})`;
      const docs = [];

      const seen = new Set();
      const collect = async (endpoint, key, type, extraWhere) => {
        for (let page = 1; page <= 50; page += 1) {
          const where = encodeURIComponent(`Type=="${type}" AND ${extraWhere || dateWhere}`);
          const res = await xeroFetch(`${endpoint}?where=${where}&page=${page}`, accessToken, tenantId);
          if (!res.ok) return { error: res.data };
          const list = res.data[key] || [];
          list.forEach((doc) => {
            const status = doc.Status;
            // Drafts (e.g. Upstock orders waiting in Xero) hold stock in Brewpoint.
            if (!["AUTHORISED", "PAID", "VOIDED", "DELETED", "DRAFT", "SUBMITTED"].includes(status)) return;
            const docId = doc.InvoiceID || doc.CreditNoteID;
            if (seen.has(docId)) return;
            seen.add(docId);
            const lines = (doc.LineItems || [])
              .filter((l) => l.ItemCode && Number(l.Quantity))
              .map((l) => ({
                lineId: l.LineItemID,
                itemCode: l.ItemCode,
                description: l.Description || "",
                qty: Number(l.Quantity),
                unitAmount: Number(l.UnitAmount) || 0,
                lineAmount: Number(l.LineAmount) || 0,
                taxAmount: Number(l.TaxAmount) || 0,
                discountRate: Number(l.DiscountRate) || 0,
              }));
            if (lines.length === 0) return;
            docs.push({
              docId: doc.InvoiceID || doc.CreditNoteID,
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

      const a = await collect("Invoices", "Invoices", "ACCREC");
      if (a.error) return json({ error: "Could not read invoices from Xero", detail: a.error }, 400);
      // Every open draft, however old, so Brewpoint can hold stock for it.
      const dr = await collect("Invoices", "Invoices", "ACCREC", `(Status=="DRAFT" OR Status=="SUBMITTED")`);
      if (dr.error) return json({ error: "Could not read draft invoices from Xero", detail: dr.error }, 400);
      const b = await collect("CreditNotes", "CreditNotes", "ACCRECCREDIT");
      if (b.error) return json({ error: "Could not read credit notes from Xero", detail: b.error }, 400);
      return json({ docs, draftsComplete: true });
    }

    if (action === "listContacts") {
      const res = await xeroFetch("Contacts?order=Name", accessToken, tenantId);
      if (!res.ok) return json({ error: "Could not fetch contacts from Xero", detail: res.data }, 400);
      const contacts = (res.data.Contacts || [])
        .filter((c) => c.ContactStatus === "ACTIVE")
        .map((c) => ({ contactId: c.ContactID, name: c.Name }));
      return json({ contacts });
    }

    if (action === "createContact") {
      const { name, email } = body;
      if (!name) return json({ error: "Missing name" }, 400);
      const payload = { Name: name };
      if (email) payload.EmailAddress = email;
      const res = await xeroFetch("Contacts", accessToken, tenantId, {
        method: "PUT",
        body: JSON.stringify({ Contacts: [payload] }),
      });
      if (!res.ok) return json({ error: "Xero rejected the new contact", detail: res.data }, 400);
      const created = res.data.Contacts && res.data.Contacts[0];
      if (!created) return json({ error: "Xero didn't return the created contact" }, 400);
      return json({ contactId: created.ContactID, contactName: created.Name });
    }

    if (action === "createInvoice") {
      const { contactId, customerName, customerEmail, reference, lineItems } = body;
      if (!lineItems || lineItems.length === 0) return json({ error: "No line items provided" }, 400);

      let resolvedContactId = contactId || null;
      if (!resolvedContactId && customerName) {
        const whereClause = encodeURIComponent(`Name=="${customerName.replace(/"/g, '\\"')}"`);
        const search = await xeroFetch(`Contacts?where=${whereClause}`, accessToken, tenantId);
        if (search.ok && search.data.Contacts && search.data.Contacts.length > 0) {
          resolvedContactId = search.data.Contacts[0].ContactID;
        } else {
          const payload = { Name: customerName };
          if (customerEmail) payload.EmailAddress = customerEmail;
          const create = await xeroFetch("Contacts", accessToken, tenantId, {
            method: "PUT",
            body: JSON.stringify({ Contacts: [payload] }),
          });
          if (create.ok && create.data.Contacts && create.data.Contacts.length > 0) {
            resolvedContactId = create.data.Contacts[0].ContactID;
          }
        }
      }
      if (!resolvedContactId) return json({ error: "Could not find or create a Xero contact for this customer" }, 400);

      const invoiceBody = {
        Type: "ACCREC",
        Contact: { ContactID: resolvedContactId },
        Date: new Date().toISOString().slice(0, 10),
        Status: "AUTHORISED",
        LineAmountTypes: "Exclusive",
        Reference: reference || "Brewpoint order",
        LineItems: lineItems.map((l) => ({
          Description: l.description,
          Quantity: l.quantity,
          UnitAmount: l.unitAmount,
          TaxType: "OUTPUT2",
          ...(l.itemCode ? { ItemCode: l.itemCode } : {}),
        })),
      };

      const res = await xeroFetch("Invoices", accessToken, tenantId, {
        method: "PUT",
        body: JSON.stringify({ Invoices: [invoiceBody] }),
      });
      if (!res.ok) return json({ error: "Xero rejected the invoice", detail: res.data }, 400);

      return json({ success: true, invoiceId: res.data.Invoices && res.data.Invoices[0] ? res.data.Invoices[0].InvoiceID : null });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: "Unexpected error", detail: String(err) }, 500);
  }
});
