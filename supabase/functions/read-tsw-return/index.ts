// read-tsw-return — reads one screenshot of a TSW excise entry and returns
// the figures on it as structured data, for the Excise self-audit.
//
// Needs one secret set in Supabase → Edge Functions → Secrets:
//   ANTHROPIC_API_KEY
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.
//
// Only signed-in Brewpoint users can call it: the caller's login is
// checked here on the server, never trusted from the request body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROMPT = `This is a screenshot from New Zealand Customs' Trade Single Window (TSW), showing an excise entry or return for alcohol.

Read the figures exactly as shown. Do not calculate, estimate or correct anything. If a value isn't visible, use null.

Reply with only this JSON, no other text:
{
  "isTswExcise": true or false (false if this clearly isn't a TSW excise entry),
  "period": "YYYY-MM" — the month the return covers. Use the stated period if shown; otherwise null,
  "entryNumber": the entry / declaration / reference number as shown, or null,
  "filedDate": "YYYY-MM-DD" lodgement or submitted date if shown, or null,
  "lines": [
    {
      "description": goods description text,
      "itemCode": excise item / tariff number as shown, or null,
      "litres": supplementary quantity in litres (L) as a number, or null,
      "lal": statistical quantity in litres of pure alcohol (LAL) as a number, or null,
      "abv": percentage volume of alcohol as a number, or null,
      "duty": excise duty in dollars for this line as a number, or null
    }
  ],
  "totalDuty": total excise duty in dollars if a total is shown, or null,
  "notes": one short sentence on anything unclear, cut off, or hard to read — or null
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!.trim(), Deno.env.get("SUPABASE_ANON_KEY")!.trim(), {
    global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
  });
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return json({ error: "Please sign in again." }, 401);

  // Trim spaces and any quote marks pasted in along with the key.
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!apiKey) return json({ error: "Screenshot reading isn't set up yet (missing ANTHROPIC_API_KEY)." }, 500);

  let image = "";
  let mediaType = "image/jpeg";
  try {
    const body = await req.json();
    image = String(body.image || "");
    if (body.mediaType) mediaType = String(body.mediaType);
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  if (!image) return json({ error: "No image sent." }, 400);
  if (image.length > 7_000_000) return json({ error: "That image is too large — try a smaller screenshot." }, 413);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("Anthropic API error", res.status, detail);
    if (res.status === 401 || res.status === 403) {
      return json({ error: "The Anthropic API key is wrong or has been revoked — update ANTHROPIC_API_KEY in Supabase → Edge Functions → Secrets." }, 502);
    }
    if (res.status === 400 && /credit balance/i.test(detail)) {
      return json({ error: "The Anthropic account is out of credit — top it up at console.anthropic.com." }, 502);
    }
    return json({ error: "Couldn't read the screenshot right now — try again in a minute." }, 502);
  }

  const data = await res.json();
  const text = (data.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return json({ error: "Couldn't find any figures in that screenshot." }, 422);

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(String(v).replace(/[$,\s]/g, ""))) ? null : Number(String(v).replace(/[$,\s]/g, "")));
    const period = typeof parsed.period === "string" && /^\d{4}-\d{2}$/.test(parsed.period) ? parsed.period : null;
    const filedDate = typeof parsed.filedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.filedDate) ? parsed.filedDate : null;
    return json({
      isTswExcise: parsed.isTswExcise !== false,
      period,
      entryNumber: parsed.entryNumber ? String(parsed.entryNumber) : null,
      filedDate,
      lines: Array.isArray(parsed.lines)
        ? parsed.lines.map((l: Record<string, unknown>) => ({
            description: l.description ? String(l.description) : "",
            itemCode: l.itemCode ? String(l.itemCode).replace(/[.\s]/g, "") : null,
            litres: num(l.litres),
            lal: num(l.lal),
            abv: num(l.abv),
            duty: num(l.duty),
          }))
        : [],
      totalDuty: num(parsed.totalDuty),
      notes: parsed.notes ? String(parsed.notes) : null,
    });
  } catch {
    return json({ error: "Couldn't make sense of the figures in that screenshot." }, 422);
  }
});
