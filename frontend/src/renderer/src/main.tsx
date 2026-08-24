import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import "@aymurai/ui/styles.css";
import "./constants/i18n";
import App from "./app";
import { APP_VERSION } from "./constants/version";

// Logged unconditionally (not gated behind dev-only helpers) so the version
// string is retained in the production bundle and observable at runtime for
// support/debugging purposes.
console.info(`AymurAI v${APP_VERSION}`);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
