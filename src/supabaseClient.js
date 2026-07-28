import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function showFatalError(message) {
  document.body.innerHTML = `<div style="font-family: monospace; background:#16191A; color:#C17A3D; padding:24px; min-height:100vh; box-sizing:border-box;">
    <h2 style="color:#EDE7D9;">Breworx failed to start</h2>
    <p>${message}</p>
    <p style="color:#8A9591; font-size:13px;">URL seen: ${JSON.stringify(url)}</p>
    <p style="color:#8A9591; font-size:13px;">Key length seen: ${anonKey ? anonKey.length : "missing"}</p>
  </div>`;
}

let supabase;
try {
  if (!url || !anonKey) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
  }
  supabase = createClient(url, anonKey);
} catch (err) {
  showFatalError(err.message);
  throw err;
}

export { supabase };
