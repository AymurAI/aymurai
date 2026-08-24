import React from "react";
import ReactDOM from "react-dom/client";

import "./index.css";
import "@aymurai/ui/styles.css";
import "./constants/i18n";
import App from "./app";
import { APP_VERSION } from "./constants/version";

// Set as a DOM attribute (not logged unconditionally) so the version string
// is retained in the production bundle and observable at runtime for
// support/debugging purposes, without an unconditional production console
// line.
const rootElement = document.getElementById("root")!;
rootElement.setAttribute("data-app-version", APP_VERSION);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
