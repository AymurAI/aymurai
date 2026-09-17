import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import es from "./locales/es";

// --- TypeScript type augmentation ---
// Tells i18next the exact shape of every namespace,
// so t('key') calls are fully typed and autocompleted.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof es;
  }
}

i18n.use(initReactI18next).init({
  lng: "es",
  fallbackLng: "es",
  defaultNS: "common",
  resources: {
    es,
  },
  interpolation: {
    escapeValue: false, // React already escapes values
  },
});

// `init` copies the resources into i18next's own store, so a hot update to a
// locale file swaps the module without touching that store: existing strings
// keep working while newly added keys render as their raw key ("nav.taxonomy"),
// which reads like a missing translation rather than a stale dev server.
// Re-registering each namespace on update keeps HMR honest. Dev-only — the
// whole block is stripped from a production build.
if (import.meta.hot) {
  import.meta.hot.accept("./locales/es", (updated) => {
    const next = (updated as { default?: typeof es } | undefined)?.default;
    if (!next) return;
    for (const [namespace, resources] of Object.entries(next)) {
      i18n.addResourceBundle("es", namespace, resources, true, true);
    }
    // Nudges react-i18next to re-render with the refreshed bundles.
    i18n.emit("languageChanged", i18n.language);
  });
}

export default i18n;
