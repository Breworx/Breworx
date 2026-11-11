import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Plus, X, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { BP_TANK_PATH } from "../lib/production";
import { scrollFieldIntoView, today } from "../lib/utils";

export function BreworxMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <clipPath id="bp-tank-clip">
          <path d={BP_TANK_PATH} />
        </clipPath>
        <linearGradient id="bp-liquid-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7CB854" />
          <stop offset="100%" stopColor="#4A7D2E" />
        </linearGradient>
        <linearGradient id="bp-marker-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E8BE63" />
          <stop offset="100%" stopColor="#D4A24C" />
        </linearGradient>
      </defs>
      {/* Fermenter tank outline, softened shoulders */}
      <path d={BP_TANK_PATH} stroke="#5C9A3C" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
      {/* Liquid fill with gradient depth + glass highlight */}
      <g clipPath="url(#bp-tank-clip)">
        <rect x="7" y="15" width="24" height="21" fill="url(#bp-liquid-grad)" opacity="0.85" />
        <rect x="12.5" y="8" width="2.4" height="21" rx="1.2" fill="#FFFFFF" opacity="0.28" />
      </g>
      {/* Reading marker calling out the point on the tank */}
      <line x1="27.5" y1="15" x2="34" y2="9" stroke="url(#bp-marker-grad)" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="34" cy="9" r="2.6" fill="url(#bp-marker-grad)" />
      <circle cx="34" cy="9" r="5.4" stroke="#D4A24C" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

export function BrewpointLoadingMark({ size = 52, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 14 }}>
      <style>{`
        @keyframes bp-mark-spin { to { transform: rotate(360deg); } }
        @keyframes bp-mark-pulse { 0%, 100% { opacity: 0.22; } 50% { opacity: 0.55; } }
      `}</style>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <defs>
          <clipPath id="bp-loading-clip">
            <path d={BP_TANK_PATH} />
          </clipPath>
          <linearGradient id="bp-loading-liquid-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7CB854" />
            <stop offset="100%" stopColor="#4A7D2E" />
          </linearGradient>
          <linearGradient id="bp-loading-marker-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#E8BE63" />
            <stop offset="100%" stopColor="#D4A24C" />
          </linearGradient>
        </defs>
        <path d={BP_TANK_PATH} stroke="#5C9A3C" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round" />
        <g clipPath="url(#bp-loading-clip)">
          <rect x="7" y="15" width="24" height="21" fill="url(#bp-loading-liquid-grad)" style={{ animation: "bp-mark-pulse 1.6s ease-in-out infinite" }} />
        </g>
        <g style={{ transformOrigin: "19px 19px", animation: "bp-mark-spin 1.3s linear infinite" }}>
          <line x1="27.5" y1="15" x2="34" y2="9" stroke="url(#bp-loading-marker-grad)" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="34" cy="9" r="2.6" fill="url(#bp-loading-marker-grad)" />
          <circle cx="34" cy="9" r="5.4" stroke="#D4A24C" strokeWidth="1" opacity="0.4" />
        </g>
      </svg>
      {label && (
        <span style={{ color: "#9BA88A", fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em" }}>
          {label}
        </span>
      )}
    </div>
  );
}

// Card-shaped placeholders shown while the first data load is in flight —
// gives the screen its real shape immediately instead of a blank spinner.
export function SkeletonList({ count = 5 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <style>{`
        @keyframes bp-skeleton-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .bp-skeleton-block { animation: none !important; opacity: 0.7 !important; }
        }
      `}</style>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: "#FFFFFF",
            border: "1px solid #DDE0C8",
            borderRadius: 6,
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            className="bp-skeleton-block"
            style={{ width: 44, height: 44, borderRadius: 6, background: "#EBE8D6", flexShrink: 0, animation: "bp-skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
          />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              className="bp-skeleton-block"
              style={{ width: "42%", height: 13, borderRadius: 4, background: "#EBE8D6", animation: "bp-skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
            />
            <div
              className="bp-skeleton-block"
              style={{ width: "65%", height: 10, borderRadius: 4, background: "#EBE8D6", animation: "bp-skeleton-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.08}s` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// A large floating panel for long review lists (TSW import, clear stock).
// It stops short of the top and bottom of the screen so the buttons are
// never hidden behind the iPad's edge or home bar, and it's rendered
// straight onto the page so no surrounding layout can clip it.
export const SHEET_BACKDROP_STYLE = { position: "fixed", inset: 0, zIndex: 59, background: "rgba(10,12,11,0.6)" };
export const SHEET_PANEL_STYLE = {
  position: "fixed",
  zIndex: 60,
  top: "calc(28px + env(safe-area-inset-top))",
  bottom: "calc(28px + env(safe-area-inset-bottom))",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(680px, calc(100vw - 32px))",
  background: "#F8F5EA",
  border: "1px solid #DDE0C8",
  borderRadius: 12,
  boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

export function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F5F1E4",
          border: "1px solid #DDE0C8",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#2A3324",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function LockedField({ label, value, suffix }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA88A" }}>{label}</span>
      <div
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#EBE8D6",
          border: "1px solid #DDE0C8",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#5C6B54",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
        }}
      >
        {value ?? "—"}
        {suffix ? ` ${suffix}` : ""}
      </div>
    </div>
  );
}

export function NumberField({ label, value, onChange, step = "any", suffix }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            e.target.select();
            scrollFieldIntoView(e);
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#F5F1E4",
            border: "1px solid #DDE0C8",
            borderRadius: 4,
            padding: "9px 10px",
            color: "#2A3324",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 14,
          }}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 10, top: 9, color: "#9BA88A", fontSize: 12 }}>{suffix}</span>
        )}
      </div>
    </label>
  );
}

export function TextField({ label, value, onChange, type = "text" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={scrollFieldIntoView}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F5F1E4",
          border: "1px solid #DDE0C8",
          borderRadius: 4,
          padding: "9px 10px",
          color: "#2A3324",
          fontFamily: "'Inter', sans-serif",
          fontSize: 14,
        }}
      />
    </label>
  );
}

// Shared "when did this happen" field. Defaults to today; lets the user
// pick an earlier date to record something they forgot or ran out of time
// for. Future dates are blocked here (scheduling has its own flows).
export function BackdateField({ value, onChange, label = "Date" }) {
  const t = today();
  const isBack = value && value < t;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "#5C6B54" }}>{label}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="date"
          value={value}
          max={t}
          onChange={(e) => onChange(e.target.value && e.target.value <= t ? e.target.value : t)}
          style={{ flex: 1, boxSizing: "border-box", background: "#F5F1E4", border: `1px solid ${isBack ? "#C9A227" : "#DDE0C8"}`, borderRadius: 4, padding: "9px 10px", color: "#2A3324", fontFamily: "'Inter', sans-serif", fontSize: 14 }}
        />
        {isBack && (
          <button type="button" onClick={() => onChange(t)} style={{ background: "none", border: "1px solid #DDE0C8", borderRadius: 4, padding: "8px 10px", color: "#5C6B54", fontSize: 12, cursor: "pointer" }}>
            Today
          </button>
        )}
      </div>
      {isBack && <span style={{ fontSize: 11.5, color: "#8A6D0B" }}>Backdated — this will be recorded as {value}.</span>}
    </div>
  );
}

// ISO timestamp for a chosen day. Today keeps the real time; a past day is
// stamped at midday local so it sorts and displays on the right date.
export const stampForDate = (d) => (!d || d >= today() ? new Date().toISOString() : new Date(`${d}T12:00:00`).toISOString());

export function StageDateModal({ title, confirmLabel, onClose, onConfirm }) {
  const [date, setDate] = useState(today());
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <BackdateField value={date} onChange={setDate} label="When did this happen?" />
        <button
          onClick={() => { onConfirm(date); onClose(); }}
          style={{ background: "#5C9A3C", border: "none", borderRadius: 5, padding: "12px", color: "#16191A", fontFamily: "'Oswald', sans-serif", fontWeight: 500, fontSize: 15, cursor: "pointer" }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// Counts open modals so stacked ones (e.g. a confirm over a form) only
// unlock page scrolling once the last one closes.
export let openModalCount = 0;
export let savedBodyOverflow = "";

export function Modal({ title, onClose, children }) {
  // Stop the page behind from scrolling while a modal is open. On iPhone
  // the swipe otherwise gets shared between the page and the modal, which
  // makes long modals (like checklists) feel sticky to scroll.
  useEffect(() => {
    if (openModalCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModalCount += 1;
    return () => {
      openModalCount -= 1;
      if (openModalCount === 0) document.body.style.overflow = savedBodyOverflow;
    };
  }, []);

  // Always drawn on document.body, not where it's used: a pop-up opened
  // inside an animated or zoomed part of the page would otherwise be
  // positioned relative to that part, scroll with it, and run off screen.
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        overscrollBehavior: "contain",
        background: "rgba(10,12,11,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "24px 18px",
        animation: "bp-modal-overlay-in 160ms ease-out",
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes bp-modal-overlay-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes bp-modal-panel-in { from { opacity: 0; transform: scale(0.96) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#F8F5EA",
          border: "1px solid #DDE0C8",
          borderRadius: 10,
          width: "100%",
          maxWidth: 480,
          maxHeight: "88dvh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
          padding: "20px 22px 26px",
          animation: "bp-modal-panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: 0, fontWeight: 500 }}>
            {title}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#5C6B54", cursor: "pointer", padding: 10 }}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

// A styled stand-in for window.confirm() — everywhere the app needs a
// "are you sure?" check, this keeps it looking like the rest of Brewpoint
// instead of the browser's plain OS-level alert box.
export function ConfirmDialogModal({ title = "Are you sure?", message, confirmLabel = "Confirm", destructive = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5, margin: 0 }}>{message}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              background: "none",
              border: "1px solid #C9D1AC",
              borderRadius: 5,
              padding: "11px",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              background: destructive ? "#B5502F" : "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px",
              color: destructive ? "#FFFFFF" : "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 13.5,
              letterSpacing: "0.02em",
              cursor: "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function EmptyState({ icon: Icon, title, subtitle, action, secondaryAction }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px" }}>
      {Icon && <Icon size={26} color="#C9D1AC" style={{ marginBottom: 12 }} />}
      <div style={{ fontSize: 14, color: "#5C6B54", fontFamily: "'Oswald', sans-serif", fontWeight: 500, marginBottom: subtitle ? 4 : 0 }}>
        {title}
      </div>
      {subtitle && <div style={{ fontSize: 12.5, color: "#9BA88A", maxWidth: 300, margin: "0 auto", lineHeight: 1.5 }}>{subtitle}</div>}
      {(action || secondaryAction) && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 16 }}>
          {action && (
            <button
              onClick={action.onClick}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#5C9A3C",
                border: "none",
                borderRadius: 5,
                padding: "9px 16px",
                color: "#16191A",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <Plus size={14} /> {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "1px solid #DDE0C8",
                borderRadius: 5,
                padding: "9px 16px",
                color: "#5C6B54",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A short explainer shown the first time someone visits a given screen —
// dismissed permanently per-screen once tapped, so it never nags after that.
export function FirstVisitTip({ tipKey, children }) {
  const storageKey = `brewpoint-tip-dismissed-${tipKey}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(storageKey, "true");
    } catch {}
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: "#F8F5EA",
        border: "1px solid #C9D1AC",
        borderRadius: 6,
        padding: "12px 14px",
        marginBottom: 16,
      }}
    >
      <Info size={15} color="#5C9A3C" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: "#2A3324", fontSize: 12.5, lineHeight: 1.5 }}>{children}</div>
        <button
          onClick={dismiss}
          style={{
            background: "none",
            border: "none",
            color: "#5C9A3C",
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            cursor: "pointer",
            padding: "6px 0 0",
          }}
        >
          Got it, don't show this again
        </button>
      </div>
    </div>
  );
}

export function OfflineBanner() {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 90,
        background: "#2A1E16",
        borderBottom: "1px solid #E3D3A0",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <AlertTriangle size={14} color="#E3B04A" />
      <span style={{ color: "#F5F1E4", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
        You're offline — changes won't save until you're back online.
      </span>
    </div>
  );
}

export const APP_VERSION = "2026-11-10-294";

export function UpdateBanner({ onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div
      style={{
        position: "fixed",
        bottom: "env(safe-area-inset-bottom, 0px)",
        left: 0,
        right: 0,
        zIndex: 95,
        background: "#1F2E18",
        borderTop: "1px solid #C9D1AC",
        padding: "8px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <CheckCircle2 size={14} color="#8FCB6C" />
        <span style={{ color: "#F5F1E4", fontSize: 12.5, fontFamily: "'Inter', sans-serif" }}>
          A new version of Brewpoint is available.
        </span>
        <button
          onClick={() => {
            setRefreshing(true);
            onRefresh();
          }}
          disabled={refreshing}
          style={{
            background: refreshing ? "#3A4A2E" : "none",
            border: "1px solid #C9D1AC",
            borderRadius: 5,
            padding: "4px 10px",
            color: "#F5F1E4",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 12,
            cursor: refreshing ? "default" : "pointer",
          }}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
        <button
          onClick={() => setShowHelp((v) => !v)}
          style={{ background: "none", border: "none", color: "#C9D1AC", fontFamily: "'Inter', sans-serif", fontSize: 11, textDecoration: "underline", cursor: "pointer", padding: 0 }}
        >
          {showHelp ? "Hide" : "Still showing this after refreshing?"}
        </button>
      </div>
      {showHelp && (
        <div style={{ color: "#C9D1AC", fontSize: 11.5, lineHeight: 1.6, textAlign: "center", maxWidth: 480, margin: "0 auto" }}>
          <strong>If it's on your home screen:</strong> fully close it first — swipe it away in the app switcher, not just the home button — then reopen from the icon. Still stuck? Long-press the icon → delete it, load the site fresh in Safari, then Share → Add to Home Screen again.
          <br />
          <strong>If you're in Safari/Chrome:</strong> Settings → Safari → Advanced → Website Data → search "breworx" → swipe to delete, then reload the page.
        </div>
      )}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        zIndex: 100,
        pointerEvents: "none",
        padding: "0 16px",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            maxWidth: 420,
            width: "100%",
            background: t.type === "error" ? "#2A1E16" : "#1F2E18",
            border: `1px solid ${t.type === "error" ? "#E3D3A0" : "#C9D1AC"}`,
            borderRadius: 8,
            padding: "11px 14px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            cursor: "pointer",
            animation: "bp-toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <style>{`
            @keyframes bp-toast-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes bp-check-pop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
            @media (prefers-reduced-motion: reduce) {
              .bp-check-pop { animation: none !important; }
            }
          `}</style>
          {t.type === "error" ? (
            <AlertTriangle size={16} color="#E3B04A" style={{ flexShrink: 0 }} />
          ) : (
            <CheckCircle2 size={16} color="#8FCB6C" className="bp-check-pop" style={{ flexShrink: 0, animation: "bp-check-pop 380ms cubic-bezier(0.34, 1.56, 0.64, 1)" }} />
          )}
          <span style={{ color: "#F5F1E4", fontSize: 13, fontFamily: "'Inter', sans-serif", lineHeight: 1.4, flex: 1 }}>{t.message}</span>
          {t.action && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                t.action.onClick();
                onDismiss(t.id);
              }}
              style={{
                background: "none",
                border: "1px solid #C9D1AC",
                borderRadius: 5,
                padding: "5px 10px",
                color: "#F5F1E4",
                fontFamily: "'Oswald', sans-serif",
                fontWeight: 500,
                fontSize: 12.5,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export class BrewpointErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("Brewpoint crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error);
      const stack = this.state.error?.stack || "";
      const componentStack = this.state.info?.componentStack || "";
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#F5F1E4",
            fontFamily: "'Inter', sans-serif",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, color: "#2A3324", margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ color: "#5C6B54", fontSize: 13.5, maxWidth: 480, margin: "0 0 16px" }}>
            Brewpoint hit an error and couldn't load. Screenshot everything below and send it over — this tells us exactly what broke.
          </p>
          <div
            style={{
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              borderRadius: 6,
              padding: 14,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              color: "#B5502F",
              maxWidth: "100%",
              width: 560,
              maxHeight: "50vh",
              overflow: "auto",
              textAlign: "left",
              boxSizing: "border-box",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {message}
            {stack ? `\n\n${stack}` : ""}
            {componentStack ? `\n\n--- component stack ---${componentStack}` : ""}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 18,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "11px 22px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
