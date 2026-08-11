import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installAssetRolloverRecovery } from "./lib/assetRecovery";
import { initializeTelemetry } from "./lib/telemetry";
import "./styles.css";

installAssetRolloverRecovery();
initializeTelemetry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
