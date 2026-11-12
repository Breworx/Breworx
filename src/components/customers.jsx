import { useState, useEffect } from "react";
import { ChevronLeft, CheckCircle2, Users } from "lucide-react";
import { supabase } from "../supabaseClient";
import { rowToBatch, rowToCustomerPrice, rowToSalesOrder } from "../lib/mappers";
import { BrewpointLoadingMark, EmptyState, Modal, SelectField, TextField } from "./ui";
import { CONTAINERS, availableStockList } from "../lib/production";

export const CUSTOMER_TYPES = ["Wholesale", "Taproom", "Direct-to-consumer"];

export function CustomerFormModal({ customer, onClose, onSave }) {
  const [name, setName] = useState(customer ? customer.name : "");
  const [type, setType] = useState(customer ? customer.type || "Wholesale" : "Wholesale");
  const [contactName, setContactName] = useState(customer ? customer.contactName || "" : "");
  const [phone, setPhone] = useState(customer ? customer.phone || "" : "");
  const [email, setEmail] = useState(customer ? customer.email || "" : "");
  const [address, setAddress] = useState(customer ? customer.address || "" : "");
  const [paymentTerms, setPaymentTerms] = useState(customer ? customer.paymentTerms || "" : "");
  const [notes, setNotes] = useState(customer ? customer.notes || "" : "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      type,
      contactName: contactName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      paymentTerms: paymentTerms.trim(),
      notes: notes.trim(),
    });
    setSaving(false);
    onClose();
  };

  return (
    <Modal title={customer ? "Edit customer" : "New customer"} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TextField label="Customer / business name" value={name} onChange={setName} />
        <SelectField label="Type" value={type} onChange={setType} options={CUSTOMER_TYPES} />
        <TextField label="Contact name (optional)" value={contactName} onChange={setContactName} />
        <TextField label="Phone (optional)" value={phone} onChange={setPhone} />
        <TextField label="Email (optional)" value={email} onChange={setEmail} />
        <TextField label="Address (optional)" value={address} onChange={setAddress} />
        <TextField label="Payment terms (optional)" value={paymentTerms} onChange={setPaymentTerms} placeholder="e.g. Net 30" />
        <TextField label="Notes (optional)" value={notes} onChange={setNotes} />
        <button
          onClick={submit}
          disabled={saving}
          style={{
            background: saving ? "#E8E4D4" : "#5C9A3C",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: saving ? "#A3AC94" : "#16191A",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : customer ? "Save changes" : "Add customer"}
        </button>
      </div>
    </Modal>
  );
}

export const CUSTOMER_TYPE_COLOR = {
  Wholesale: "#5C9A3C",
  Taproom: "#D9A441",
  "Direct-to-consumer": "#4AA8C9",
};

export function CustomerCard({ customer, onOpen }) {
  const color = CUSTOMER_TYPE_COLOR[customer.type] || "#9BA88A";
  return (
    <button
      onClick={() => onOpen(customer.id)}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        background: "#FFFFFF",
        border: "1px solid #DDE0C8",
        borderRadius: 6,
        padding: "14px 16px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h3 style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 16, color: "#2A3324", margin: "0 0 3px" }}>
          {customer.name}
        </h3>
        <span style={{ color: "#9BA88A", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
          {customer.contactName || customer.email || customer.phone || "No contact details yet"}
        </span>
      </div>
      <span
        style={{
          flexShrink: 0,
          background: `${color}1A`,
          border: `1px solid ${color}`,
          borderRadius: 20,
          padding: "3px 10px",
          color,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        {customer.type}
      </span>
    </button>
  );
}

export function CustomersView({ customers, onOpen, onImportXero }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.contactName || "").toLowerCase().includes(q))
    : customers;

  return (
    <div>
      {onImportXero && (
        <button
          onClick={onImportXero}
          style={{ background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12, fontFamily: "'Inter', sans-serif", padding: 0, marginBottom: 10, display: "block" }}
        >
          Import customers from Xero
        </button>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search customers by name or contact…"
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
          marginBottom: 16,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((c) => (
          <CustomerCard key={c.id} customer={c} onOpen={onOpen} />
        ))}
      </div>
      {customers.length === 0 && (
        <EmptyState
          icon={Users}
          title="No customers yet"
          subtitle="Add the businesses you sell to — wholesale accounts, bars, bottle shops — so you can start tracking orders against them."
        />
      )}
      {customers.length > 0 && filtered.length === 0 && (
        <div style={{ color: "#9BA88A", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No customers match "{query}".</div>
      )}
    </div>
  );
}

// Same product-key format used for Xero item mapping (beer name + container,
// lowercased) — reused here so a price set once lines up correctly with
// every batch of that same beer, not just the specific batch in stock today.
export const priceProductKey = (batchName, containerKey) => `${batchName.trim().toLowerCase()}::${containerKey}`;

export function CustomerPriceList({ customer, availableStock, customerPrices, onSavePrice }) {
  const seen = new Set();
  const products = [];
  availableStock.forEach((s) => {
    const key = priceProductKey(s.batchName, s.containerKey);
    if (seen.has(key)) return;
    seen.add(key);
    products.push({ key, label: `${s.batchName} — ${s.containerLabel}` });
  });
  products.sort((a, b) => a.label.localeCompare(b.label));

  const [drafts, setDrafts] = useState({});

  const priceFor = (key) => {
    if (drafts[key] !== undefined) return drafts[key];
    const existing = customerPrices.find((p) => p.customerId === customer.id && p.productKey === key);
    return existing ? String(existing.unitPrice) : "";
  };

  const commit = (key) => {
    const value = drafts[key];
    if (value === undefined) return;
    const num = Number(value);
    if (!isNaN(num) && num >= 0) onSavePrice(customer.id, key, num);
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 10 }}>
        Prices for {customer.name}
      </div>
      {products.length === 0 ? (
        <div style={{ color: "#9BA88A", fontSize: 13 }}>Nothing packaged yet — prices can be set once there's stock to sell.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {products.map((p) => (
            <div key={p.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 5 }}>
              <span style={{ color: "#2A3324", fontSize: 13 }}>{p.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <span style={{ color: "#9BA88A", fontSize: 13 }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceFor(p.key)}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [p.key]: e.target.value }))}
                  onBlur={() => commit(p.key)}
                  placeholder="0.00"
                  style={{ width: 72, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "6px 8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textAlign: "right" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomerDetail({ customer, onBack, onEdit, onDelete, xeroConnected, onLinkXero, onUnlinkXero, availableStock, customerPrices, onSavePrice, onGeneratePortalLink, onInviteToOrderOnline, batches, salesOrders, onOpenBatch }) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState(customer.email || "");
  const [inviteLink, setInviteLink] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [resendError, setResendError] = useState(null);
  const color = CUSTOMER_TYPE_COLOR[customer.type] || "#9BA88A";
  return (
    <div>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "#5C6B54",
          cursor: "pointer",
          fontFamily: "'Inter', sans-serif",
          fontSize: 13,
          padding: 0,
          marginBottom: 18,
        }}
      >
        <ChevronLeft size={16} /> All customers
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0 }}>{customer.name}</h1>
      </div>
      <span
        style={{
          display: "inline-block",
          background: `${color}1A`,
          border: `1px solid ${color}`,
          borderRadius: 20,
          padding: "3px 10px",
          color,
          fontFamily: "'Inter', sans-serif",
          fontSize: 11,
          fontWeight: 500,
          marginBottom: 20,
        }}
      >
        {customer.type}
      </span>

      <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "16px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {customer.contactName && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Contact: </span>{customer.contactName}</div>
        )}
        {customer.phone && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Phone: </span>{customer.phone}</div>
        )}
        {customer.email && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Email: </span>{customer.email}</div>
        )}
        {customer.address && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Address: </span>{customer.address}</div>
        )}
        {customer.paymentTerms && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Payment terms: </span>{customer.paymentTerms}</div>
        )}
        {customer.notes && (
          <div style={{ fontSize: 13.5, color: "#2A3324" }}><span style={{ color: "#9BA88A" }}>Notes: </span>{customer.notes}</div>
        )}
        {!customer.contactName && !customer.phone && !customer.email && !customer.address && !customer.paymentTerms && !customer.notes && (
          <div style={{ color: "#9BA88A", fontSize: 13 }}>No contact details added yet.</div>
        )}
      </div>

      {xeroConnected && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 3 }}>Xero</div>
            {customer.xeroContactId ? (
              <div style={{ fontSize: 13.5, color: "#2A3324" }}>Linked to <strong>{customer.xeroContactName}</strong></div>
            ) : (
              <div style={{ fontSize: 13.5, color: "#9BA88A" }}>Not linked — invoices won't send automatically until this is set up.</div>
            )}
          </div>
          {customer.xeroContactId ? (
            <button
              onClick={() => onUnlinkXero(customer.id)}
              style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "8px 12px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}
            >
              Unlink
            </button>
          ) : (
            <button
              onClick={() => onLinkXero(customer)}
              style={{ background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer", flexShrink: 0 }}
            >
              Link to Xero
            </button>
          )}
        </div>
      )}

      <div style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "14px 16px", marginBottom: 20 }}>
        <div style={{ fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "#9BA88A", marginBottom: 8 }}>Online ordering</div>
        {customer.authUserId ? (
          <>
            <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 10 }}>
              Account set up — {customer.name} can order anytime at{" "}
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#2A3324" }}>{window.location.origin}/order</span>
            </div>
            {!inviteLink && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Their email address"
                    style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
                  />
                  <button
                    onClick={async () => {
                      const emailToUse = inviteEmail.trim() || customer.email;
                      if (!emailToUse) {
                        setResendError("Add an email address above first.");
                        return;
                      }
                      setResendError(null);
                      setInviting(true);
                      try {
                        const link = await onInviteToOrderOnline(customer.id, emailToUse);
                        if (link) setInviteLink(link);
                      } finally {
                        setInviting(false);
                      }
                    }}
                    disabled={inviting}
                    style={{ flexShrink: 0, background: "none", border: "1px solid #DDE0C8", borderRadius: 5, padding: "8px 14px", color: "#5C6B54", fontFamily: "'Inter', sans-serif", fontSize: 12, cursor: inviting ? "default" : "pointer" }}
                  >
                    {inviting ? "Sending…" : "Resend setup link"}
                  </button>
                </div>
                {resendError && <div style={{ color: "#B5502F", fontSize: 12, marginBottom: 8 }}>{resendError}</div>}
              </>
            )}
            {inviteLink && (
              <>
                <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 6 }}>
                  Send this fresh link to {customer.name} so they can get in:
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    readOnly
                    value={inviteLink}
                    onClick={(e) => e.target.select()}
                    style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(inviteLink);
                      setInviteLinkCopied(true);
                      setTimeout(() => setInviteLinkCopied(false), 2000);
                    }}
                    style={{ flexShrink: 0, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                  >
                    {inviteLinkCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div style={{ color: "#5C6B54", fontSize: 12.5, marginBottom: 10 }}>
              Give {customer.name} their own login — they'll set a password once, then just log in themselves from then on, no link to keep track of.
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Their email address"
                style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 13 }}
              />
              <button
                onClick={async () => {
                  if (!inviteEmail.trim()) return;
                  setInviting(true);
                  try {
                    const link = await onInviteToOrderOnline(customer.id, inviteEmail.trim());
                    if (link) setInviteLink(link);
                  } finally {
                    setInviting(false);
                  }
                }}
                disabled={inviting || !inviteEmail.trim()}
                style={{ flexShrink: 0, background: inviting ? "#E8E4D4" : "#5C9A3C", border: "none", borderRadius: 5, padding: "8px 14px", color: inviting ? "#A3AC94" : "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 12.5, cursor: inviting ? "default" : "pointer" }}
              >
                {inviting ? "Creating…" : "Create login"}
              </button>
            </div>
            {inviteLink && (
              <>
                <div style={{ color: "#5C6B54", fontSize: 12, marginBottom: 6 }}>
                  Send this one-time link to {customer.name} — it lets them set their own password:
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    readOnly
                    value={inviteLink}
                    onClick={(e) => e.target.select()}
                    style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(inviteLink);
                      setInviteLinkCopied(true);
                      setTimeout(() => setInviteLinkCopied(false), 2000);
                    }}
                    style={{ flexShrink: 0, background: "#EBE8D6", border: "1px solid #C9D1AC", borderRadius: 5, padding: "8px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 12.5, cursor: "pointer" }}
                  >
                    {inviteLinkCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {availableStock && (
        <CustomerPriceList customer={customer} availableStock={availableStock} customerPrices={customerPrices} onSavePrice={onSavePrice} />
      )}

      <CustomerPurchases customer={customer} batches={batches || []} salesOrders={salesOrders || []} onOpenBatch={onOpenBatch} />

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={onEdit}
          style={{
            flex: 1,
            background: "#EBE8D6",
            border: "1px solid #C9D1AC",
            borderRadius: 5,
            padding: "11px",
            color: "#2A3324",
            fontFamily: "'Inter', sans-serif",
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          Edit customer
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            style={{
              background: "none",
              border: "1px solid #DDE0C8",
              borderRadius: 5,
              padding: "11px 16px",
              color: "#B5502F",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Catches any render-time crash and shows the actual error instead of a
// blank white screen — critical for diagnosing issues on iPad, where
// there's no easy way to open dev tools and see what actually happened.
// Talks to the customer-portal Edge Function directly — no auth session,
// no profile, just the token from the URL. This is the one place in the
// whole app that legitimately has no signed-in user behind it.
export async function callPortalApi(action, credential, extra) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${supabaseUrl}/functions/v1/quick-endpoint`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey },
    body: JSON.stringify({ action, ...credential, ...extra }),
  });
  return res.json();
}

// The public, no-login ordering page — this is what a customer actually
// sees once they're in. Deliberately kept separate from the main app
// shell: no sidebar, no other company's data ever in reach, nothing that
// assumes a signed-in brewery staff member. `credential` is either
// {token: "..."} for the older link-based route, or {customerJwt: "..."}
// for a real logged-in session — the API treats them the same way.
export function CustomerPortalPage({ credential }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [company, setCompany] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [stock, setStock] = useState([]);
  const [prices, setPrices] = useState([]);
  const [cart, setCart] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [orderNumber, setOrderNumber] = useState(null);

  useEffect(() => {
    (async () => {
      const data = await callPortalApi("getCatalog", credential);
      if (data.error) {
        setError(data.error);
        setLoading(false);
        return;
      }
      setCompany(data.company);
      setCustomerName(data.customer.name);
      const batches = (data.batches || []).map(rowToBatch);
      const salesOrders = (data.salesOrders || []).map(rowToSalesOrder);
      setStock(availableStockList(batches, salesOrders));
      setPrices((data.prices || []).map(rowToCustomerPrice));
      setLoading(false);
    })();
  }, [credential?.token, credential?.customerJwt]);

  const products = {};
  stock
    .filter((s) => s.available > 0)
    .forEach((s) => {
      const key = priceProductKey(s.batchName, s.containerKey);
      const price = prices.find((p) => p.productKey === key);
      if (!products[key]) {
        products[key] = { key, label: `${s.batchName} — ${s.containerLabel}`, available: 0, price: price ? price.unitPrice : null, batchId: s.batchId, containerKey: s.containerKey, containerLabel: s.containerLabel, batchName: s.batchName };
      }
      products[key].available += s.available;
    });
  const productList = Object.values(products).sort((a, b) => a.label.localeCompare(b.label));

  const cartLines = Object.entries(cart)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([key, qty]) => ({ ...products[key], qty: Number(qty) }));
  const total = cartLines.reduce((sum, l) => sum + l.qty * (l.price || 0), 0);

  const submit = async () => {
    if (cartLines.length === 0) return;
    setSubmitting(true);
    const lines = cartLines.map((l) => ({
      id: crypto.randomUUID(),
      batchId: l.batchId,
      batchName: l.batchName,
      containerKey: l.containerKey,
      containerLabel: l.containerLabel,
      qty: l.qty,
      unitPrice: l.price || 0,
    }));
    const result = await callPortalApi("submitOrder", credential, { lines });
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOrderNumber(result.orderNumber);
    setCart({});
  };

  const pageStyle = { minHeight: "100vh", background: "#F5F1E4", fontFamily: "'Inter', sans-serif" };

  if (loading) {
    return (
      <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <BrewpointLoadingMark size={52} label="Loading…" />
      </div>
    );
  }

  if (error && !company) {
    return (
      <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <div style={{ color: "#5C6B54", fontSize: 15 }}>{error}</div>
      </div>
    );
  }

  if (orderNumber) {
    return (
      <div style={{ ...pageStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", gap: 10 }}>
        <CheckCircle2 size={40} color="#5C9A3C" />
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: 0 }}>Order sent</h1>
        <div style={{ color: "#5C6B54", fontSize: 14 }}>
          {orderNumber} — {company?.name} has it now and will be in touch.
        </div>
        <button
          onClick={() => setOrderNumber(null)}
          style={{ marginTop: 12, background: "#5C9A3C", border: "none", borderRadius: 5, padding: "10px 20px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14, cursor: "pointer" }}
        >
          Place another order
        </button>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 20px 100px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          {company?.logo_url ? (
            <img src={company.logo_url} alt={company.name} style={{ maxHeight: 48, maxWidth: 160, objectFit: "contain" }} />
          ) : (
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: 0 }}>{company?.name}</h1>
          )}
        </div>
        <div style={{ color: "#5C6B54", fontSize: 13.5, marginBottom: 24 }}>Ordering as {customerName}</div>

        {error && (
          <div style={{ background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 6, padding: "10px 12px", color: "#7A3E1D", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {productList.length === 0 ? (
          <div style={{ color: "#9BA88A", fontSize: 14, textAlign: "center", padding: "40px 0" }}>Nothing available to order right now — check back soon.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {productList.map((p) => (
              <div key={p.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, color: "#2A3324" }}>{p.label}</div>
                  <div style={{ color: "#9BA88A", fontSize: 12 }}>
                    {p.price != null ? `$${p.price.toFixed(2)} each` : "Contact brewery for pricing"} · {p.available} available
                  </div>
                </div>
                {p.price != null && (
                  <input
                    type="number"
                    min="0"
                    max={p.available}
                    step="1"
                    value={cart[p.key] || ""}
                    onChange={(e) => setCart((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    placeholder="0"
                    style={{ width: 60, boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "8px", color: "#2A3324", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textAlign: "center", flexShrink: 0 }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {cartLines.length > 0 && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#FFFFFF", borderTop: "1px solid #DDE0C8", padding: "14px 20px", boxShadow: "0 -4px 16px rgba(0,0,0,0.08)" }}>
          <div style={{ maxWidth: 560, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ color: "#9BA88A", fontSize: 11.5 }}>{cartLines.length} item{cartLines.length !== 1 ? "s" : ""}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 17, color: "#2A3324" }}>${total.toFixed(2)}</div>
            </div>
            <button
              onClick={submit}
              disabled={submitting}
              style={{
                background: submitting ? "#E8E4D4" : "#5C9A3C",
                border: "none",
                borderRadius: 6,
                padding: "13px 26px",
                color: submitting ? "#A3AC94" : "#16191A",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 15,
                cursor: submitting ? "default" : "pointer",
              }}
            >
              {submitting ? "Sending…" : "Place order"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The shared /order page — no token in the URL, just a normal login. Also
// doubles as the "set your password" step right after someone clicks their
// one-time invite link, since Supabase quietly turns that into a real
// session before this even mounts; the URL's leftover type=invite/recovery
// marker is what tells this to ask for a password instead of skipping
// straight to the catalog.
export function CustomerAccountFlow() {
  const [phase, setPhase] = useState("loading");
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      // Supabase can hand off an invite/recovery link one of two ways
      // depending on project settings — older-style tokens in the URL
      // hash, or a "code" in the query string that needs exchanging for a
      // session explicitly. Check for both rather than assume one.
      const hadAuthParams = /access_token=|type=invite|type=recovery/.test(window.location.hash) || /[?&]code=/.test(window.location.search);
      if (window.location.search.includes("code=")) {
        await supabase.auth.exchangeCodeForSession(window.location.href);
      }
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        setSession(data.session);
        setPhase(hadAuthParams ? "setPassword" : "ready");
      } else {
        setPhase("login");
      }
    })();
  }, []);

  const doLogin = async () => {
    setError(null);
    setBusy(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError("Email or password didn't match — try again.");
      return;
    }
    setSession(data.session);
    setPhase("ready");
  };

  const doSetPassword = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError("Couldn't set your password — try again.");
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    setPhase("ready");
  };

  const pageStyle = { minHeight: "100vh", background: "#F5F1E4", fontFamily: "'Inter', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
  const cardStyle = { width: "100%", maxWidth: 360, background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 10, padding: "28px 24px", boxSizing: "border-box" };
  const inputStyle = { width: "100%", boxSizing: "border-box", background: "#F5F1E4", border: "1px solid #DDE0C8", borderRadius: 5, padding: "10px 12px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14, marginBottom: 10 };
  const buttonStyle = (disabled) => ({ width: "100%", background: disabled ? "#E8E4D4" : "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: disabled ? "#A3AC94" : "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 14.5, cursor: disabled ? "default" : "pointer" });
  const errorBox = <div style={{ background: "#FBE5D2", border: "1px solid #E3B37A", borderRadius: 5, padding: "8px 10px", color: "#7A3E1D", fontSize: 12.5, marginBottom: 10 }}>{error}</div>;

  if (phase === "loading") {
    return (
      <div style={pageStyle}>
        <BrewpointLoadingMark size={52} label="Loading…" />
      </div>
    );
  }

  if (phase === "ready") {
    return <CustomerPortalPage credential={{ customerJwt: session.access_token }} />;
  }

  if (phase === "setPassword") {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 19, color: "#2A3324", margin: "0 0 6px" }}>Set your password</h1>
          <p style={{ color: "#5C6B54", fontSize: 13, margin: "0 0 18px" }}>One quick step, then you're in.</p>
          {error && errorBox}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" style={inputStyle} />
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" style={inputStyle} />
          <button onClick={doSetPassword} disabled={busy} style={buttonStyle(busy)}>
            {busy ? "Saving…" : "Set password & continue"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 19, color: "#2A3324", margin: "0 0 18px" }}>Order online</h1>
        {error && errorBox}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" style={inputStyle} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" style={inputStyle} />
        <button onClick={doLogin} disabled={busy} style={buttonStyle(busy)}>
          {busy ? "Signing in…" : "Log in"}
        </button>
        <button
          onClick={async () => {
            if (!email.trim()) {
              setError("Enter your email first, then tap this again.");
              return;
            }
            setBusy(true);
            const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/order` });
            setBusy(false);
            setError(err ? "Couldn't send that — try again." : "Check your email for a reset link.");
          }}
          style={{ marginTop: 10, background: "none", border: "none", color: "#5C9A3C", cursor: "pointer", fontSize: 12.5, fontFamily: "'Inter', sans-serif", padding: 0, display: "block", marginLeft: "auto", marginRight: "auto" }}
        >
          Forgot password?
        </button>
      </div>
    </div>
  );
}

// Everything this customer has bought, one row per invoice or order, with
// the batch each line came from — built from the Xero sales traced to
// batches plus Brewpoint's own orders.
const qtyText = (key, n) => {
  const c = CONTAINERS.find((x) => x.key === key);
  if (key === "cans330") return n % 24 === 0 ? `${n / 24} case${n / 24 === 1 ? "" : "s"}` : `${n} cans`;
  return `${n} × ${c?.shortLabel || key}`;
};

export function CustomerPurchases({ customer, batches, salesOrders, onOpenBatch }) {
  const [showAll, setShowAll] = useState(false);
  const norm = (n) => String(n || "").trim().toLowerCase();
  const names = new Set([norm(customer.name), norm(customer.xeroContactName)].filter(Boolean));
  const docs = {};
  batches.forEach((b) =>
    [...(b.xeroSold || []), ...(b.salesHistory || [])].forEach((e) => {
      if (!names.has(norm(e.customer)) || !Number(e.qty)) return;
      const key = `x:${e.docNumber || e.date}`;
      if (!docs[key]) docs[key] = { key, date: e.date, ref: e.docNumber ? `Xero ${e.docNumber}` : "Xero", lines: [] };
      docs[key].lines.push({ batch: b, containerKey: e.containerKey, qty: Number(e.qty) });
    })
  );
  salesOrders
    .filter((o) => o.customerId === customer.id && o.status !== "Draft" && o.status !== "Cancelled")
    .forEach((o) => {
      const key = `o:${o.id}`;
      docs[key] = {
        key,
        date: o.orderDate || o.createdAt || "",
        ref: o.orderNumber ? `Order ${o.orderNumber}` : "Order",
        lines: (o.lines || []).map((l) => ({ batch: batches.find((b) => b.id === l.batchId), containerKey: l.containerKey, qty: Number(l.qty) || 0 })),
      };
    });
  const list = Object.values(docs).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const shown = showAll ? list : list.slice(0, 12);
  const litres = list.reduce((t, d) => t + d.lines.reduce((s2, l) => s2 + l.qty * (CONTAINERS.find((c) => c.key === l.containerKey)?.volumeL || 0), 0), 0);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54", marginBottom: 8 }}>
        What they've bought{list.length ? ` · ${list.length} invoice${list.length === 1 ? "" : "s"} · about ${Math.round(litres).toLocaleString("en-NZ")} L` : ""}
      </div>
      {list.length === 0 ? (
        <div style={{ color: "#9BA88A", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 6, padding: "12px 14px" }}>
          Nothing yet. Sales from Xero and Brewpoint orders show up here with the batch they came from.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map((d) => (
            <div key={d.key} style={{ background: "#FFFFFF", border: "1px solid #DDE0C8", borderRadius: 6, padding: "9px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#9BA88A", marginBottom: 4 }}>
                <span>{String(d.date).slice(0, 10)}</span>
                <span>{d.ref}</span>
              </div>
              {d.lines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "#2A3324", padding: "2px 0" }}>
                  <button
                    onClick={() => l.batch && onOpenBatch && onOpenBatch(l.batch.id)}
                    style={{ background: "none", border: "none", padding: 0, textAlign: "left", color: "#2A3324", fontSize: 13, cursor: l.batch && onOpenBatch ? "pointer" : "default", textDecoration: l.batch && onOpenBatch ? "underline dotted" : "none" }}
                  >
                    {l.batch ? `${l.batch.name}${l.batch.number ? ` #${l.batch.number}` : ""}` : "Batch not recorded"}
                  </button>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, whiteSpace: "nowrap", color: l.qty < 0 ? "#B5502F" : "#2A3324" }}>
                    {l.qty < 0 ? `${qtyText(l.containerKey, -l.qty)} credited` : qtyText(l.containerKey, l.qty)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {list.length > 12 && (
            <button onClick={() => setShowAll((v) => !v)} style={{ background: "none", border: "1px dashed #C9D1AC", borderRadius: 5, padding: "8px", color: "#5C6B54", fontSize: 12.5, cursor: "pointer" }}>
              {showAll ? "Show fewer" : `Show all ${list.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
