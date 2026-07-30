import React from "react";
import ReactDOM from "react-dom/client";
import TankLog, { XeroCallback } from "./TankLog.jsx";

const isXeroCallback = window.location.pathname === "/xero-callback";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isXeroCallback ? <XeroCallback /> : <TankLog />}
  </React.StrictMode>
);
