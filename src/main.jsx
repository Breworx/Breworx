import React from "react";
import ReactDOM from "react-dom/client";
import TankLog from "./TankLog.jsx";
import { XeroCallback } from "./components/xero.jsx";
import { AuditSharePage } from "./components/auditor.jsx";

const path = window.location.pathname;
const isXeroCallback = path === "/xero-callback";
// Read-only auditor links: /audit/<token>
const auditToken = (/^\/audit\/([a-f0-9]{16,})\/?$/.exec(path) || [])[1];

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isXeroCallback ? <XeroCallback /> : auditToken ? <AuditSharePage token={auditToken} /> : <TankLog />}
  </React.StrictMode>
);
