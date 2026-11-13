// Supabase Edge Function: send-invite-email
//
// Emails a team invite straight to the person, through Resend. The owner
// creates the invite in the app (create_company_invite, with their email
// and role); the app then calls this with the invite's token and link.
// Comes from the address in the vault ("invite_from_email"), shown as the
// brewery's name, with replies going to the owner who sent it.
//
// Answers { sent: true }, or { error: "not_configured" } when there's no
// Resend key yet (the app then opens the email app instead).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await supabase.auth.getUser(token);
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await supabase.from("profiles").select("company_id, role, name").eq("id", u.user.id).maybeSingle();
    if (!me || me.role !== "owner") return json({ error: "Only the account owner can send invites." }, 403);

    const body = await req.json().catch(() => ({}));
    const inviteToken = String(body.token || "");
    const link = String(body.link || "");
    if (!inviteToken || !link.includes(`invite=${inviteToken}`) || !/^https:\/\//.test(link)) return json({ error: "Missing invite" }, 400);
    const { data: invite } = await supabase.from("company_invites").select("email, role, used_at, company_id").eq("token", inviteToken).maybeSingle();
    if (!invite || invite.company_id !== me.company_id) return json({ error: "Invite not found" }, 404);
    if (invite.used_at) return json({ error: "That invite has already been used." }, 400);
    if (!invite.email) return json({ error: "The invite has no email address." }, 400);

    const { data: key } = await supabase.rpc("get_email_setting", { p_name: "resend_api_key" });
    const { data: fromAddr } = await supabase.rpc("get_email_setting", { p_name: "invite_from_email" });
    if (!key || !fromAddr) return json({ error: "not_configured" });

    const { data: company } = await supabase.from("companies").select("name").eq("id", me.company_id).maybeSingle();
    const companyName = company?.name || "our brewery";
    const what = invite.role === "sales"
      ? "You'll be able to see finished stock, what's in the tanks, the production calendar and Upstock orders with back orders."
      : "You'll be part of the team in Brewpoint, the app we run the brewery on.";
    const subject = `Join ${companyName} on Brewpoint`;
    const text = `Hi,\n\n${me.name || "We"} invited you to join ${companyName} on Brewpoint. ${what}\n\nSet up your login here (the link works once, just for you):\n${link}\n\nThanks,\n${me.name || companyName}`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#2A3324">
<h2 style="font-weight:500;margin:0 0 12px">Join ${esc(companyName)} on Brewpoint</h2>
<p style="line-height:1.5">${esc(me.name || "We")} invited you to join ${esc(companyName)}. ${esc(what)}</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#5C9A3C;color:#16191A;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Set up my login</a></p>
<p style="font-size:13px;color:#5C6B54;line-height:1.5">The link works once, just for you. If the button doesn't work, copy this into your browser:<br>${esc(link)}</p>
</div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${companyName} via Brewpoint <${String(fromAddr).replace(/.*<|>.*/g, "").trim()}>`,
        to: [invite.email],
        reply_to: u.user.email || undefined,
        subject,
        text,
        html,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: out?.message || "The email service didn't accept it." }, 502);
    return json({ sent: true, id: out.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
