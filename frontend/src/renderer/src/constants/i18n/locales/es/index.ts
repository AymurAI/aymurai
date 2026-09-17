import anonymizer from "./anonymizer";
import common from "./common";
import dataset from "./dataset";
import recommendations from "./recommendations";
import settings from "./settings";
import summarizer from "./summarizer";
import voiceToText from "./voice-to-text";

const es = {
  common,
  dataset,
  anonymizer,
  "voice-to-text": voiceToText,
  summarizer,
  settings,
  recommendations,
};

export default es;
