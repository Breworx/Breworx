// Supabase Edge Function: xero-keepalive
//
// Xero refresh tokens expire if they aren't used for 60 days, which
// disconnects a brewery that hasn't opened Brewpoint's Xero features in a
// while. A weekly database job (pg_cron + pg_net) calls this to refresh every
// connection, so the link stays alive on its own.
//
// Not called from the app. The caller must send the shared secret kept in
// the database vault ("xero_keepalive_secret") as the x-keepalive-secret
// header; the function reads the same secret through get_xero_keepalive_secret(),
// which only the service role can run.
//
// Uses XERO_CLIENT_ID and XERO_CLIENT_SECRET, like xero-api.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const { data: secret, error: secretError } = await supabase.rpc("get_xero_keepalive_secret");
  const given = req.headers.get("x-keepalive-secret") || "";
  if (secretError || !secret || given !== secret) return json({ error: "Not allowed" }, 401);

  const clientId = (Deno.env.get("XERO_CLIENT_ID") || "").trim();
  const clientSecret = (Deno.env.get("XERO_CLIENT_SECRET") || "").trim();
  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const { data: conns, error } = await supabase.from("xero_connections").select("company_id, refresh_token");
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const conn of conns || []) {
    try {
      const res = await fetch("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
      });
      const t = await res.json();
      if (!res.ok) {
        // Already expired or revoked: only reconnecting in Settings fixes it.
        await supabase.from("xero_connections").update({ keepalive_failed_at: new Date().toISOString() }).eq("company_id", conn.company_id);
        results.push({ company: conn.company_id, ok: false });
        continue;
      }
      await supabase.from("xero_connections").update({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        last_keepalive_at: new Date().toISOString(),
        keepalive_failed_at: null,
      }).eq("company_id", conn.company_id);
      results.push({ company: conn.company_id, ok: true });
    } catch (_e) {
      results.push({ company: conn.company_id, ok: false });
    }
  }
  return json({ refreshed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});
