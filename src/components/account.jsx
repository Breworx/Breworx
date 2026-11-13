import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { BreworxMark, Modal, TextField } from "./ui";

export function DeleteAccountModal({ onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError("");
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ error: "Timed out — no response after 15 seconds. Check your connection and try again." }), 15000)
    );
    const result = await Promise.race([onConfirm(), timeout]);
    if (result && result.error) {
      setError(result.error);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete account" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            color: "#5C9A3C",
            fontSize: 13,
            background: "#FCF1DC",
            border: "1px solid #E3D3A0",
            borderRadius: 5,
            padding: "10px 12px",
            lineHeight: 1.5,
          }}
        >
          This permanently deletes your login and removes you from the team. It doesn't delete your
          company's batches, inventory, orders, or recipes — those stay in place for any teammates left
          on the account. This can't be undone.
        </div>
        <TextField label='Type "DELETE" to confirm' value={confirmText} onChange={setConfirmText} />
        {error && (
          <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={!canDelete || busy}
          style={{
            background: canDelete ? "#B5502F" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canDelete ? "#2A3324" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: canDelete && !busy ? "pointer" : "default",
          }}
        >
          {busy ? "Deleting…" : "Permanently delete my account"}
        </button>
      </div>
    </Modal>
  );
}

export function DeleteCompanyModal({ onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmText.trim().toUpperCase() === "DELETE COMPANY";

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    setError("");
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ error: "Timed out — no response after 15 seconds. Check your connection and try again." }), 15000)
    );
    const result = await Promise.race([onConfirm(), timeout]);
    if (result && result.error) {
      setError(result.error);
      setBusy(false);
    }
  };

  return (
    <Modal title="Delete company" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            color: "#B5502F",
            fontSize: 13,
            background: "#FBE5DC",
            border: "1px solid #E3B3A0",
            borderRadius: 5,
            padding: "10px 12px",
            lineHeight: 1.5,
          }}
        >
          This permanently deletes everything — every batch, ingredient, consumable, recipe, purchase
          order, tank, food safety record, and supplier tied to this company — then deletes the company
          itself and your login. Any teammates on this account will be signed out and lose access too.
          This cannot be undone.
        </div>
        <TextField label='Type "DELETE COMPANY" to confirm' value={confirmText} onChange={setConfirmText} />
        {error && (
          <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={!canDelete || busy}
          style={{
            background: canDelete ? "#B5502F" : "#E8E4D4",
            border: "none",
            borderRadius: 5,
            padding: "12px",
            color: canDelete ? "#FFFFFF" : "#A3AC94",
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 500,
            fontSize: 15,
            letterSpacing: "0.03em",
            cursor: canDelete && !busy ? "pointer" : "default",
          }}
        >
          {busy ? "Deleting…" : "Permanently delete company"}
        </button>
      </div>
    </Modal>
  );
}

export const item_qty = (it) => (Number.isInteger(it.qty) ? it.qty : it.qty.toFixed(2));

export function EmailConfirmedScreen({ onContinue }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        button:focus-visible { outline: 2px solid #5C9A3C; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 22 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <BreworxMark size={50} />
          </div>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#5C9A3C",
              marginBottom: 6,
            }}
          >
            Brewpoint
          </span>
        </div>

        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "#F8F5EA",
            border: "1px solid #E3D3A0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
          }}
        >
          <CheckCircle2 size={22} color="#D9A441" />
        </div>

        <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 22, color: "#2A3324", margin: "0 0 8px", fontWeight: 500 }}>
          Email confirmed
        </h1>
        <p style={{ color: "#5C6B54", fontSize: 14, lineHeight: 1.5, margin: "0 0 26px" }}>
          Thanks for confirming your email. Your account's ready to go — log in below to get into your brewery.
        </p>

        <button
          onClick={onContinue}
          style={{
            width: "100%",
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
          Continue to sign in
        </button>
      </div>
    </div>
  );
}

export function AuthScreen({ inviteToken }) {
  const [mode, setMode] = useState(inviteToken ? "signup" : "signin");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  // What the invite is for (company, Sales or full access), and the email it was sent to.
  const [invite, setInvite] = useState(null);
  useEffect(() => {
    if (!inviteToken) return;
    supabase.rpc("invite_details", { invite_token: inviteToken }).then(({ data }) => {
      if (!data) return;
      setInvite(data);
      if (data.email) setEmail((prev) => prev || data.email);
    });
  }, [inviteToken]);

  const submit = async () => {
    if (mode === "signup" && !inviteToken && !companyName.trim()) {
      setError("Enter your company name.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError("");
    setInfo("");
    setBusy(true);
    if (mode === "signup") {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { name: name.trim(), company: companyName.trim(), inviteToken: inviteToken || null } },
      });
      setBusy(false);
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setInfo("Check your email to confirm your account, then sign in.");
        setMode("signin");
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      setBusy(false);
      if (signInError) setError(signInError.message);
      // on success, the onAuthStateChange listener in TankLog picks up the session
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F1E4",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 18px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        input:focus { outline: 1px solid #5C9A3C; }
        button:focus-visible { outline: 2px solid #5C9A3C; outline-offset: 2px; }
      `}</style>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 30 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#FFFFFF",
              border: "1px solid #DDE0C8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <BreworxMark size={50} />
          </div>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#5C9A3C",
              marginBottom: 6,
            }}
          >
            Brewpoint
          </span>
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 24, color: "#2A3324", margin: 0, fontWeight: 500 }}>
            {mode === "signin" ? "Welcome back" : inviteToken ? "Join your team" : "Start your brewery log"}
          </h1>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "signup" && inviteToken && (
            <div style={{ color: "#5C6B54", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #EBE8D6", borderRadius: 5, padding: "8px 12px" }}>
              {invite?.used
                ? "This invite has already been used. Ask for a new one, or sign in if it was you."
                : invite
                  ? `You're joining ${invite.company}${invite.role === "sales" ? " as Sales (view only: stock, tanks, the calendar and Upstock orders)" : " as a team member"}. Just add your name and a password.`
                  : "You're joining an existing brewery via invite link — no need to enter a company name."}
            </div>
          )}
          {mode === "signup" && !inviteToken && <TextField label="Company name" value={companyName} onChange={setCompanyName} />}
          {mode === "signup" && <TextField label="Your name" value={name} onChange={setName} />}
          <div onKeyDown={onKeyDown}>
            <TextField label="Email" value={email} onChange={setEmail} type="email" />
          </div>
          <div onKeyDown={onKeyDown}>
            <TextField label="Password" value={password} onChange={setPassword} type="password" />
          </div>

          {error && (
            <div style={{ color: "#5C9A3C", fontSize: 12.5, background: "#FCF1DC", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
              {error}
            </div>
          )}
          {info && !error && (
            <div style={{ color: "#D9A441", fontSize: 12.5, background: "#F8F5EA", border: "1px solid #E3D3A0", borderRadius: 5, padding: "8px 12px" }}>
              {info}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            style={{
              marginTop: 4,
              background: "#5C9A3C",
              border: "none",
              borderRadius: 5,
              padding: "12px",
              color: "#16191A",
              fontFamily: "'Oswald', sans-serif",
              fontWeight: 500,
              fontSize: 15,
              letterSpacing: "0.03em",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <button
            onClick={() => {
              setError("");
              setInfo("");
              setMode(mode === "signin" ? "signup" : "signin");
            }}
            style={{
              background: "none",
              border: "none",
              color: "#5C6B54",
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
