// Supabase Edge Function: xero-webhook
//
// Xero calls this the moment an invoice or credit note changes. It checks
// the message really came from Xero (HMAC-SHA256 of the raw body with the
// app's webhook key, kept in the vault as xero_webhook_key), answers within Xero's 5 seconds,
// then runs xero-sync for each Xero organisation in the message. The
// every-2-minute check (run_xero_sync) stays on as a backup.
//
// Xero's "Intent to receive" test sends one correctly signed and some
// wrongly signed messages: signed ones get 200, the rest 401.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const enc = new TextEncoder();

async function signatureOk(supabase, raw: string, given: string) {
  // Kept in the database vault ("xero_webhook_key"), read by the service role.
  const { data } = await supabase.rpc("get_xero_webhook_key");
  const key = String(data || Deno.env.get("XERO_WEBHOOK_KEY") || "").trim();
  if (!key || !given) return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(raw)));
  const expected = btoa(String.fromCharCode(...sig));
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("", { status: 405 });
  const raw = await req.text();
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  if (!(await signatureOk(supabase, raw, req.headers.get("x-xero-signature") || ""))) return new Response("", { status: 401 });

  let tenants: string[] = [];
  try {
    const body = JSON.parse(raw);
    tenants = [...new Set((body.events || []).filter((e) => /INVOICE|CREDIT/.test(String(e.eventCategory || "").toUpperCase())).map((e) => String(e.tenantId)))];
  } catch (_e) {
    tenants = [];
  }

  if (tenants.length) {
    const work = (async () => {
      const { data: secret } = await supabase.rpc("get_xero_keepalive_secret");
      if (!secret) return;
      // A few seconds' pause lets Xero finish saving a batch of changes first.
      await new Promise((r) => setTimeout(r, 3000));
      const run = (tenantId) =>
        fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/xero-sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-keepalive-secret": secret },
          body: JSON.stringify({ tenantId }),
        }).then((r) => r.json()).catch(() => ({}));
      for (const tenantId of tenants) {
        const out = await run(tenantId);
        // The 2-minute check was mid-run: try again once it's finished.
        if ((out.results || []).some((r) => r.skipped === "already running")) {
          await new Promise((r) => setTimeout(r, 20000));
          await run(tenantId);
        }
      }
    })();
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  }
  return new Response("", { status: 200 });
});
