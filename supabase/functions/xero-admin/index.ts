// Server-side helper for one-off Xero setup jobs (chart of accounts,
// tracking categories, items) that Xero only accepts as PUT — which the
// database's pg_net can't send. Only callable with the same keepalive
// secret the 2-minute sync uses, and only for a short allow-list of
// settings endpoints. Never touches invoices, payments or contacts.
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const ALLOWED = /^(Accounts|TrackingCategories(\/[0-9a-f-]{36}\/Options)?|Items)$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const given = req.headers.get("x-keepalive-secret") || "";
  const { data: secret } = await supabase.rpc("get_xero_keepalive_secret");
  if (!secret || given !== secret) return json({ error: "Not allowed" }, 401);

  const { companyId, requests } = await req.json();
  if (!companyId || !Array.isArray(requests)) return json({ error: "Missing companyId/requests" }, 400);
  const { data: conn } = await supabase.from("xero_connections").select("access_token, tenant_id, token_expires_at").eq("company_id", companyId).maybeSingle();
  if (!conn) return json({ error: "Not connected" }, 400);
  if (new Date(conn.token_expires_at).getTime() < Date.now() + 60_000) return json({ error: "Token expiring — try again after the next sync" }, 409);

  const results = [];
  for (const r of requests) {
    const method = String(r.method || "").toUpperCase();
    if (!["GET", "PUT", "POST"].includes(method) || !ALLOWED.test(String(r.path || ""))) { results.push({ path: r.path, error: "not allowed" }); continue; }
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${r.path}`, {
      method,
      headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, "Content-Type": "application/json", Accept: "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(r.body ?? {}),
    });
    const text = await res.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep text */ }
    results.push({ path: r.path, status: res.status, data });
  }
  return json({ results });
});
