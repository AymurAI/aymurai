import {
  Article,
  Database,
  Detective,
  FileAudio,
  type Icon,
  Megaphone,
  Table,
} from "phosphor-react";
import { FeatureFlowEnum } from "@/types/features";

export const DATAGENERO_URL = "https://www.datagenero.org/";

/** Document extensions accepted by the dataset/anonymizer flows. */
export const DOCUMENT_EXTENSIONS = ["docx", "pdf"];

/** Audio extensions accepted by the voice-to-text flow. */
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "webm", "ogg", "flac"];

/** Video extensions accepted by the voice-to-text flow. */
export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "m4v"];

/** Media extensions accepted by the voice-to-text flow. */
export const MEDIA_EXTENSIONS = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS];

/** Union — kept for any consumer that needs to know "is this analyzable at all". */
export const WHITELISTED_EXTENSIONS = [
  ...DOCUMENT_EXTENSIONS,
  ...MEDIA_EXTENSIONS,
];

/** Dataset Spreadsheet */
export const DATASET_URL =
  "https://docs.google.com/spreadsheets/d/1pzaGNM5BzRAOlj8p0NYtxnkU4VI_X5UcQsnIMOtLSVY/edit#gid=257379348";

export const FEATURE_ICON: Record<FeatureFlowEnum, Icon> = {
  [FeatureFlowEnum.Dataset]: Database,
  [FeatureFlowEnum.Anonymizer]: Detective,
  [FeatureFlowEnum.VoiceToText]: FileAudio,
  [FeatureFlowEnum.Summarizer]: Article,
  [FeatureFlowEnum.Recommendations]: Megaphone,
};

// Not a `FeatureFlowEnum` member (the grilla is a `/home/*` route, not a
// wizard flow), so it doesn't fit `FEATURE_ICON`. Deliberately distinct from
// `FEATURE_ICON.DATA_SET`/`Database`: the grilla's entry points sit right
// next to the Set de Datos/Recomendaciones entry (same icon there would
// route to two different destinations under one indistinguishable glyph).
export const GRILLA_ICON: Icon = Table;

export const USE_MOCK_STT = import.meta.env.VITE_USE_MOCK_STT === "true";
export const STT_MOCK_DELAY_MS = Number(
  import.meta.env.VITE_STT_MOCK_DELAY_MS ?? 4000,
);

export const USE_MOCK_SUMMARIZE =
  import.meta.env.VITE_USE_MOCK_SUMMARIZE === "true";
export const SUMMARIZE_MOCK_DELAY_MS = Number(
  import.meta.env.VITE_SUMMARIZE_MOCK_DELAY_MS ?? 300,
);

// Opt-in now that the catalogs endpoints exist (`/api/catalogs/*`, gated
// server-side by DEFENSORIA_ENABLED): the app talks to the real API by default,
// and VITE_USE_MOCK_CATALOGS=true switches back to the in-memory fixtures for
// working offline or without a running backend.
export const USE_MOCK_CATALOGS =
  import.meta.env.VITE_USE_MOCK_CATALOGS === "true";

// Same as USE_MOCK_CATALOGS above, for `/api/organigram/*`.
export const USE_MOCK_ORGANIGRAM =
  import.meta.env.VITE_USE_MOCK_ORGANIGRAM === "true";

// Same as USE_MOCK_CATALOGS above, for `/api/llm/data-extraction/*`.
export const USE_MOCK_DATA_EXTRACTION =
  import.meta.env.VITE_USE_MOCK_DATA_EXTRACTION === "true";

// Fase 7 (docs/defensoria/PLAN.md): gates the whole Configuración → taxonomía/organigrama
// surface per ADR-0007. `server` (the pre-existing host-connection screen) is never gated —
// only the two Defensoría-specific screens and their nav entries are.
//
// Exported as a function (not a frozen const) so callers always read the live
// value instead of one captured at first import — mirrors `isElectronApp()` in
// `utils/app-mode.ts`, which solves the same `vi.stubEnv`-per-test /
// module-caching problem for `VITE_APP_MODE`.
export function isDefensoriaEnabled(): boolean {
  return import.meta.env.VITE_DEFENSORIA_ENABLED === "true";
}

// Cache ON in production, OFF in dev. Override with VITE_ASR_USE_CACHE=true|false.
export const USE_ASR_CACHE =
  import.meta.env.VITE_ASR_USE_CACHE !== undefined
    ? import.meta.env.VITE_ASR_USE_CACHE === "true"
    : import.meta.env.PROD;
