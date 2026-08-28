import {
  Article,
  Database,
  Detective,
  FileAudio,
  type Icon,
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
};

export const USE_MOCK_STT = import.meta.env.VITE_USE_MOCK_STT === "true";
export const STT_MOCK_DELAY_MS = Number(
  import.meta.env.VITE_STT_MOCK_DELAY_MS ?? 4000,
);

export const USE_MOCK_SUMMARIZE =
  import.meta.env.VITE_USE_MOCK_SUMMARIZE === "true";
export const SUMMARIZE_MOCK_DELAY_MS = Number(
  import.meta.env.VITE_SUMMARIZE_MOCK_DELAY_MS ?? 300,
);

// Fase 1 of docs/defensoria/PLAN.md (catalogs backend) isn't implemented on this branch
// yet — the Fase 7 frontend is built against the exact documented contract, but served
// from an in-memory fake until the real endpoints land. Flip to false once they do.
export const USE_MOCK_CATALOGS =
  import.meta.env.VITE_USE_MOCK_CATALOGS === "true";

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
