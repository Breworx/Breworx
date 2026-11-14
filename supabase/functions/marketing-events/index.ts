// Supabase Edge Function: marketing-events (public, no login)
//
//  • GET  ?u=<token>  → the unsubscribe page ("Unsubscribe me" button)
//  • POST ?u=<token>  → unsubscribes (the button, and email apps'
//                       one-click List-Unsubscribe-Post)
//  • POST (Resend webhook, signed with RESEND_WEBHOOK_SECRET) → records
//    delivered / opened / clicked / bounced / complained on each send.
import { createClient } from "npm:@supabase/supabase-js@2";

const html = (body: string, s = 200) =>
  new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title></head><body style="margin:0;background:#F4F2EC;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#2A3324"><div style="max-width:440px;margin:60px auto;background:#fff;border-radius:10px;padding:32px 28px;text-align:center">${body}</div></body></html>`, { status: s, headers: { "Content-Type": "text/html; charset=utf-8" } });
const esc = (s: string) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function b64ToBytes(b64: string) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function bytesToB64(bytes: ArrayBuffer) { let s = ""; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }

async function verifySvix(req: Request, raw: string, secret: string) {
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp"), sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false;
  const keyBytes = b64ToBytes(secret.replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = bytesToB64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  return sig.split(" ").some((p) => p.split(",")[1] === mac);
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const url = new URL(req.url);
  const token = url.searchParams.get("u");

  if (token) {
    if (token === "test") return html(`<h2 style="font-weight:600">This was a test email</h2><p>The unsubscribe link works — real emails use each person's own link.</p>`);
    const { data: c } = await supabase.from("marketing_contacts").select("email, status, company_id").eq("unsub_token", token).maybeSingle();
    if (!c) return html(`<h2 style="font-weight:600">Link not recognised</h2><p>This unsubscribe link doesn't match any list.</p>`, 404);
    const { data: co } = await supabase.from("companies").select("name").eq("id", c.company_id).maybeSingle();
    const name = co?.name || "us";
    if (req.method === "POST") {
      await supabase.rpc("marketing_unsubscribe", { p_token: token });
      return html(`<h2 style="font-weight:600">You're unsubscribed</h2><p style="line-height:1.5">${esc(c.email)} won't get any more marketing emails from ${esc(name)}.</p>`);
    }
    if (c.status !== "subscribed") return html(`<h2 style="font-weight:600">Already unsubscribed</h2><p>${esc(c.email)} isn't on the list.</p>`);
    return html(`<h2 style="font-weight:600">Unsubscribe?</h2><p style="line-height:1.5">Stop marketing emails from ${esc(name)} to <b>${esc(c.email)}</b>.</p><form method="post"><button style="margin-top:12px;background:#2A3324;color:#fff;border:0;border-radius:6px;padding:12px 22px;font-size:15px;cursor:pointer">Unsubscribe me</button></form>`);
  }

  if (req.method !== "POST") return new Response("ok");
  const raw = await req.text();
  const secret = (Deno.env.get("RESEND_WEBHOOK_SECRET") || "").trim();
  if (!secret || !(await verifySvix(req, raw, secret))) return new Response("bad signature", { status: 401 });
  const ev = JSON.parse(raw || "{}");
  const id = ev?.data?.email_id;
  if (!id) return new Response("ok");
  const { data: s } = await supabase.from("marketing_sends").select("*").eq("provider_id", id).maybeSingle();
  if (!s) return new Response("ok");
  const at = ev.created_at || new Date().toISOString();
  const rank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, bounced: 5, complained: 6, failed: 5, skipped: 0 };
  const upd: Record<string, unknown> = {};
  const bump = (st: string) => { if ((rank[st] ?? 0) > (rank[s.status] ?? 0)) upd.status = st; };
  switch (ev.type) {
    case "email.delivered": upd.delivered_at = s.delivered_at || at; bump("delivered"); break;
    case "email.opened": upd.opened_at = s.opened_at || at; upd.open_count = (s.open_count || 0) + 1; bump("opened");
      await supabase.from("marketing_contacts").update({ last_opened_at: at }).eq("id", s.contact_id); break;
    case "email.clicked": upd.clicked_at = s.clicked_at || at; upd.click_count = (s.click_count || 0) + 1; if (!s.opened_at) upd.opened_at = at; bump("clicked");
      await supabase.from("marketing_contacts").update({ last_clicked_at: at }).eq("id", s.contact_id); break;
    case "email.bounced": upd.bounced_at = at; bump("bounced");
      if (ev?.data?.bounce?.type !== "Transient") await supabase.from("marketing_contacts").update({ status: "bounced" }).eq("id", s.contact_id); break;
    case "email.complained": bump("complained");
      await supabase.from("marketing_contacts").update({ status: "complained", unsubscribed_at: at }).eq("id", s.contact_id); break;
    default: break;
  }
  if (Object.keys(upd).length) await supabase.from("marketing_sends").update(upd).eq("id", s.id);
  return new Response("ok");
});
