// Supabase Edge Function: marketing-send
//
// The engine behind Brewpoint's Marketing section. Two ways in:
//  • From the app (signed-in user's JWT): status, test, queue, cancel.
//  • From pg_cron every 5 minutes (x-keepalive-secret): "tick" — queues
//    campaigns whose scheduled time has come, decides A/B tests, runs the
//    automations, then sends what's queued up to today's daily limit.
//
// Emails go out through Resend (RESEND_API_KEY edge secret, or the
// resend_api_key vault secret). Every email gets the contact's own
// unsubscribe link plus List-Unsubscribe headers for one-click unsubscribe.
import { createClient } from "npm:@supabase/supabase-js@2";
import { renderEmail } from "./marketingEmail.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-keepalive-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const EVENTS_URL = `${SUPABASE_URL}/functions/v1/marketing-events`;
const NZ = "Pacific/Auckland";

type Any = Record<string, any>;

async function resendKey(supabase: Any) {
  const env = (Deno.env.get("RESEND_API_KEY") || "").trim();
  if (env) return env;
  const { data } = await supabase.rpc("get_email_setting", { p_name: "resend_api_key" });
  return (data || "").trim();
}

function nzDayStartIso() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: NZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  // midnight NZ expressed in UTC: find the offset by formatting
  const probe = new Date(`${parts}T00:00:00Z`);
  const offsetMin = (new Date(probe.toLocaleString("en-US", { timeZone: NZ })).getTime() - new Date(probe.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60000;
  return new Date(probe.getTime() - offsetMin * 60000).toISOString();
}

async function settingsFor(supabase: Any, companyId: string) {
  const { data: s } = await supabase.from("marketing_settings").select("*").eq("company_id", companyId).maybeSingle();
  const { data: co } = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  return { ...(s || {}), company_name: co?.name || "", daily_limit: s?.daily_limit ?? 100 };
}

function fromHeader(settings: Any, brand: string) {
  const addr = String(settings.from_email || "").replace(/.*<|>.*/g, "").trim();
  const name = (brand === "four-seasons" ? "Four Seasons Cider Co" : settings.from_name || settings.company_name || "Double Cone Brewing").replace(/[<>"]/g, "");
  return addr ? `${name} <${addr}>` : "";
}

function buildEmail(content: Any, settings: Any, contact: Any, subjectOverride?: string) {
  const unsubscribeUrl = `${EVENTS_URL}?u=${contact.unsub_token}`;
  const r = renderEmail({
    brand: content.brand, theme: content.theme, subject: subjectOverride ?? content.subject, preheader: content.preheader,
    blocks: content.blocks || [], settings, contact, unsubscribeUrl,
  });
  return {
    from: fromHeader(settings, content.brand),
    to: [contact.email],
    reply_to: settings.reply_to || undefined,
    subject: r.subject,
    html: r.html,
    text: r.text,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

// ── Audience → queued sends ────────────────────────────────────────────────
async function audienceIds(supabase: Any, companyId: string, audience: Any) {
  const { data, error } = await supabase.rpc("marketing_audience_ids", { p_audience: audience || {}, p_company: companyId });
  if (error) throw new Error(error.message);
  return (data || []).map((r: Any) => r.contact_id);
}

function shuffle<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function insertSends(supabase: Any, rows: Any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("marketing_sends").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

async function queueCampaign(supabase: Any, campaign: Any) {
  const ids: string[] = await audienceIds(supabase, campaign.company_id, campaign.audience);
  // never send the same campaign twice to someone
  const { data: already } = await supabase.from("marketing_sends").select("contact_id").eq("campaign_id", campaign.id);
  const done = new Set((already || []).map((r: Any) => r.contact_id));
  const todo = shuffle(ids.filter((id) => !done.has(id)));
  if (todo.length === 0) {
    await supabase.from("marketing_campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", campaign.id);
    return { queued: 0 };
  }
  const { data: contacts } = await supabase.from("marketing_contacts").select("id, email").in("id", todo.slice(0, 5000));
  const emailOf = new Map((contacts || []).map((c: Any) => [c.id, c.email]));
  const abOn = campaign.subject_b && campaign.ab_percent && campaign.ab_percent > 0 && !campaign.ab_winner && todo.length >= 10;
  let rows: Any[];
  let status = "sending";
  if (abOn) {
    const testN = Math.max(2, Math.round((todo.length * Math.min(campaign.ab_percent, 100)) / 100));
    const test = todo.slice(0, testN);
    rows = test.map((id, i) => ({ company_id: campaign.company_id, campaign_id: campaign.id, contact_id: id, email: emailOf.get(id), variant: i % 2 === 0 ? "A" : "B" }));
    status = testN >= todo.length ? "sending" : "testing";
  } else {
    const variant = campaign.ab_winner || (campaign.subject_b ? "A" : null);
    rows = todo.map((id) => ({ company_id: campaign.company_id, campaign_id: campaign.id, contact_id: id, email: emailOf.get(id), variant }));
  }
  rows = rows.filter((r) => r.email);
  await insertSends(supabase, rows);
  await supabase.from("marketing_campaigns").update({
    status, ...(status === "testing" ? { ab_test_started_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString(),
  }).eq("id", campaign.id);
  return { queued: rows.length, testing: status === "testing" };
}

async function decideAbTests(supabase: Any) {
  const { data: tests } = await supabase.from("marketing_campaigns").select("*").eq("status", "testing");
  for (const c of tests || []) {
    const started = c.ab_test_started_at ? new Date(c.ab_test_started_at).getTime() : 0;
    if (Date.now() - started < (c.ab_wait_hours || 4) * 3600_000) continue;
    const { data: sends } = await supabase.from("marketing_sends").select("variant, status, opened_at, clicked_at").eq("campaign_id", c.id);
    const stat = (v: string) => {
      const s = (sends || []).filter((x: Any) => x.variant === v && x.status !== "queued");
      const opened = s.filter((x: Any) => x.opened_at || x.clicked_at).length;
      return s.length ? opened / s.length : 0;
    };
    if ((sends || []).some((x: Any) => x.status === "queued")) continue; // test group not fully out yet
    const winner = stat("B") > stat("A") ? "B" : "A";
    await supabase.from("marketing_campaigns").update({ ab_winner: winner, ab_decided_at: new Date().toISOString(), status: "sending" }).eq("id", c.id);
    await queueCampaign(supabase, { ...c, ab_winner: winner });
  }
}

async function queueDueCampaigns(supabase: Any) {
  const { data: due } = await supabase.from("marketing_campaigns").select("*").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString());
  for (const c of due || []) await queueCampaign(supabase, c);
}

// ── Automations ────────────────────────────────────────────────────────────
async function runAutomations(supabase: Any) {
  const { data: autos } = await supabase.from("marketing_automations").select("*").eq("active", true);
  for (const a of autos || []) {
    if (a.last_run_at && Date.now() - new Date(a.last_run_at).getTime() < 55 * 60_000) continue;
    const p = a.params || {};
    const cooldownSince = new Date(Date.now() - (a.cooldown_days || 30) * 86400_000).toISOString();
    const { data: prior } = await supabase.from("marketing_sends").select("contact_id, queued_at").eq("automation_id", a.id);
    const everSent = new Set((prior || []).map((r: Any) => r.contact_id));
    const recentSent = new Set((prior || []).filter((r: Any) => r.queued_at >= cooldownSince).map((r: Any) => r.contact_id));
    let candidateIds: string[] = [];
    const base = { lists: p.lists || [], tags: p.tags || [] };
    if (a.trigger === "welcome") {
      const since = new Date(Date.now() - (p.within_days || 3) * 86400_000).toISOString();
      const ids = await audienceIds(supabase, a.company_id, base);
      const { data: fresh } = await supabase.from("marketing_contacts").select("id").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).gte("created_at", since);
      candidateIds = (fresh || []).map((r: Any) => r.id).filter((id: string) => !everSent.has(id));
    } else if (a.trigger === "tag_added") {
      if (!p.tag) continue;
      candidateIds = (await audienceIds(supabase, a.company_id, { ...base, tags: [p.tag] })).filter((id: string) => !everSent.has(id));
    } else if (a.trigger === "no_order") {
      candidateIds = (await audienceIds(supabase, a.company_id, { ...base, not_ordered_days: p.days || 42 })).filter((id: string) => !recentSent.has(id));
    } else if (a.trigger === "first_order") {
      const ids = await audienceIds(supabase, a.company_id, { ...base, ordered_within_days: p.within_days || 3 });
      if (ids.length) {
        const { data: cs } = await supabase.from("marketing_contacts").select("id, customer_id").in("id", ids);
        for (const c of cs || []) {
          if (everSent.has(c.id) || !c.customer_id) continue;
          const { count } = await supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("customer_id", c.customer_id).neq("status", "Cancelled");
          if ((count || 0) === 1) candidateIds.push(c.id);
        }
      }
    }
    if (candidateIds.length) {
      const { data: cs } = await supabase.from("marketing_contacts").select("id, email").in("id", candidateIds);
      await insertSends(supabase, (cs || []).map((c: Any) => ({ company_id: a.company_id, automation_id: a.id, contact_id: c.id, email: c.email })));
    }
    await supabase.from("marketing_automations").update({ last_run_at: new Date().toISOString() }).eq("id", a.id);
  }
}

// ── Sending the queue ─────────────────────────────────────────────────────
async function processQueue(supabase: Any, key: string) {
  const { data: companies } = await supabase.from("marketing_sends").select("company_id").eq("status", "queued").limit(1000);
  const ids = [...new Set((companies || []).map((r: Any) => r.company_id))];
  const dayStart = nzDayStartIso();
  const report: Any[] = [];
  for (const companyId of ids) {
    const settings = await settingsFor(supabase, companyId as string);
    if (!settings.from_email) { report.push({ companyId, skipped: "no from address" }); continue; }
    const { count: sentToday } = await supabase.from("marketing_sends").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("sent_at", dayStart);
    let room = Math.max(0, (settings.daily_limit || 100) - (sentToday || 0));
    if (room === 0) { report.push({ companyId, skipped: "daily limit reached" }); continue; }
    const { data: queued } = await supabase.from("marketing_sends").select("*").eq("company_id", companyId).eq("status", "queued").order("queued_at").limit(Math.min(room, 400));
    const campaignIds = [...new Set((queued || []).map((q: Any) => q.campaign_id).filter(Boolean))];
    const autoIds = [...new Set((queued || []).map((q: Any) => q.automation_id).filter(Boolean))];
    const { data: camps } = campaignIds.length ? await supabase.from("marketing_campaigns").select("*").in("id", campaignIds) : { data: [] };
    const { data: autos } = autoIds.length ? await supabase.from("marketing_automations").select("*").in("id", autoIds) : { data: [] };
    const contentOf = (q: Any) => (q.campaign_id ? (camps || []).find((c: Any) => c.id === q.campaign_id) : (autos || []).find((a: Any) => a.id === q.automation_id));
    const { data: contacts } = await supabase.from("marketing_contacts").select("*").in("id", (queued || []).map((q: Any) => q.contact_id));
    const contactOf = new Map((contacts || []).map((c: Any) => [c.id, c]));
    const ready: Any[] = [];
    for (const q of queued || []) {
      const c = contactOf.get(q.contact_id);
      const content = contentOf(q);
      if (!c || c.status !== "subscribed" || !content || content.status === "cancelled") {
        await supabase.from("marketing_sends").update({ status: "skipped", error: !c ? "contact gone" : c.status !== "subscribed" ? `contact ${c.status}` : "email cancelled" }).eq("id", q.id);
        continue;
      }
      ready.push({ q, email: buildEmail(content, settings, c, q.variant === "B" ? content.subject_b : undefined) });
    }
    let sent = 0;
    for (let i = 0; i < ready.length; i += 100) {
      const chunk = ready.slice(i, i + 100);
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map((r) => r.email)),
      });
      const out = await res.json().catch(() => ({}));
      const now = new Date().toISOString();
      if (!res.ok) {
        const msg = out?.message || `Resend ${res.status}`;
        // rate/daily limits: leave queued and try next tick; anything else marks failed
        if (res.status === 429) { report.push({ companyId, paused: msg }); break; }
        for (const r of chunk) await supabase.from("marketing_sends").update({ status: "failed", error: msg }).eq("id", r.q.id);
        continue;
      }
      const idsOut = out?.data || [];
      for (let k = 0; k < chunk.length; k++) {
        await supabase.from("marketing_sends").update({ status: "sent", sent_at: now, provider_id: idsOut[k]?.id || null }).eq("id", chunk[k].q.id);
      }
      await supabase.from("marketing_contacts").update({ last_sent_at: now }).in("id", chunk.map((r) => r.q.contact_id));
      sent += chunk.length;
    }
    report.push({ companyId, sent });
  }
  // campaigns with nothing left to send are done
  const { data: sending } = await supabase.from("marketing_campaigns").select("id").eq("status", "sending");
  for (const c of sending || []) {
    const { count } = await supabase.from("marketing_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
    if ((count || 0) === 0) await supabase.from("marketing_campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", c.id);
  }
  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // Cron
    const given = req.headers.get("x-keepalive-secret") || "";
    if (given) {
      const { data: secret } = await supabase.rpc("get_xero_keepalive_secret");
      if (!secret || given !== secret) return json({ error: "Not allowed" }, 401);
      const key = await resendKey(supabase);
      await queueDueCampaigns(supabase);
      await decideAbTests(supabase);
      await runAutomations(supabase);
      const report = key ? await processQueue(supabase, key) : [{ skipped: "no Resend key" }];
      return json({ ok: true, report });
    }

    // From the app
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await supabase.auth.getUser(token);
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await supabase.from("profiles").select("company_id, name").eq("id", u.user.id).maybeSingle();
    if (!me?.company_id) return json({ error: "No company" }, 400);
    const companyId = me.company_id;
    const key = await resendKey(supabase);
    const settings = await settingsFor(supabase, companyId);

    if (action === "status") {
      let domain: Any = null;
      if (key) {
        const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
        const d = await r.json().catch(() => ({}));
        const want = String(settings.from_email || "").split("@")[1]?.toLowerCase();
        const list = d?.data || [];
        domain = list.find((x: Any) => x.name?.toLowerCase() === want) || list[0] || null;
        if (domain) domain = { name: domain.name, status: domain.status };
      }
      const { count: sentToday } = await supabase.from("marketing_sends").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("sent_at", nzDayStartIso());
      const { count: queued } = await supabase.from("marketing_sends").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "queued");
      return json({ hasKey: !!key, domain, fromEmail: settings.from_email || null, dailyLimit: settings.daily_limit, sentToday: sentToday || 0, queued: queued || 0 });
    }

    if (action === "test") {
      if (!key) return json({ error: "Email sending isn't connected yet (no Resend key)." }, 400);
      if (!settings.from_email) return json({ error: "Set a 'From' email address in Marketing settings first." }, 400);
      const to = String(body.to || settings.test_email || u.user.email || "").trim();
      if (!to.includes("@")) return json({ error: "No address to send the test to." }, 400);
      const content = body.content || {};
      const fake = { email: to, first_name: (me.name || "").split(" ")[0] || "there", company_name: "Test Venue", unsub_token: "test" };
      const email = buildEmail(content, settings, fake, body.variant === "B" ? content.subject_b : undefined);
      email.subject = `[TEST] ${email.subject}`;
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(email) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: out?.message || "The email service didn't accept it." }, 400);
      return json({ sent: true, to });
    }

    if (action === "queue") {
      const { data: c } = await supabase.from("marketing_campaigns").select("*").eq("id", body.campaignId).eq("company_id", companyId).maybeSingle();
      if (!c) return json({ error: "Email not found" }, 404);
      if (!c.subject) return json({ error: "Add a subject line first." }, 400);
      if (!settings.from_email) return json({ error: "Set a 'From' email address in Marketing settings first." }, 400);
      if (c.scheduled_at && new Date(c.scheduled_at).getTime() > Date.now() + 60_000) {
        await supabase.from("marketing_campaigns").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("id", c.id);
        return json({ scheduled: true, at: c.scheduled_at });
      }
      const r = await queueCampaign(supabase, c);
      const report = key ? await processQueue(supabase, key) : [];
      return json({ ...r, report });
    }

    if (action === "cancel") {
      const { data: c } = await supabase.from("marketing_campaigns").select("id, status").eq("id", body.campaignId).eq("company_id", companyId).maybeSingle();
      if (!c) return json({ error: "Email not found" }, 404);
      const { count } = await supabase.from("marketing_sends").delete({ count: "exact" }).eq("campaign_id", c.id).eq("status", "queued");
      const { count: out } = await supabase.from("marketing_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id);
      await supabase.from("marketing_campaigns").update({ status: (out || 0) > 0 ? "sent" : "draft", updated_at: new Date().toISOString() }).eq("id", c.id);
      return json({ cancelled: count || 0 });
    }

    if (action === "audienceCount") {
      const ids = await audienceIds(supabase, companyId, body.audience || {});
      return json({ count: ids.length });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
