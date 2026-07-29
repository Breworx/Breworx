import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function showPanel(lines) {
  const el = document.createElement("div");
  el.style.cssText =
    "font-family: monospace; background:#16191A; color:#EDE7D9; padding:20px; position:fixed; inset:0; z-index:99999; overflow:auto; font-size:13px; white-space:pre-wrap;";
  el.textContent = lines.join("\n");
  document.body.appendChild(el);
}

const results = [];
const log = (line) => {
  results.push(line);
  showPanel(results);
};

let supabase;
try {
  supabase = createClient(url, anonKey);
} catch (err) {
  log("createClient threw: " + err.message);
}

(async () => {
  log("Starting network diagnostics...");
  log("URL: " + url);
  log("");

  // Test 1: plain fetch, no-cors (can't read response, but tells us if the
  // request itself is blocked before even reaching CORS checks)
  try {
    await fetch(url + "/auth/v1/settings", { mode: "no-cors" });
    log("[1] no-cors fetch: completed without throwing");
  } catch (err) {
    log("[1] no-cors fetch FAILED: " + err.name + " - " + err.message);
  }

  // Test 2: normal fetch with apikey header (what supabase-js actually does)
  try {
    const res = await fetch(url + "/auth/v1/settings", {
      headers: { apikey: anonKey },
    });
    log("[2] normal fetch: HTTP " + res.status);
  } catch (err) {
    log("[2] normal fetch FAILED: " + err.name + " - " + err.message);
  }

  // Test 3: XMLHttpRequest (older API, sometimes behaves differently)
  await new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url + "/auth/v1/settings");
    xhr.setRequestHeader("apikey", anonKey);
    xhr.onload = () => {
      log("[3] XHR: HTTP " + xhr.status);
      resolve();
    };
    xhr.onerror = () => {
      log("[3] XHR FAILED (network error)");
      resolve();
    };
    xhr.ontimeout = () => {
      log("[3] XHR FAILED (timeout)");
      resolve();
    };
    xhr.timeout = 8000;
    xhr.send();
  });

  // Test 4: fetch a totally different, unrelated API to see if ANY
  // cross-origin request works at all, or if it's specific to Supabase
  try {
    const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
    log("[4] unrelated API fetch: HTTP " + res.status);
  } catch (err) {
    log("[4] unrelated API fetch FAILED: " + err.name + " - " + err.message);
  }

  log("");
  log("Diagnostics complete.");
})();

export { supabase };
