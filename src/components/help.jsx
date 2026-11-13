import { useState, useEffect, useRef } from "react";
import { X, FileText, Sparkles } from "lucide-react";
import { BreworxMark, EmptyState, Modal } from "./ui";

export const HELP_ARTICLES = [
  {
    category: "Getting started",
    question: "How do I add a recipe?",
    answer: "Go to Recipes → New recipe. Fill in your ingredients and schedule, and it calculates OG/FG/ABV/IBU/SRM live as you go. \"Save & brew this recipe\" saves it and jumps straight into New Batch pre-filled.",
  },
  {
    category: "Getting started",
    question: "How do I brew a batch?",
    answer: "On Batches, tap \"New batch.\" Pick a saved recipe (it pre-fills everything) or enter details manually, choose a tank and brew date, then start it.",
  },
  {
    category: "Getting started",
    question: "How do I add a tank?",
    answer: "Go to Brewery → New tank. Set its name, type (Fermenter or Brite Tank), and capacity.",
  },
  {
    category: "Batches",
    question: "How do I schedule a batch for the future?",
    answer: "Go to Production and tap an empty day on any tank's row — it opens New Batch pre-filled with that tank and date. You can also just type a future date directly into New Batch's \"Brew date\" field.",
  },
  {
    category: "Batches",
    question: "Why can't I pick a certain tank when creating a batch?",
    answer: "A tank is only blocked if it's genuinely occupied right now and you're brewing today or earlier. If you're scheduling for a future date, an occupied tank is still selectable — you'll just get a heads-up reminder to make sure it's free by then.",
  },
  {
    category: "Batches",
    question: "How do I change my batch numbering?",
    answer: "New Batch has an editable \"Batch number\" field, pre-filled with the next number in sequence. Type over it to start counting from wherever you want — future batches keep incrementing from your new number.",
  },
  {
    category: "Batches",
    question: "How do I package a batch?",
    answer: "Open the batch and advance it through its stages (Brewing → Primary → Cooling). Once it's ready, tap \"Package batch,\" enter how many cans/kegs you filled, and optionally pick a Package Type to deduct consumables automatically.",
  },
  {
    category: "Batches",
    question: "I packaged a batch by mistake — can I undo it?",
    answer: "Yes. On the batch page, find the packaging run under Packaging and tap the circular undo icon next to it. It reverts the batch to Cooling and returns any consumables that were deducted back into stock.",
  },
  {
    category: "Batches",
    question: "How do I track quality issues like diacetyl or oxidation?",
    answer: "While a batch is Brewing, Primary, or Cooling, its page shows a Quality checklist of common faults. Tap one to cycle through Low → Medium → High → off. Each day gets its own fresh assessment, so an earlier note is never silently overwritten.",
  },
  {
    category: "Recipes",
    question: "How do I compare batches brewed from the same recipe?",
    answer: "Go to Recipe Analytics, search for the recipe, then tap \"Compare batches\" and select two or more to see target vs. actual OG/FG, attenuation, ABV, mash pH/temp, cost, and faults side by side.",
  },
  {
    category: "Recipes",
    question: "How do I print a recipe or batch sheet?",
    answer: "Both recipe pages and batch pages have a \"Print / Save as PDF\" button near the bottom. On an iPad, the print dialog lets you save straight to Files as a PDF.",
  },
  {
    category: "Recipes",
    question: "New ingredients in a recipe — do I have to add them to Inventory separately?",
    answer: "Not anymore. As you type an ingredient into a recipe, you can add it to Inventory right from that same dropdown if it doesn't already exist. And when you save a recipe, anything still missing gets offered as a one-tap batch add — or matched to something similar already in stock instead of creating a duplicate. Already got a recipe brewing? Open it and tap \"Check ingredients against inventory\" to run the same check any time — the batch's stage doesn't matter.",
  },
  {
    category: "Stock",
    question: "Can I rename an ingredient, consumable, or package type after I've added it?",
    answer: "Yes — open the item and tap the pencil icon next to its name. A typo doesn't have to be permanent, and nothing else about the item's history changes.",
  },
  {
    category: "Production",
    question: "Can I set a target temperature or pressure for a tank?",
    answer: "Yes — on any batch, look for \"Tank settings\" above the gravity and temperature charts. Set a target temperature and pressure (PSI or Bar, with the other unit's conversion shown alongside), and every change is logged with a history you can look back through.",
  },
  {
    category: "Production",
    question: "How do I reuse yeast from a previous batch?",
    answer: "Open a batch that's in Primary, Cooling, Brite Tank, or Aging, and tap \"Harvest yeast from this batch.\" It logs the strain, amount, and works out the generation automatically. When starting a new batch, a \"Pitching yeast\" section lets you pick that harvest instead of fresh — check the Yeast page under Production to see everything currently available to reuse.",
  },
  {
    category: "Production",
    question: "How do I schedule a brew ahead of time?",
    answer: "On the Production calendar, tap an empty slot on any tank's row for the date you want, or use \"Schedule a brew\" — just the essentials (name, style, volume, tank, date), no need for a full recipe or ingredients yet. It shows on the calendar in taupe with a dashed border so it's clearly distinct from what's actually brewing, and stays that way until the day it genuinely starts.",
  },
  {
    category: "Production",
    question: "What happens if a scheduled brew's tank isn't actually free yet?",
    answer: "It's flagged right on the calendar in amber with a warning icon, and opening it explains exactly which batch is still occupying the tank and what to do — pick a later date, a different tank, or move the other batch along first.",
  },
  {
    category: "Batches",
    question: "Can two purchase orders that arrived in the same delivery share one freight charge?",
    answer: "Yes — open Receiving on either order and use \"Combine with another order\" to pull the second one in. Enter one delivery cost and it splits proportionally across every line from both orders by value, and each order ends up storing its own genuine share of that shared cost.",
  },
  {
    category: "Batches",
    question: "Can I edit a purchase order after creating it?",
    answer: "Yes, as long as it hasn't been received yet — \"Edit order\" shows on any Draft or Sent PO. Once it's Received it's moved into real inventory with real lots, so it's locked to keep that history consistent.",
  },
  {
    category: "Batches",
    question: "Can a supplier's lot number be entered before the delivery arrives?",
    answer: "Yes — some suppliers print the lot number on the PO itself rather than the delivery docket. There's a Lot/batch # field on each line when creating the order, and it carries over automatically to Receiving so you're not retyping it.",
  },
  {
    category: "Batches",
    question: "Can I scan a photo or PDF instead of typing in a purchase order?",
    answer: "Yes — \"Import from a photo or PDF\" on both creating and receiving a PO reads the document and fills in supplier, items, quantities, and cost automatically, including working out a true per-unit cost when it's sold by the pack (e.g. a 25kg bag priced per bag). Always worth a quick check against the real invoice before saving.",
  },
  {
    category: "Sales",
    question: "How do I let a customer order online?",
    answer: "Open the customer and use \"Create login\" under Online ordering — this sets them up with a real account (email and password), not just a link. They log in anytime at the shared /order page, with password reset built in if they forget it. If they never finish setting it up, \"Resend setup link\" sends a fresh one.",
  },
  {
    category: "Sales",
    question: "Can I sell a mixed or variety pack?",
    answer: "Yes — set one up from the Stock page under \"Mixed packs.\" Choose Fixed (always the same beers and quantities) or Flexible (pick what goes in each time), give it its own price, then tap \"Assemble\" whenever you want to actually build some — it deducts real stock from each beer it contains. Once assembled, it shows up as its own item when creating a Sales Order.",
  },
  {
    category: "Stock",
    question: "What's the difference between Inventory and Consumables?",
    answer: "Inventory is your brewing ingredients — grain, hops, yeast. Consumables are packaging materials — cans, lids, boxes, labels. They're tracked separately since they're used at completely different stages.",
  },
  {
    category: "Stock",
    question: "What's a Package Type?",
    answer: "A Package Type defines which consumables (and how many of each) get used per unit packaged — e.g. 1 can + 1 lid + a share of a box. Pick one when logging a packaging run and it deducts the right stock automatically. A label line can also be set to auto-match by beer name, so one package type works across every recipe.",
  },
  {
    category: "Stock",
    question: "How do purchase orders work?",
    answer: "Create a draft PO with supplier and line items, mark it Sent once it's placed, then \"Mark received\" once it arrives — that's what actually adds the stock into Inventory, with proper lot tracking and cost per unit.",
  },
  {
    category: "Stock",
    question: "How do I export my data?",
    answer: "Inventory, Purchase Orders, and Batches each have an \"Export CSV\" link above their list, which respects whatever search filter is active.",
  },
  {
    category: "Stock",
    question: "How do I bring in stock I already had before using this app?",
    answer: "Inventory → \"Bring in opening stock,\" above Export CSV. Search for an existing item or type a new name to create one, add as many items as you need in one go, and each becomes a real, dated, costed lot — it behaves exactly like anything received going forward, not a special-case shortcut.",
  },
  {
    category: "Stock",
    question: "Can I fix an ingredient's category if it was entered wrong?",
    answer: "Yes — tap the pencil icon next to the item's name to edit both its name and category (e.g. moving something from Grain to Yeast). Doesn't touch its quantity, cost, or history.",
  },
  {
    category: "Stock",
    question: "How do I correct a stock quantity?",
    answer: "To increase stock, use \"Add a lot\" — that's the only way in, and it keeps everything properly costed and traceable. To decrease it for something used, wasted, or lost outside a normal batch, use \"Log an adjustment.\" Both live on the item's own page; there's deliberately no quick tap-to-bump control anymore.",
  },
  {
    category: "Stock",
    question: "Can a stock adjustment be undone?",
    answer: "Yes — any entry logged as a manual adjustment shows a Delete link in the item's history. Deleting it reverses its effect on the total quantity. It restores the overall number correctly, but doesn't attempt to put a decrease back onto the exact lot it originally came from, since that detail isn't reliably recoverable afterward.",
  },
  {
    category: "Stock",
    question: "Where can I see roughly how much my stock is worth?",
    answer: "Inventory and Consumables both show a total value card at the top, plus a per-item value on each one — calculated from what each remaining lot actually cost, not just current quantity at the latest price. It's a rough, useful figure for day-to-day purposes, not a formal accounting valuation.",
  },
  {
    category: "Compliance",
    question: "How do I log a food safety checklist or staff sickness?",
    answer: "Go to Food Safety. Checklists are at the top; \"Staff training,\" \"Staff sickness,\" calibration, water tests, and mock recalls are all under Other records.",
  },
  {
    category: "Compliance",
    question: "How do I check a label is legally compliant?",
    answer: "Food Safety → Checklists → \"Label compliance — packaged beer & cider\". Run it whenever a label is new, changed or reprinted. It covers everything MPI's labelling guide requires (ABV, standard drinks, pregnancy warning, net contents, lot ID, address, Best Before, allergens and so on). It isn't on a schedule, so it never shows as overdue. Each check is saved against the product you name, so it shows up in the audit report.",
  },
  {
    category: "Compliance",
    question: "What's a corrective action?",
    answer: "If you leave a checklist item unchecked, you're asked to record what's being done about it before you can save. That stays as an open item — visible right at the top of Food Safety — until someone marks it resolved.",
  },
  {
    category: "Compliance",
    question: "How do I see what's overdue?",
    answer: "The \"Needs attention\" section at the top of Food Safety shows overdue checklists, overdue equipment calibrations, and any open corrective actions, all in one place.",
  },
  {
    category: "Compliance",
    question: "How do I get a report to hand an inspector?",
    answer: "On Food Safety, tap \"Export audit report\" above the record history. It uses whatever date range you've filtered to, and gives you a clean print/Save-as-PDF report — summary counts, open corrective actions, and the full record log.",
  },
  {
    category: "Compliance",
    question: "How do I run a mock recall?",
    answer: "Food Safety → \"Run a mock recall\" under Other records. Pick a real batch and it traces every lot that went into it and every customer who received it, using your actual purchase order and sales order data — a genuine test of whether you could recall something for real, not a hypothetical.",
  },
  {
    category: "Compliance",
    question: "How do I log an internal audit?",
    answer: "Food Safety → \"Internal audit\" under Other records. Walks through a 9-area self-review — checklists, calibration, training, water, pest control, mock recall, traceability, corrective actions, and records. Quarterly is a sensible default cadence, not a legal requirement, and it'll flag as overdue if it's never been done.",
  },
  {
    category: "Compliance",
    question: "How do I log a verifier visit?",
    answer: "Food Safety → \"Log verifier visit\" under Other records. This is your actual MPI-recognised verifier's visit — separate from your own internal audit. If they raise a non-conformance, it requires a corrective action before saving, and that flows into the same open corrective actions list as everything else.",
  },
  {
    category: "Compliance",
    question: "How does pest control tracking work?",
    answer: "Food Safety → Pest control. Set up your stations once, then log a monthly check per station — monthly is advised by a food safety inspector, not an MPI-mandated number. Contractor visits are logged separately and can carry a \"next visit due\" date that flags as overdue once it passes.",
  },
  {
    category: "Compliance",
    question: "How do water tests get tracked?",
    answer: "Food Safety → \"Log water test\" under Other records — it's a simple dated note. Quarterly is used as the overdue cadence, a sensible default rather than a legal mandate, and it'll show under Needs attention once it's been longer than that since the last one.",
  },
  {
    category: "Compliance",
    question: "How do I mark a supplier as approved?",
    answer: "Open the supplier from Food Safety or Inventory and edit it — there's an Approved/Not approved toggle, with an optional note on how it was verified. Shows right on the supplier list so it's visible at a glance, not buried in an edit form.",
  },
  {
    category: "Compliance",
    question: "How do I log a customer complaint?",
    answer: "Food Safety → \"Log complaint\" under Other records. Search for the batch it relates to if you know it — that ties the complaint into the same traceability data mock recall uses, so a pattern across complaints on one batch is easy to spot.",
  },
  {
    category: "Compliance",
    question: "How does traceability work?",
    answer: "Go to Traceability and search a lot number, batch, or customer. It traces forward from an ingredient lot through every batch it went into and every order it was sold on, or backward from a customer to everything they've bought — the same data mock recall runs on.",
  },
  {
    category: "Compliance",
    question: "How does excise work?",
    answer: "Go to Excise. Classify each recipe's product type once, then it calculates duty per batch using the current NZ Customs rates and exports a CSV formatted for TSW filing. Recommend having an accountant review it before using it for a real return — this handles the calculation, not the filing itself.",
  },
  {
    category: "Sales",
    question: "How do I add a customer?",
    answer: "Go to Customers → New customer. Wholesale, taproom, or direct-to-consumer — pick whichever fits, though only wholesale is fully built out for ordering right now.",
  },
  {
    category: "Sales",
    question: "How do I create an order?",
    answer: "Go to Orders → New order. Pick a customer, then pick from what's actually packaged and available to sell — you can't accidentally oversell something that's already gone.",
  },
  {
    category: "Sales",
    question: "What happens when I cancel an order?",
    answer: "Any stock that order had reserved goes straight back to available — nothing needs manual adjusting.",
  },
  {
    category: "Sales",
    question: "How do I see what's actually available to sell right now?",
    answer: "Go to Stock, under Sales. It's live — packaging a batch adds to it, fulfilling an order takes away from it, cancelling an order gives it back.",
  },
  {
    category: "Sales",
    question: "How do orders get invoiced in Xero automatically?",
    answer: "Open a customer and tap \"Link to Xero\" — either match them to an existing Xero contact or create one fresh. From then on, marking any of their orders Fulfilled sends the invoice to Xero automatically.",
  },
  {
    category: "Sales",
    question: "I don't sell wholesale — can I turn this off?",
    answer: "Yes. Settings → Modules → \"Sales & Orders.\" Switching it off hides Customers, Orders, and Stock from the sidebar entirely.",
  },
  {
    category: "Reminders",
    question: "How do I add a reminder or task?",
    answer: "Tap any day on the Reminders row above your tanks on Production, or use the \"+ Add\" button under Today on Home for something due today.",
  },
  {
    category: "Reminders",
    question: "How do I tell whose reminder is whose?",
    answer: "Each person gets their own color, consistent every time — no need to open anything to see who added what. Checking one off also records who completed it.",
  },
  {
    category: "Account",
    question: "How do I start completely fresh (delete everything)?",
    answer: "Settings → \"Delete company\" (near the bottom, in red). It wipes every batch, recipe, and record for the whole company, then signs you out to the sign-up screen. Type \"DELETE COMPANY\" to confirm — this can't be undone.",
  },
  {
    category: "Account",
    question: "I made a mistake — can I undo a delete?",
    answer: "Almost everything you can delete (batches, recipes, tanks, suppliers, ingredients, consumables, package types, purchase orders) shows a 5-second \"Undo\" option in the confirmation toast right after you delete it.",
  },
  {
    category: "Account",
    question: "What can a staff member see and do compared to the owner?",
    answer: "Staff can't see costs or dollar values anywhere (ingredients, recipes, batches, PO pricing), can't delete records, can't manage the Xero connection or company-wide module settings, and don't see the Excise page at all. Everything needed for day-to-day brewing, logging, and food safety is fully open to them.",
  },
  {
    category: "Account",
    question: "How do I make a teammate an owner, or make an owner a regular member?",
    answer: "On the Team page, tap a teammate's role to toggle it — you can't change your own, as a safeguard against accidentally losing owner access with nobody else able to restore it.",
  },
  {
    category: "Finding things",
    question: "How do I quickly find something without digging through menus?",
    answer: "Tap \"Search…\" right under the logo in the sidebar. It searches batches, recipes, purchase orders, and tanks all at once.",
  },
];

// A printable QR code linking straight to a tank — scan it (e.g. stuck on
// the side of the tank) to jump right to whatever's currently in it.
export function TankQRModal({ tank, onClose }) {
  const url = `${window.location.origin}${window.location.pathname}?tank=${tank.id}`;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;
  return (
    <Modal title={`QR code — ${tank.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ color: "#5C6B54", fontSize: 12.5, textAlign: "center" }}>
          Print this and stick it on the tank — scanning it opens whatever's currently in {tank.name}.
        </div>
        <img src={qrImg} alt={`QR code for ${tank.name}`} width={220} height={220} style={{ border: "1px solid #DDE0C8", borderRadius: 6, background: "#FFFFFF", padding: 10 }} />
        <button
          onClick={() => window.print()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "none",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 16px",
            color: "#5C6B54",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <FileText size={14} /> Print
        </button>
        <div className="bp-print-sheet" style={{ display: "none", textAlign: "center" }}>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, margin: "0 0 16px" }}>{tank.name}</h1>
          <img src={qrImg} alt={`QR code for ${tank.name}`} width={260} height={260} />
        </div>
      </div>
    </Modal>
  );
}

// ─── Sales login: its own guide and welcome tour ───────────────────────────
export const SALES_HELP_ARTICLES = [
  { category: "Getting around", question: "What can I see with a Sales login?", answer: "Four pages: Stock (what you can sell now), Upstock orders (open orders and back orders), Tanks (what's brewing and when it's ready) and Calendar (what's brewing over the coming weeks and months). It's view only — nothing you tap changes stock, orders or the brew schedule. Steve can switch on extra pages for you (batch pages, customers & orders, ingredient stock, recipes) if you need them." },
  { category: "Getting around", question: "Do I need to refresh?", answer: "No. The pages update by themselves every minute while they're open, and orders from Upstock show up within seconds of reaching Xero. If something looks out of date, reload the page." },
  { category: "Getting around", question: "Can I use it on my phone?", answer: "Yes — it works in any browser. On a phone or iPad, Share → Add to Home Screen and it opens like an app." },
  { category: "Stock", question: "What does \"available\" mean?", answer: "What you can sell right now: everything packaged, minus what's been sold, minus what's held for orders that haven't gone out yet. Cans are shown as cases of 24 plus any loose cans." },
  { category: "Stock", question: "What does \"held for Xero drafts\" mean?", answer: "That stock is already promised to an Upstock order still sitting as a draft invoice in Xero. It isn't in the available number, so it can't be sold twice. When the order is approved in Xero it becomes a sale; if the order is deleted it goes back to available." },
  { category: "Stock", question: "Why are there batch numbers?", answer: "Each line shows which brew it came from (e.g. #1030). A beer can have stock from more than one batch; the oldest is used first." },
  { category: "Stock", question: "Where's a beer that's run out?", answer: "Sold-out lines are hidden. Tap \"Show sold out\" at the bottom of the Stock page to see them." },
  { category: "Upstock orders & back orders", question: "What's on the Upstock orders page?", answer: "Every order still waiting as a draft invoice in Xero — usually Upstock orders that haven't been approved and sent. At the top, Back orders: each beer that's owed but not in stock, how much, which customers, and roughly when it'll be ready. Below, Open orders: each order line shows how much is in stock (held, and from which batch) and how much is on back order." },
  { category: "Upstock orders & back orders", question: "What is a back order?", answer: "Beer that's been ordered but isn't in stock yet. It fills by itself: when that beer is packaged, the new stock goes to the oldest waiting order first, and the line changes from Back order to In stock." },
  { category: "Upstock orders & back orders", question: "How do I read the ready date?", answer: "\"In tank, ready about…\" — the beer is already brewing. \"Brew on the calendar, ready about…\" — a brew is planned. \"Not on the calendar yet — earliest ready about…\" — no brew is scheduled yet; that's the earliest it could be ready if Steve brews it at the next free slot. Treat all of these as a guide, not a promise — check with Steve before committing a date to a customer." },
  { category: "Upstock orders & back orders", question: "Who gets stock first?", answer: "The oldest order. Stock is held for orders in date order, so a new order can't take beer already held for an earlier one." },
  { category: "How it links to Upstock & Xero", question: "What happens when I put an order through Upstock?", answer: "1) Upstock creates a draft invoice in Xero. 2) Xero tells Brewpoint straight away, and the order appears on Upstock orders within seconds (a check every 2 minutes is the backup). 3) If the beer's in stock, it's held for the order from the oldest batch; anything short goes on back order. 4) When the invoice is approved in Xero, the held stock comes off as a sale from those batches. 5) If the draft is deleted or voided in Xero, the stock goes back to available and any back order disappears." },
  { category: "How it links to Upstock & Xero", question: "What if an order is changed in Xero?", answer: "Brewpoint follows Xero. Change the quantities on the draft and the held stock and back order update; approve it and it becomes a sale; delete it and it's gone." },
  { category: "How it links to Upstock & Xero", question: "Why doesn't Xero's stock match Brewpoint's available?", answer: "Xero doesn't count stock held for draft invoices — Brewpoint does. So Brewpoint's available can be lower than Xero's stock on hand by exactly what's held for Upstock orders. Brewpoint's number is the one to sell from." },
  { category: "How it links to Upstock & Xero", question: "What about sales invoiced straight in Xero?", answer: "Approved Xero invoices — from Upstock or made directly in Xero — come off Brewpoint's stock automatically, against the batch they came from." },
  { category: "Tanks & calendar", question: "What do the tank cards show?", answer: "Each fermenter and brite tank: the beer in it now, how far along it is, \"Ready ~date\" for when it should be ready to package, and \"Next:\" for the brew planned into that tank after it. \"Coming up\" lists every planned brew in date order." },
  { category: "Tanks & calendar", question: "How are ready dates worked out?", answer: "From the brewery's own history: for each beer, the average number of days from brew day to packaging over its last 6 brews (odd ones left out). It updates every time a beer is packaged, so it gets more accurate over time. If Steve moves a brew on the calendar, the ready dates move with it." },
  { category: "Tanks & calendar", question: "Can I change the calendar?", answer: "No — it's view only for Sales. Ask Steve if a brew needs to move for an order." },
  { category: "Common questions", question: "A customer asks if we have something — where do I look?", answer: "Stock → find the beer → the green \"available\" number is what you can promise now. If it's 0, check Upstock orders → Back orders, or Tanks, for when more is coming." },
  { category: "Common questions", question: "A customer asks when their back order will arrive", answer: "Upstock orders → Back orders → find the beer: the ready date is when it should be packaged. Allow time for delivery on top, and confirm with Steve before giving a firm date." },
  { category: "Common questions", question: "Something looks wrong", answer: "Reload the page first. If the stock or an order still doesn't look right, tell Steve — he can check it against Xero and correct it." },
];

export const SALES_TOUR_STEPS = [
  { title: "Welcome to Brewpoint", body: "This is your view of the brewery: what's in stock, what's held for orders, what's on back order, and when more beer will be ready. It's view only, and it updates by itself as orders come through Upstock and Xero.", target: null },
  { title: "Stock", body: "What you can sell right now, by beer and container. Anything \"held for Xero drafts\" is already promised to an Upstock order, so it isn't in the available number.", target: "nav-finishedGoodsStock", needsSidebar: true },
  { title: "Upstock orders", body: "Every Upstock order still waiting in Xero: what's held for it, what's on back order, and roughly when the back-ordered beer will be ready.", target: "nav-salesUpstock", needsSidebar: true },
  { title: "Tanks", body: "What's brewing in each tank and when it should be ready, plus what's coming up next.", target: "nav-salesTanks", needsSidebar: true },
  { title: "Calendar", body: "The production calendar: every brew over the coming weeks and months.", target: "nav-production", needsSidebar: true },
  { title: "Help any time", body: "Tap Help guide for how it all works — including how orders flow from Upstock to Xero to Brewpoint, and how ready dates are worked out.", target: "help-guide-btn", needsSidebar: true },
];

export const TOUR_STEPS = [
  {
    title: "Welcome to Brewpoint",
    body: "This is your brewery's home base — tanks, batches, recipes, stock, and compliance, all in one place. Let's take a quick, guided look around.",
    target: null,
  },
  {
    title: "Start in Brewery",
    body: "Set up your fermenters and brite tanks here — plus a mash tun and kettle too, if you want brew day tracked from the very start, right through mashing, boiling, and transferring to a fermenter.",
    target: "nav-brewery",
    needsSidebar: true,
  },
  {
    title: "Then brew a batch",
    body: "On Batches, tap \"New batch.\" Pick a saved recipe and it pre-fills everything, or enter the details yourself. Brew day timers for mash, boil, and whirlpool are right there on the batch page.",
    target: "nav-batches",
    needsSidebar: true,
  },
  {
    title: "Watch it happen on Home",
    body: "Once you're brewing, Home becomes your real-time picture of the brewery — tanks show color-coded stages (bubbling while fermenting, frosty while cooling), and once a tank empties out, it walks through a cleaning cycle right there before it's marked ready again.",
    target: null,
  },
  {
    title: "Production & Recipes",
    body: "Production is for scheduling brews ahead of time across your tanks. Recipes is your library — save one to reuse on brew day, or check Recipe Analytics to compare batches of the same beer over time.",
    target: "nav-groups",
    needsSidebar: true,
  },
  {
    title: "Stock & Compliance",
    body: "Stock covers ingredients, packaging materials, and purchase orders — with low-stock warnings and reorder shortcuts. Compliance now covers a lot: checklists, mock recalls, internal audits, verifier visits, pest control, water testing, approved suppliers, and full traceability — everything an inspector would want to see.",
    target: "nav-groups",
    needsSidebar: true,
  },
  {
    title: "Find anything instantly",
    body: "Tap Search any time to jump straight to a batch, recipe, order, or tank by name — no digging through menus.",
    target: "search-btn",
    needsSidebar: true,
  },
  {
    title: "If you get stuck",
    body: "The Help guide has quick answers for almost everything in here. And keep an eye on the \"Getting set up\" checklist back on Home — it tracks exactly what's left before you're fully up and running.",
    target: "help-guide-btn",
    needsSidebar: true,
  },
  {
    title: "You're all set",
    body: "That's the tour. Head to Brewery to set up your first tank, then start brewing whenever you're ready.",
    target: null,
  },
];

// Per-page spotlight tours — same mechanism as the welcome tour, but each
// one fires only the first time you land on that specific page. Keyed by
// the same string used for `view`, so it's a straight lookup at render
// time. Kept intentionally short (2-3 steps) — these are quick orientation,
// not a repeat of the welcome tour.
export const PAGE_TOURS = {
  brewery: [
    {
      title: "Set up your tanks",
      body: "Add a tank here for every fermenter and Brite Tank you have — and a Mash Tun and Kettle too, if you want brew day tracked from mashing right through to transferring into a fermenter.",
      target: "page-brewery-newbtn",
    },
    {
      title: "Check on any tank",
      body: "The calendar icon shows a tank's full history — every batch that's used it, and every cleaning step logged against it. Handy for spotting a tank with repeat problems.",
      target: "page-brewery-history",
    },
  ],
  batches: [
    {
      title: "Every batch lives here",
      body: "From brew day through to packaging. Tap here to start one — pick a saved recipe and it pre-fills everything, or enter the details yourself.",
      target: "page-batches-newbtn",
    },
    {
      title: "Find any batch fast",
      body: "Search by name, style, or number — this covers every stage, including ones you've already packaged. There's also an Export CSV link once you've got a few batches in.",
      target: "page-batches-search",
    },
  ],
  inventory: [
    {
      title: "Your brewing ingredients",
      body: "Grain, hops, yeast — add stock manually here, or receive it automatically through a Purchase Order with proper lot tracking.",
      target: "page-inventory-newbtn",
    },
    {
      title: "Keep it accurate",
      body: "Walk the brewery and count what's actually on the shelf — any discrepancy gets logged, and the report's saved for later.",
      target: "page-inventory-stocktake",
    },
  ],
  consumables: [
    {
      title: "Packaging supplies",
      body: "Cans, lids, boxes, labels — tracked separately from your brewing ingredients. Add a cost per unit here to get true packaging costs.",
      target: "page-consumables-newbtn",
    },
    {
      title: "Keep it accurate",
      body: "Same idea as ingredients — walk the shelf, count what's there, and any discrepancy gets logged.",
      target: "page-consumables-stocktake",
    },
  ],
  packageTypes: [
    {
      title: "Bundle what a run uses",
      body: "Define what consumables get used per unit packaged — e.g. 1 can + 1 lid + a share of a box. Pick a package type when you log a packaging run and it deducts stock automatically, with the cost worked out for you.",
      target: "page-packageTypes-newbtn",
    },
  ],
  orders: [
    {
      title: "Order from your suppliers",
      body: "Create a purchase order here to bring ingredients or packaging in from a supplier. Receiving one adds the stock straight in, with proper lot tracking and cost per unit.",
      target: "page-orders-newbtn",
    },
  ],
  recipes: [
    {
      title: "Save a recipe to reuse",
      body: "Ingredients pull in automatically on brew day, and OG/FG/ABV/IBU/SRM calculate live as you build one out.",
      target: "page-recipes-newbtn",
    },
    {
      title: "Find one fast",
      body: "Search by name or style — this covers every version you've saved, including older ones you've since updated.",
      target: "page-recipes-search",
    },
  ],
  recipeAnalytics: [
    {
      title: "Compare batches of the same beer",
      body: "Search for a recipe to see every batch ever brewed from it side by side — target vs actual OG/FG, attenuation, ABV, days in tank, and cost — so you can spot drift or confirm consistency over time.",
      target: "page-recipeAnalytics-search",
    },
    {
      title: "Or search by fault instead",
      body: "See if a fault keeps showing up on a particular recipe, or a particular tank, regardless of what's brewed in it.",
      target: "page-recipeAnalytics-faultmode",
    },
  ],
  foodsafety: [
    {
      title: "Stay on top of compliance",
      body: "Log daily, weekly, and monthly checklists, equipment calibration, and staff training here — everything you'd need on hand for an audit.",
      target: null,
    },
    {
      title: "There's more under Other records",
      body: "Mock recalls, internal audits, verifier visits, pest control, water testing, and customer complaints all live down there too — each one feeds the same traceability data, so a real recall would actually work if you ever needed it.",
      target: null,
    },
  ],
  traceability: [
    {
      title: "Trace forward or backward",
      body: "Search a lot number, batch, or customer. Forward from an ingredient lot shows every batch it went into and every order it was sold on; backward from a customer shows everything they've ever bought. This is the same data mock recall runs on.",
      target: null,
    },
  ],
  excise: [
    {
      title: "Duty on your own batches",
      body: "Classify each recipe's product type once, then this calculates duty per batch at the current NZ Customs rates and exports a CSV formatted for TSW filing. Worth having an accountant check before using it for a real return.",
      target: null,
    },
    {
      title: "Self-audit your returns",
      body: "Import screenshots of your TSW returns and each month is checked against what you packaged — litres and pure alcohol. Anything that doesn't line up is flagged so you can fix or explain it, and the audit report prints as a PDF to show Customs.",
      target: null,
    },
  ],
  customers: [
    {
      title: "Track who you sell to",
      body: "Add wholesale accounts, bars, and bottle shops here — whoever you sell finished beer to. This is where orders and invoicing tie back to.",
      target: "page-customers-newbtn",
    },
    {
      title: "Link a customer to Xero",
      body: "Open any customer and link them to Xero — or create them fresh — and orders you fulfil for them will invoice automatically from then on.",
      target: null,
    },
  ],
  salesOrders: [
    {
      title: "Create an order",
      body: "Pick a customer, then pick from what's actually packaged and available — the same stock everyone else can see, so you can't oversell it.",
      target: "page-salesOrders-newbtn",
    },
    {
      title: "Draft, Confirmed, Fulfilled",
      body: "An order reserves stock once Confirmed, and marking it Fulfilled is what sends the invoice to Xero, if you've got that connected. Cancel an order at any point and its stock goes straight back.",
      target: null,
    },
  ],
  finishedGoodsStock: [
    {
      title: "Live, not manual",
      body: "This updates itself — packaging a batch adds to it, fulfilling an order takes away from it, cancelling an order gives it back. Nothing here needs typing in by hand.",
      target: null,
    },
    {
      title: "Keep it accurate",
      body: "Same idea as your other stock takes — count what's actually there, and any discrepancy gets logged for the record.",
      target: "page-finishedGoodsStock-stocktake",
    },
  ],
  packaged: [
    {
      title: "Your packaging history",
      body: "Every packaging run, grouped by month, so you can see volume trends over time. This is history, not current stock — for what's actually available to sell right now, check Stock under Sales.",
      target: "page-packaged-search",
    },
  ],
  production: [
    {
      title: "See every tank's schedule at a glance",
      body: "Tap an empty day on a tank's row to schedule a batch ahead of time, or tap an existing bar to open that batch.",
      target: null,
    },
    {
      title: "Set reminders for the team",
      body: "The Reminders row above your tanks isn't just for batches — tap any day to add a task, check it off once it's done, and see who added or completed it at a glance.",
      target: null,
    },
  ],
  aging: [
    {
      title: "For the stuff that takes months, not weeks",
      body: "Anything sitting in a Barrel or Aging Tank shows up here — not on Home, not on the Production calendar. This is a slower page for a slower process.",
      target: null,
    },
    {
      title: "Fermenting or aging?",
      body: "A barrel can show either — useful for wild or spontaneous fermentation straight from the kettle. Flip the toggle on the batch itself once it settles into quiet aging.",
      target: null,
    },
    {
      title: "Log a tasting as you go",
      body: "Open any batch here and log a tasting — pick from real barrel-aging flavors and off-flavors, or just write a note. The three most recent tags show right on the card.",
      target: null,
    },
  ],
};

// Highlights a live element on screen by its data-tour attribute — finds
// it, measures its real position, and dims everything else via a single
// box-shadow trick (a huge spread radius on a transparent box acts as a
// full-screen overlay with a "hole" cut exactly where the box is). Opens
// the mobile sidebar drawer itself for steps that need it visible, and
// closes it again once the tour moves past those steps or ends.
export function SpotlightTour({ steps, onClose, setSidebarOpen, showLogoOnFirst = false }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const slide = steps[step];
  const isLast = step === steps.length - 1;

  useEffect(() => {
    setSidebarOpen(!!slide.needsSidebar);
  }, [step]);

  useEffect(() => {
    if (!slide.target) {
      setRect(null);
      return;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${slide.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const timeoutId = setTimeout(measure, 280);
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  useEffect(() => () => setSidebarOpen(false), []);

  const pad = 8;
  const narrow = window.innerWidth < 560;
  const cardWidth = 300;
  let cardStyle;
  if (rect && !narrow) {
    const top = Math.max(20, Math.min(rect.top, window.innerHeight - 260));
    const left = Math.min(rect.right + 20, window.innerWidth - cardWidth - 20);
    cardStyle = { position: "fixed", top, left, width: cardWidth };
  } else if (rect && narrow) {
    cardStyle = { position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", width: "calc(100% - 40px)", maxWidth: cardWidth };
  } else {
    cardStyle = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "calc(100% - 40px)", maxWidth: cardWidth + 60 };
  }

  return (
    <>
      {rect && (
        <div
          style={{
            position: "fixed",
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 10,
            border: "2px solid #5C9A3C",
            boxShadow: "0 0 0 4px rgba(92,154,60,0.3), 0 0 0 9999px rgba(10,12,11,0.72)",
            pointerEvents: "none",
            zIndex: 99,
            transition: "top 0.2s ease, left 0.2s ease, width 0.2s ease, height 0.2s ease",
          }}
        />
      )}
      {!rect && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(10,12,11,0.65)", zIndex: 98 }} />
      )}
      <div
        style={{
          ...cardStyle,
          zIndex: 100,
          background: "#F8F5EA",
          border: "1px solid #DDE0C8",
          borderRadius: 12,
          padding: "22px 20px 18px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          boxSizing: "border-box",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", color: "#9BA88A", cursor: "pointer", padding: 4 }}
        >
          <X size={16} />
        </button>

        {step === 0 && showLogoOnFirst && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <BreworxMark size={38} />
          </div>
        )}

        <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 18, fontWeight: 500, color: "#2A3324", margin: "0 0 8px", textAlign: (step === 0 && showLogoOnFirst) || isLast ? "center" : "left" }}>
          {slide.title}
        </h2>
        <p style={{ color: "#5C6B54", fontSize: 13.5, lineHeight: 1.5, margin: "0 0 18px", textAlign: (step === 0 && showLogoOnFirst) || isLast ? "center" : "left" }}>
          {slide.body}
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{ width: i === step ? 16 : 6, height: 6, borderRadius: 3, background: i === step ? "#5C9A3C" : "#DDE0C8", transition: "width 0.2s" }}
            />
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              style={{ flex: 1, background: "none", border: "1px solid #C9D1AC", borderRadius: 5, padding: "10px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 13, cursor: "pointer" }}
            >
              Back
            </button>
          )}
          <button
            onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
            style={{ flex: step > 0 ? 1 : "unset", width: step === 0 ? "100%" : "auto", background: "#5C9A3C", border: "none", borderRadius: 5, padding: "10px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 13.5, cursor: "pointer" }}
          >
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
        {!isLast && (
          <button
            onClick={onClose}
            style={{ display: "block", margin: "12px auto 0", background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif" }}
          >
            Skip tour
          </button>
        )}
      </div>
    </>
  );
}


export function HelpGuideModal({ onClose, articles = HELP_ARTICLES }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = articles.filter(
    (a) => !q || a.question.toLowerCase().includes(q) || a.answer.toLowerCase().includes(q) || a.category.toLowerCase().includes(q)
  );
  const categories = [...new Set(filtered.map((a) => a.category))];

  return (
    <Modal title="Help guide" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for how to do something…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 5,
            padding: "10px 12px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 14,
          }}
        />
        {filtered.length === 0 && (
          <div style={{ color: "#9BA88A", fontSize: 13, padding: "12px 4px" }}>No matches for "{query}".</div>
        )}
        {categories.map((cat) => (
          <div key={cat}>
            <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>
              {cat}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {filtered
                .filter((a) => a.category === cat)
                .map((a, i) => (
                  <details key={i} style={{ background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "10px 12px" }}>
                    <summary style={{ cursor: "pointer", color: "#2A3324", fontSize: 13.5, fontFamily: "'Inter', sans-serif" }}>
                      {a.question}
                    </summary>
                    <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5, marginTop: 8 }}>{a.answer}</div>
                  </details>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// A simple chat over the app's own Help Guide content — the Edge
// Function grounds every answer in HELP_ARTICLES, so it can't confidently
// invent a feature that doesn't exist. No conversation history is saved
// between visits; it's meant as a quick, in-the-moment question, not a
// running assistant.
export function AiHelperModal({ messages, setMessages, onClose, onAsk, onFlag }) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [flaggedIndices, setFlaggedIndices] = useState(() => new Set());
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setSending(true);
    const result = await onAsk(nextMessages);
    setSending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
  };

  const flagAnswer = async (index) => {
    const question = messages[index - 1]?.content || "";
    const answer = messages[index].content;
    const succeeded = await onFlag(question, answer);
    if (succeeded) setFlaggedIndices((prev) => new Set(prev).add(index));
  };

  return (
    <Modal title="Ask AI" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div style={{ color: "#9BA88A", fontSize: 12, lineHeight: 1.5 }}>
            Answers questions about how to use Brewpoint, grounded in the same Help Guide content — not general brewing advice, and it can't see your actual data.
          </div>
          {messages.length > 0 && (
            <button
              onClick={() => setMessages([])}
              style={{ background: "none", border: "none", color: "#5C9A3C", fontSize: 11.5, fontFamily: "'Inter', sans-serif", cursor: "pointer", padding: 0, flexShrink: 0, whiteSpace: "nowrap" }}
            >
              New conversation
            </button>
          )}
        </div>
        <div ref={scrollRef} style={{ maxHeight: 340, minHeight: messages.length === 0 ? 0 : 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "85%",
                  background: m.role === "user" ? "#5C9A3C" : "#F5F1E4",
                  color: m.role === "user" ? "#16191A" : "#2A3324",
                  border: m.role === "user" ? "none" : "1px solid #DDE0C8",
                  borderRadius: 8,
                  padding: "9px 12px",
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content}
              </div>
              {m.role === "assistant" && (
                <button
                  onClick={() => flagAnswer(i)}
                  disabled={flaggedIndices.has(i)}
                  style={{
                    background: "none",
                    border: "none",
                    color: flaggedIndices.has(i) ? "#9BA88A" : "#B5502F",
                    fontSize: 11,
                    fontFamily: "'Inter', sans-serif",
                    cursor: flaggedIndices.has(i) ? "default" : "pointer",
                    padding: "3px 2px 0",
                  }}
                >
                  {flaggedIndices.has(i) ? "Flagged for review — thanks" : "Not helpful?"}
                </button>
              )}
            </div>
          ))}
          {sending && (
            <div style={{ alignSelf: "flex-start", color: "#9BA88A", fontSize: 12.5, padding: "9px 12px" }}>Thinking…</div>
          )}
        </div>
        {error && <div style={{ color: "#B5502F", fontSize: 12.5 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask how to do something…"
            style={{
              flex: 1,
              boxSizing: "border-box",
              background: "#F5F1E4",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "10px 12px",
              color: "#2A3324",
              fontFamily: "'Inter', sans-serif",
              fontSize: 14,
            }}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            style={{
              background: sending || !input.trim() ? "#E8E4D4" : "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "0 16px",
              color: sending || !input.trim() ? "#A3AC94" : "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13,
              cursor: sending || !input.trim() ? "default" : "pointer",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Owner-only review of everything flagged as unhelpful in Ask AI — each
// one is a real signal that the Help Guide is missing something, so this
// is what turns the feature into something that actually improves over
// time instead of staying frozen at whatever it launched with.
export function AiFeedbackReviewModal({ feedback, onClose, onDelete }) {
  return (
    <Modal title={`Flagged AI answers (${feedback.length})`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {feedback.length === 0 ? (
          <EmptyState icon={Sparkles} title="Nothing flagged yet" subtitle="When someone marks an Ask AI answer as unhelpful, it'll show up here so you can see what's missing from the Help Guide." />
        ) : (
          feedback.map((f) => (
            <div key={f.id} style={{ background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 6, padding: "12px" }}>
              <div style={{ color: "#2A3324", fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{f.question}</div>
              <div style={{ color: "#5C6B54", fontSize: 12.5, lineHeight: 1.5, marginBottom: 8, whiteSpace: "pre-wrap" }}>{f.answer}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#9BA88A", fontSize: 11 }}>
                  {f.userName ? `${f.userName} · ` : ""}
                  {f.createdAt ? new Date(f.createdAt).toLocaleDateString() : ""}
                </span>
                <button
                  onClick={() => onDelete(f.id)}
                  style={{ background: "none", border: "none", color: "#9BA88A", cursor: "pointer", fontSize: 11.5, padding: 0 }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

export const CHANGELOG = [
  {
    id: 1,
    title: "Production Manager & scheduling",
    items: [
      "Visual tank schedule — see every tank's timeline at a glance",
      "Schedule a batch ahead of time, with estimated days in tank",
      "Edit or delete a scheduled brew before it actually starts",
    ],
  },
  {
    id: 2,
    title: "Consumables & Package Types",
    items: [
      "Track cans, lids, boxes, and labels separately from ingredients",
      "Package Types automatically deduct the right consumables when you log packaging",
      "Undo a packaging run — reverts to Cooling and returns consumables to stock",
    ],
  },
  {
    id: 3,
    title: "Recipe Analytics & quality tracking",
    items: [
      "Compare batches of the same recipe side by side",
      "Quality fault checklist (diacetyl, oxidation, and more) with Low/Medium/High severity, tracked day by day",
      "Fault-free rate and trend charts per recipe",
    ],
  },
  {
    id: 4,
    title: "Navigation & mobile",
    items: [
      "Sidebar grouped into Production, Recipes, Stock, and Compliance",
      "Proper slide-out menu on phones and narrow screens",
    ],
  },
  {
    id: 5,
    title: "Export & display",
    items: [
      "CSV export for Inventory, Purchase Orders, and Batches",
      "Adjustable text size in Settings",
      "This changelog, so you don't have to go digging for what's changed",
    ],
  },
  {
    id: 6,
    title: "Sales, Orders & Xero invoicing",
    items: [
      "Customers and Orders — track wholesale accounts and what's owed to them",
      "Live available-to-sell stock, worked out automatically from what's packaged minus what's sold",
      "Link a customer to Xero (or create them fresh) and invoices send automatically once an order's fulfilled",
      "Sales & Orders is a genuinely optional module now — turn it off in Settings if you don't need it",
    ],
  },
  {
    id: 7,
    title: "Food Safety audit suite",
    items: [
      "Every checklist and calibration now records who completed it",
      "A failed checklist item requires a corrective action — tracked as open until it's marked resolved",
      "A \"Needs attention\" dashboard right on Food Safety — overdue checklists, overdue calibrations, open corrective actions",
      "Export a clean, print-ready audit report for any date range",
    ],
  },
  {
    id: 8,
    title: "Reminders & Finished Stock",
    items: [
      "A Reminders row on the Production calendar — add a task to any day, check it off, color-coded by who added it",
      "Today's reminders now show right on Home, with a quick way to add one",
      "A dedicated Stock page for finished goods, with its own stock take",
    ],
  },
  {
    id: 9,
    title: "Barrel & Aging",
    items: [
      "Two new vessel types — Barrel and Aging Tank, with a barrel's previous contents tracked (bourbon, wine, sherry, virgin oak, and more)",
      "Move a batch into aging from Primary, Brite Tank, or straight from the kettle",
      "A dedicated Aging page with its own hand-drawn barrel and tank visuals — separate from Home and the Production calendar, since this can run for months or years",
      "A real tasting log — pick from actual barrel-aging flavors and off-flavors, or write a free-text note",
      "Genuinely optional — turn it off in Settings if you don't run a barrel or long-term aging program",
    ],
  },
  {
    id: 10,
    title: "Real customer logins",
    items: [
      "Customers can now order online with their own email and password, not a link that can get lost",
      "One shared page to log in, with self-service password reset built in",
      "Set up from any customer's page — send a one-time link for them to set their password, or resend it any time",
    ],
  },
  {
    id: 11,
    title: "Smarter ingredients",
    items: [
      "Rename any item in Inventory, Consumables, or Package Types after the fact — typos don't have to be permanent",
      "Typing a recipe now suggests similar existing ingredients (different spelling, extra words) before offering to add something new",
      "Saving a recipe with new ingredients now lets you match each one to something similar already in stock, instead of just adding duplicates",
      "BeerXML imports now auto-fill potential, color, alpha acid, and attenuation from the reference library where a match is found",
    ],
  },
  {
    id: 12,
    title: "Tank settings & daily logs",
    items: [
      "Set and log a tank's target temperature and pressure (PSI or Bar, with the conversion shown alongside)",
      "Hop and yeast dump checkboxes now log who did it and when, and reset themselves so they're ready to log again the same day",
      "Barrels can log volume top-ups, for tracking evaporation loss over a long aging stint",
    ],
  },
  {
    id: 13,
    title: "Yeast reuse",
    items: [
      "Harvest yeast from any fermenting or conditioning batch — generation tracked automatically",
      "A dedicated Yeast page shows what's available to repitch, grouped by strain and generation",
      "Starting a new batch lets you pitch a harvested strain instead of fresh — closing the loop on generation tracking",
    ],
  },
  {
    id: 14,
    title: "Mixed packs",
    items: [
      "Build a variety pack from beers already in stock — fixed recipe, or put together fresh each time",
      "Assembling one deducts real stock from each beer it contains and gives the pack its own stock and price",
      "Sellable through Orders alongside your regular beers",
    ],
  },
];
export const LATEST_CHANGELOG_ID = CHANGELOG[CHANGELOG.length - 1].id;

export function WhatsNewModal({ onClose, entries }) {
  return (
    <Modal title="What's new" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {entries.map((entry) => (
          <div key={entry.id}>
            <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, color: "#2A3324", marginBottom: 8 }}>
              {entry.title}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
              {entry.items.map((item, i) => (
                <li key={i} style={{ color: "#5C6B54", fontSize: 13, lineHeight: 1.5 }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          onClick={onClose}
          style={{
            background: "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
