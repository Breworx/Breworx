// Marketing email renderer — shared by the app (live preview) and the
// marketing-send edge function (what actually goes out), so what you see is
// what people get. Plain ES module with no imports: the edge function loads
// this exact file.
//
// An email is a brand + a theme + a list of blocks:
//   { type: "hero", image, link }
//   { type: "heading", text, size: "xl"|"lg"|"md" }
//   { type: "text", text }                 // blank line = new paragraph, **bold**, links auto
//   { type: "image", image, alt, link, caption }
//   { type: "images2", left, right, leftLink, rightLink }
//   { type: "button", label, url }
//   { type: "beer", name, style, abv, description, image, tag, url }
//   { type: "callout", text, emoji }
//   { type: "divider" } | { type: "spacer" }
//   { type: "social", instagram, facebook, website }
// Merge tags anywhere in text: {{first_name}}, {{company}}, {{first_name|there}}.

export const BRANDS = {
  "double-cone": { name: "Double Cone Brewing", short: "Double Cone", ink: "#2A3324", accent: "#5C9A3C", soft: "#EEF3E6" },
  "four-seasons": { name: "Four Seasons Cider Co", short: "Four Seasons", ink: "#3D2A1F", accent: "#C77D2E", soft: "#F7EEE3" },
};

export const THEMES = {
  classic: { label: "Classic", page: "#F4F2EC", card: "#FFFFFF", headFont: "Georgia, 'Times New Roman', serif" },
  bold: { label: "Bold", page: "accent", card: "#FFFFFF", headFont: "'Arial Black', 'Helvetica Neue', Arial, sans-serif" },
  fun: { label: "Fun", page: "soft", card: "#FFFFFF", headFont: "'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif", rounded: true },
  dark: { label: "Dark", page: "#16191A", card: "#202426", headFont: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", dark: true },
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const safeUrl = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return "";
};

export function mergeTags(text, contact) {
  const c = contact || {};
  const vals = { first_name: c.first_name || c.firstName || "", last_name: c.last_name || c.lastName || "", company: c.company_name || c.companyName || "", email: c.email || "" };
  return String(text ?? "").replace(/\{\{\s*(\w+)\s*(?:\|\s*([^}]*))?\}\}/g, (_, k, fb) => (vals[k] && String(vals[k]).trim()) || (fb ?? "").trim());
}

function inline(text, color) {
  let h = esc(text);
  h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(])((https?:\/\/|www\.)[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${esc(safeUrl(url))}" style="color:${color};text-decoration:underline">${url}</a>`);
  return h.replace(/\n/g, "<br>");
}

function paletteFor(brandKey, themeKey) {
  const brand = BRANDS[brandKey] || BRANDS["double-cone"];
  const theme = THEMES[themeKey] || THEMES.classic;
  const page = theme.page === "accent" ? brand.accent : theme.page === "soft" ? brand.soft : theme.page;
  const text = theme.dark ? "#ECEFE6" : brand.ink;
  const muted = theme.dark ? "#9BA88A" : "#6B7563";
  return { brand, theme, page, text, muted, card: theme.card, radius: theme.rounded ? 18 : 6 };
}

function renderBlock(b, p, contact) {
  const t = (s) => mergeTags(s, contact);
  const pad = "padding:0 32px";
  switch (b.type) {
    case "hero": {
      if (!b.image) return "";
      const img = `<img src="${esc(b.image)}" alt="${esc(t(b.alt || ""))}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;${p.theme.rounded ? `border-radius:${p.radius}px ${p.radius}px 0 0;` : ""}">`;
      const u = safeUrl(b.link);
      return `<tr><td style="padding:0">${u ? `<a href="${esc(u)}">${img}</a>` : img}</td></tr>`;
    }
    case "heading": {
      const size = b.size === "xl" ? 34 : b.size === "md" ? 20 : 26;
      return `<tr><td style="${pad};padding-top:22px"><h1 style="margin:0;font-family:${p.theme.headFont};font-size:${size}px;line-height:1.2;color:${p.text};font-weight:700">${inline(t(b.text), p.brand.accent)}</h1></td></tr>`;
    }
    case "text": {
      const paras = String(t(b.text) || "").split(/\n\s*\n/).filter((x) => x.trim());
      return `<tr><td style="${pad};padding-top:14px">${paras.map((x) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:${p.text}">${inline(x.trim(), p.brand.accent)}</p>`).join("")}</td></tr>`;
    }
    case "image": {
      if (!b.image) return "";
      const img = `<img src="${esc(b.image)}" alt="${esc(t(b.alt || ""))}" width="536" style="display:block;width:100%;height:auto;border:0;border-radius:${p.radius}px">`;
      const u = safeUrl(b.link);
      return `<tr><td style="${pad};padding-top:18px">${u ? `<a href="${esc(u)}">${img}</a>` : img}${b.caption ? `<div style="font-size:13px;color:${p.muted};padding-top:6px;text-align:center">${inline(t(b.caption), p.brand.accent)}</div>` : ""}</td></tr>`;
    }
    case "images2": {
      const cell = (src, link) => {
        if (!src) return "";
        const img = `<img src="${esc(src)}" width="260" style="display:block;width:100%;height:auto;border:0;border-radius:${p.radius}px">`;
        const u = safeUrl(link);
        return u ? `<a href="${esc(u)}">${img}</a>` : img;
      };
      return `<tr><td style="${pad};padding-top:18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" style="padding-right:6px;vertical-align:top">${cell(b.left, b.leftLink)}</td><td width="50%" style="padding-left:6px;vertical-align:top">${cell(b.right, b.rightLink)}</td></tr></table></td></tr>`;
    }
    case "button": {
      const u = safeUrl(b.url);
      if (!u || !b.label) return "";
      return `<tr><td align="center" style="${pad};padding-top:20px;padding-bottom:6px"><a href="${esc(u)}" style="display:inline-block;background:${p.brand.accent};color:#FFFFFF;font-weight:700;font-size:16px;text-decoration:none;padding:14px 28px;border-radius:${p.theme.rounded ? 40 : 6}px">${esc(t(b.label))}</a></td></tr>`;
    }
    case "beer": {
      const u = safeUrl(b.url);
      const img = b.image ? `<img src="${esc(b.image)}" width="150" style="display:block;width:150px;max-width:100%;height:auto;border:0;border-radius:${p.radius}px">` : "";
      const meta = [b.style, b.abv ? `${b.abv}% ABV` : ""].filter(Boolean).join(" · ");
      return `<tr><td style="${pad};padding-top:18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.theme.dark ? "#2A2F31" : p.brand.soft};border-radius:${p.radius}px"><tr>
${img ? `<td width="160" style="padding:14px;vertical-align:top">${u ? `<a href="${esc(u)}">${img}</a>` : img}</td>` : ""}
<td style="padding:16px 18px;vertical-align:top">${b.tag ? `<div style="display:inline-block;background:${p.brand.accent};color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:20px;margin-bottom:8px">${esc(t(b.tag))}</div>` : ""}
<div style="font-family:${p.theme.headFont};font-size:21px;font-weight:700;color:${p.text};line-height:1.2">${esc(t(b.name))}</div>
${meta ? `<div style="font-size:13px;color:${p.muted};padding-top:4px">${esc(meta)}</div>` : ""}
${b.description ? `<div style="font-size:15px;line-height:1.5;color:${p.text};padding-top:8px">${inline(t(b.description), p.brand.accent)}</div>` : ""}
</td></tr></table></td></tr>`;
    }
    case "callout":
      return `<tr><td style="${pad};padding-top:18px"><div style="background:${p.brand.accent};color:#FFFFFF;border-radius:${p.radius}px;padding:18px 20px;font-size:17px;line-height:1.5;font-weight:600;text-align:center">${b.emoji ? `<span style="font-size:26px">${esc(b.emoji)}</span><br>` : ""}${inline(t(b.text), "#FFFFFF")}</div></td></tr>`;
    case "divider":
      return `<tr><td style="${pad};padding-top:20px;padding-bottom:4px"><div style="border-top:2px dashed ${p.theme.dark ? "#3A4042" : p.brand.soft === "#EEF3E6" ? "#D5DEC6" : "#E8D6C2"};height:1px;line-height:1px">&nbsp;</div></td></tr>`;
    case "spacer":
      return `<tr><td style="height:20px;line-height:20px">&nbsp;</td></tr>`;
    case "social": {
      const links = [["Instagram", b.instagram], ["Facebook", b.facebook], ["Website", b.website]].map(([l, u]) => [l, safeUrl(u)]).filter(([, u]) => u);
      if (!links.length) return "";
      return `<tr><td align="center" style="${pad};padding-top:20px">${links.map(([l, u]) => `<a href="${esc(u)}" style="display:inline-block;margin:0 6px;padding:8px 14px;border:2px solid ${p.brand.accent};border-radius:${p.theme.rounded ? 40 : 6}px;color:${p.text};font-size:14px;font-weight:600;text-decoration:none">${l}</a>`).join("")}</td></tr>`;
    }
    default:
      return "";
  }
}

function blockText(b, contact) {
  const t = (s) => mergeTags(s, contact);
  switch (b.type) {
    case "heading": return `${t(b.text)}\n`;
    case "text": return `${t(b.text)}\n`;
    case "button": return b.url ? `${t(b.label)}: ${safeUrl(b.url)}\n` : "";
    case "beer": return `${t(b.name)}${b.style ? ` — ${b.style}` : ""}${b.abv ? ` (${b.abv}%)` : ""}\n${t(b.description || "")}\n`;
    case "callout": return `${t(b.text)}\n`;
    case "image": return b.caption ? `${t(b.caption)}\n` : "";
    case "divider": return "—\n";
    default: return "";
  }
}

// settings: { business_address, brand_logos: { "double-cone": url, ... } }
export function renderEmail({ brand = "double-cone", theme = "classic", subject = "", preheader = "", blocks = [], settings = {}, contact = null, unsubscribeUrl = "#" }) {
  const p = paletteFor(brand, theme);
  const logo = (settings.brand_logos || settings.brandLogos || {})[brand];
  const pre = mergeTags(preheader, contact);
  const header = logo
    ? `<tr><td align="center" style="padding:22px 32px 6px"><img src="${esc(logo)}" alt="${esc(p.brand.name)}" height="56" style="height:56px;width:auto;border:0;display:inline-block"></td></tr>`
    : `<tr><td align="center" style="padding:22px 32px 6px;font-family:${p.theme.headFont};font-size:15px;letter-spacing:.14em;text-transform:uppercase;color:${p.muted};font-weight:700">${esc(p.brand.name)}</td></tr>`;
  const hasHeroFirst = blocks[0]?.type === "hero" && !!blocks[0].image;
  const body = blocks.map((b) => renderBlock(b, p, contact)).join("");
  const address = settings.business_address || settings.businessAddress || "";
  const footer = `<tr><td style="padding:26px 32px 28px;font-size:12px;line-height:1.6;color:${p.muted};text-align:center">
You're getting this because you buy from or work with ${esc(p.brand.name)}.<br>
${address ? `${esc(address)}<br>` : ""}<a href="${esc(unsubscribeUrl)}" style="color:${p.muted};text-decoration:underline">Unsubscribe</a></td></tr>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(mergeTags(subject, contact))}</title></head>
<body style="margin:0;padding:0;background:${p.page};font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(pre)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${p.page}"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${p.card};border-radius:${p.radius}px;overflow:hidden">
${hasHeroFirst ? "" : header}${body}
<tr><td style="height:14px;line-height:14px">&nbsp;</td></tr>
${footer}
</table></td></tr></table></body></html>`;
  const text = `${blocks.map((b) => blockText(b, contact)).filter(Boolean).join("\n")}\n\n—\n${p.brand.name}${address ? `\n${address}` : ""}\nUnsubscribe: ${unsubscribeUrl}\n`;
  return { html, text, subject: mergeTags(subject, contact) };
}

// Starter templates for "New email".
export function starterBlocks(kind, brand = "double-cone") {
  const b = BRANDS[brand] || BRANDS["double-cone"];
  if (kind === "new-release") {
    return [
      { type: "hero", image: "", link: "" },
      { type: "heading", text: "Fresh off the line 🍺", size: "xl" },
      { type: "text", text: "Kia ora {{first_name|there}},\n\nWe've just packaged something we're really proud of and wanted you to hear about it first." },
      { type: "beer", name: "Beer name", style: "Style", abv: "5.0", description: "A couple of lines on how it tastes and why people will love it.", image: "", tag: "New", url: "" },
      { type: "callout", text: "Kegs and cases available now — first in, first served!", emoji: "🎉" },
      { type: "button", label: "Order now", url: "" },
      { type: "text", text: `Cheers,\nThe ${b.short} team` },
    ];
  }
  if (kind === "whats-pouring") {
    return [
      { type: "heading", text: "What's pouring this month", size: "lg" },
      { type: "text", text: "Hey {{first_name|there}}, here's what we've got ready to go:" },
      { type: "beer", name: "Beer one", style: "", abv: "", description: "", image: "", tag: "In stock", url: "" },
      { type: "beer", name: "Beer two", style: "", abv: "", description: "", image: "", tag: "Back soon", url: "" },
      { type: "button", label: "Get in touch", url: "" },
    ];
  }
  if (kind === "event") {
    return [
      { type: "hero", image: "", link: "" },
      { type: "heading", text: "You're invited!", size: "xl" },
      { type: "text", text: "Join us for **event name** on **date** at **place**.\n\nGood beer, good people — bring your mates." },
      { type: "callout", text: "Date · Time · Place", emoji: "📅" },
      { type: "button", label: "Count me in", url: "" },
    ];
  }
  return [
    { type: "heading", text: "Your headline here", size: "lg" },
    { type: "text", text: "Kia ora {{first_name|there}},\n\nWrite your message here." },
    { type: "button", label: "Find out more", url: "" },
  ];
}
