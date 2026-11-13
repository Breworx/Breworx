// Xero invoices as Brewpoint sales orders. Every invoice raised straight in
// Xero (not one Brewpoint sent) becomes a read-only "Fulfilled" order, so
// customer pages, sales analytics, recalls and the auditor all see the
// same sales. The batch on each line comes from the stock that sale took
// (batch.xeroSold) or the history tracing (batch.salesHistory), matched by
// Xero line id. These orders never move stock themselves — the Xero sync
// already did that — so soldTotalsByContainer skips them.
import { CONTAINERS, productKeyFor } from "./production";

const norm = (s) => String(s || "").trim().toLowerCase();

export function planXeroOrders({ docs, batches, salesMap, itemMappings, customers, brewpointOrderNumbers }) {
  const mapByCode = {};
  (salesMap || []).forEach((m) => (mapByCode[norm(m.xero_item_code)] = m));
  const resolve = (code) => {
    const m = mapByCode[norm(code)];
    if (m) {
      if (m.ignore) return { ignore: true };
      if (m.product_key) return { beerName: m.beer_name || m.product_key.split("::")[0], containerKey: m.container_key || m.product_key.split("::")[1], units: Number(m.units_per_xero_unit) || 1, code: m.xero_item_code };
    }
    const fm = (itemMappings || []).find((x) => norm(x.xero_item_code) === norm(code));
    if (fm) return { beerName: fm.product_key.split("::")[0], containerKey: fm.product_key.split("::")[1], units: 1, code: fm.xero_item_code };
    return null;
  };
  const ownOrders = new Set((brewpointOrderNumbers || []).map(norm).filter(Boolean));

  // Xero line id -> [{ batch, containerKey, qty }]
  const byLine = {};
  (batches || []).forEach((b) =>
    [...(b.xeroSold || []), ...(b.salesHistory || [])].forEach((e) => {
      if (!e.lineId || !(Number(e.qty) > 0)) return;
      (byLine[e.lineId] = byLine[e.lineId] || []).push({ batch: b, containerKey: e.containerKey, qty: Number(e.qty) });
    })
  );

  const customerByXeroId = {};
  const customerByName = {};
  (customers || []).forEach((c) => {
    if (c.xeroContactId) customerByXeroId[c.xeroContactId] = c;
    customerByName[norm(c.name)] = c;
    if (c.xeroContactName) customerByName[norm(c.xeroContactName)] = c;
  });

  const orders = [];
  const removeDocIds = [];
  const newContacts = {};
  (docs || []).forEach((doc) => {
    if (doc.docType !== "invoice") return;
    const draft = doc.status === "DRAFT" || doc.status === "SUBMITTED";
    if (!draft && doc.status !== "AUTHORISED" && doc.status !== "PAID") { removeDocIds.push(doc.docId); return; }
    if (doc.reference && ownOrders.has(norm(doc.reference))) return;
    const inclusive = doc.lineAmountTypes === "Inclusive";
    const lines = [];
    doc.lines.forEach((line) => {
      const map = resolve(line.itemCode);
      if (!map || map.ignore) return;
      const units = Math.round(Math.abs(line.qty) * map.units);
      if (units <= 0) return;
      const exGst = inclusive ? (Number(line.lineAmount) || 0) - (Number(line.taxAmount) || 0) : Number(line.lineAmount) || (Number(line.unitAmount) || 0) * line.qty;
      const unitPrice = Math.round((exGst / units) * 10000) / 10000;
      const containerLabel = CONTAINERS.find((c) => c.key === map.containerKey)?.label || map.containerKey;
      if (draft) {
        // Not sold yet: no batch on the line. Stock is held for it (and any
        // shortfall shown as a back order) by allocateDraftOrders.
        lines.push({ id: line.lineId, batchId: null, batchName: map.beerName, batchNumber: "", productKey: productKeyFor(map.beerName, map.containerKey), containerKey: map.containerKey, containerLabel, qty: units, fulfilledQty: 0, unitPrice, xeroLineId: line.lineId, xeroItemCode: map.code });
        return;
      }
      let left = units;
      (byLine[line.lineId] || [])
        .filter((a) => a.containerKey === map.containerKey)
        .forEach((a, i) => {
          const qty = Math.min(left, a.qty);
          if (qty <= 0) return;
          left -= qty;
          lines.push({ id: `${line.lineId}-${i}`, batchId: a.batch.id, batchName: a.batch.name, batchNumber: a.batch.number || "", containerKey: map.containerKey, containerLabel, qty, fulfilledQty: qty, unitPrice, xeroLineId: line.lineId, xeroItemCode: map.code });
        });
      if (left > 0) {
        lines.push({ id: `${line.lineId}-x`, batchId: null, batchName: map.beerName, batchNumber: "", containerKey: map.containerKey, containerLabel, qty: left, fulfilledQty: left, unitPrice, xeroLineId: line.lineId, xeroItemCode: map.code, noBatch: true });
      }
    });
    if (!lines.length) return;
    const customer = customerByXeroId[doc.contactId] || customerByName[norm(doc.contactName)];
    if (!customer && doc.contactId) newContacts[doc.contactId] = doc.contactName || "Xero customer";
    orders.push({
      xeroDocId: doc.docId,
      orderNumber: doc.number || "Xero invoice",
      orderDate: doc.date,
      status: draft ? "Confirmed" : "Fulfilled",
      paid: doc.status === "PAID",
      source: "xero",
      customerId: customer ? customer.id : null,
      contactId: doc.contactId,
      contactName: doc.contactName,
      notes: `${draft ? "Draft in Xero" : "From Xero"}${doc.reference ? ` · ref ${doc.reference}` : ""}`,
      lines,
    });
  });
  return { orders, removeDocIds, newContacts: Object.entries(newContacts).map(([contactId, name]) => ({ contactId, name })) };
}
