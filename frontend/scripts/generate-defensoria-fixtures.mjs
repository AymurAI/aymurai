#!/usr/bin/env node
/**
 * Generates the committed Defensoría fixtures used by the mock catalogs /
 * organigram services (`src/renderer/src/services/aymurai/mock*.ts`).
 *
 * PROVENANCE — the two inputs are the *real* datasets, not samples:
 *
 *   1. `defensoria_taxonomy.json` — the Defensoría's own consultation taxonomy:
 *      25 areas (`area` + `tema`) each holding its `subtemas`
 *      (`codigo` + `descripcion`); 242 subtemas in total.
 *   2. `organigram_GCBA.json` — the GCBA organigram as a nested tree:
 *      520 nodes, 489 of them with a sitting titular. Each node carries
 *      `cargo` (the *unit* name), `sigla` (its acronym), `nombre` (the *current
 *      holder's* name — NOT the unit name) and optional `dependencias`.
 *
 * Both files live outside the repo (they are handed over by the Defensoría), so
 * this script takes their paths as CLI args and bakes the result into two
 * committed JSON fixtures. JSON has no comments, so the fixtures themselves
 * carry no provenance header — this script and the two mock modules that import
 * them are the documentation.
 *
 * The fixtures are GENERATED. Never hand-edit them: re-run this script instead.
 * Its output is deterministic — the same inputs always produce byte-identical
 * files.
 *
 * Usage:
 *   node scripts/generate-defensoria-fixtures.mjs [taxonomy.json] [organigram.json]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const DEFAULT_TAXONOMY_PATH =
  "/home/jansaldo/Downloads/defensoria_taxonomy.json";
const DEFAULT_ORGANIGRAM_PATH =
  "/home/jansaldo/Downloads/Telegram Desktop/organigram_GCBA.json";

const FIXTURES_DIR = resolve(
  HERE,
  "../src/renderer/src/services/aymurai/fixtures",
);

/** Same frozen timestamp the hand-written fixtures used, so diffs stay stable. */
const TIMESTAMP = "2026-08-28T00:00:00Z";

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

/** Accent- and case-insensitive form used by every text rule below. */
function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic unique id: `base`, then `base-2`, `base-3`, … in the order ids
 * are requested. Records every disambiguation so the run can report it.
 */
function makeIdFactory(collisions) {
  const taken = new Set();
  return function claim(base, context) {
    const stem = base || "unnamed";
    if (!taken.has(stem)) {
      taken.add(stem);
      return stem;
    }
    let n = 2;
    while (taken.has(`${stem}-${n}`)) n += 1;
    const id = `${stem}-${n}`;
    taken.add(id);
    collisions.push({ base: stem, id, context });
    return id;
  };
}

// ---------------------------------------------------------------------------
// taxonomy
// ---------------------------------------------------------------------------

/**
 * `area` → topic code, `tema` → topic name, `codigo` → subtopic code,
 * `descripcion` → subtopic name. `order` is 1-based in source order within its
 * parent; everything is `active`.
 */
function buildTaxonomy(source) {
  const collisions = [];
  const claim = makeIdFactory(collisions);
  const topics = [];
  const subtopics = [];

  source.forEach((area, areaIndex) => {
    const topicId = claim(`topic-${slugify(area.area)}`, area.tema);
    topics.push({
      id: topicId,
      code: area.area,
      name: area.tema,
      active: true,
      order: areaIndex + 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });

    (area.subtemas ?? []).forEach((subtema, subIndex) => {
      subtopics.push({
        id: claim(`sub-${slugify(subtema.codigo)}`, subtema.descripcion),
        topic_id: topicId,
        code: subtema.codigo,
        name: subtema.descripcion,
        active: true,
        order: subIndex + 1,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      });
    });
  });

  return { topics, subtopics, collisions };
}

// ---------------------------------------------------------------------------
// organigram — tree walk
// ---------------------------------------------------------------------------

/** Pre-order DFS. Each record keeps the root→self chain the sector rules read. */
function flatten(root) {
  const records = [];
  (function walk(node, ancestors, depth, order) {
    const record = {
      node,
      path: [...ancestors, node],
      depth, // 1-based: the root is depth 1, matching ADR-0001's wording
      order,
      parent: ancestors.at(-1) ?? null,
    };
    records.push(record);
    (node.dependencias ?? []).forEach((child, index) => {
      walk(child, record.path, depth + 1, index + 1);
    });
  })(root, [], 1, 1);
  return records;
}

const holderNameOf = (node) => String(node.nombre ?? "").trim();

// ---------------------------------------------------------------------------
// organigram — the five historical sector rules (ADR-0001)
// ---------------------------------------------------------------------------

/**
 * The pre-`is_sector` backend derived a destinatario's sector by running these
 * five text rules, in priority order, over the node's organigram path
 * (`sector_matching.resolve_sector_from_hierarchy`). ADR-0001 replaces them
 * with a boolean on the node; this function exists only to run them ONCE here,
 * exactly as the backend seed does, and set that boolean.
 *
 * All matching is accent- and case-insensitive, so "Secretaría" starts with
 * "secretaria".
 */
const AUTONOMOUS_BODY_KEYWORDS = new Set(["agc", "agip", "ivc", "copidis"]);

/** Rule 5's "generic" segments — titles that name no sector of government. */
const GENERIC_SEGMENTS = new Set([
  "jefe de gobierno",
  "gobierno de la ciudad autonoma de buenos aires",
]);

function resolveSectorFromHierarchy(path) {
  // 1 — autonomous bodies, by hardcoded keyword. Deepest match wins: the point
  //     of the rule is that an autonomous body overrides its administrative parent.
  for (let i = path.length - 1; i >= 0; i -= 1) {
    if (AUTONOMOUS_BODY_KEYWORDS.has(normalize(path[i].sigla))) return path[i];
  }
  // 2 — any segment starting with "ministerio".
  for (const node of path) {
    if (normalize(node.cargo).startsWith("ministerio")) return node;
  }
  // 3 — any segment starting with "secretaria", excluding "subsecretaria"
  //     (the `sub` prefix disqualifies it).
  for (const node of path) {
    const cargo = normalize(node.cargo);
    if (cargo.startsWith("secretaria") && !cargo.startsWith("subsecretaria")) {
      return node;
    }
  }
  // 4 — "Jefatura de Gabinete de Ministros" anywhere in the path.
  for (const node of path) {
    if (normalize(node.cargo).includes("jefatura de gabinete de ministros")) {
      return node;
    }
  }
  // 5 — the first non-generic segment.
  for (const node of path) {
    if (!GENERIC_SEGMENTS.has(normalize(node.cargo))) return node;
  }
  return null;
}

/**
 * The set of nodes that get `is_sector: true`.
 *
 * The rules resolved the sector of a *destinatario*, and a destinatario is a
 * node with a sitting titular — so the sector set is the image of the rules
 * over the holder-bearing nodes, which is ADR-0001's "489/489 nodos" figure.
 * (Over all 520 nodes the set would additionally contain "Unidad de Asesores",
 * a childless node with no titular that is therefore never anybody's sector.)
 */
function resolveSectorNodes(records) {
  const sectors = new Set();
  for (const record of records) {
    if (!holderNameOf(record.node)) continue;
    const sector = resolveSectorFromHierarchy(record.path);
    if (sector) sectors.add(sector);
  }
  return sectors;
}

// ---------------------------------------------------------------------------
// organigram — rows
// ---------------------------------------------------------------------------

/**
 * Unit ids are stable, unique and human-readable: the slugified `sigla`, with a
 * numeric suffix on collision (siglas are NOT unique in the source), falling
 * back to a slug of `cargo` when the sigla is blank. Pre-order DFS makes the
 * suffixes deterministic.
 */
function buildOrganigram(root) {
  const records = flatten(root);
  const sectorNodes = resolveSectorNodes(records);
  const collisions = [];
  const claim = makeIdFactory(collisions);

  const idByNode = new Map();
  const units = [];
  const holders = [];

  for (const record of records) {
    const { node, parent, order } = record;
    const sigla = String(node.sigla ?? "").trim();
    const id = claim(sigla ? slugify(sigla) : slugify(node.cargo), node.cargo);
    idByNode.set(node, id);

    units.push({
      id,
      parent_id: parent ? idByNode.get(parent) : null,
      name: node.cargo,
      acronym: sigla || null,
      short_name: null,
      is_sector: sectorNodes.has(node),
      active: true,
      order,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    });

    const holderName = holderNameOf(node);
    if (holderName) {
      holders.push({
        id: `holder-${id}`,
        unit_id: id,
        name: holderName,
        // The source organigram carries no term dates, so the fixture claims
        // none. A seeded backend backfills `start_date` from `created_at`;
        // here the honest value is null, which also exercises the "term date
        // unknown" branch the UI has to render.
        start_date: null,
        is_current: true,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      });
    }

    record.id = id;
  }

  const maxDepth = records.reduce((max, r) => Math.max(max, r.depth), 0);
  const sectorRecords = records.filter((r) => sectorNodes.has(r.node));

  return { units, holders, collisions, maxDepth, sectorRecords };
}

// ---------------------------------------------------------------------------
// io + report
// ---------------------------------------------------------------------------

function writeFixture(name, value) {
  const target = resolve(FIXTURES_DIR, name);
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

function reportCollisions(label, collisions) {
  if (collisions.length === 0) {
    console.info(`  ${label} id disambiguations: none`);
    return;
  }
  console.info(`  ${label} id disambiguations (${collisions.length}):`);
  for (const { base, id, context } of collisions) {
    console.info(`    ${base} -> ${id}  (${context})`);
  }
}

function main() {
  const [
    taxonomyPath = DEFAULT_TAXONOMY_PATH,
    organigramPath = DEFAULT_ORGANIGRAM_PATH,
  ] = process.argv.slice(2);

  const taxonomySource = JSON.parse(readFileSync(taxonomyPath, "utf8"));
  const organigramSource = JSON.parse(readFileSync(organigramPath, "utf8"));

  const {
    topics,
    subtopics,
    collisions: taxonomyCollisions,
  } = buildTaxonomy(taxonomySource);
  const { units, holders, collisions, maxDepth, sectorRecords } =
    buildOrganigram(organigramSource);

  const taxonomyFile = writeFixture("taxonomy.json", { topics, subtopics });
  const organigramFile = writeFixture("organigram.json", { units, holders });

  const depthHistogram = {};
  for (const record of sectorRecords) {
    depthHistogram[record.depth] = (depthHistogram[record.depth] ?? 0) + 1;
  }

  console.info(`taxonomy   <- ${taxonomyPath}`);
  console.info(`organigram <- ${organigramPath}`);
  console.info("");
  console.info(`taxonomy.json   -> ${taxonomyFile}`);
  console.info(`  topics: ${topics.length}   subtopics: ${subtopics.length}`);
  reportCollisions("topic/subtopic", taxonomyCollisions);
  console.info("");
  console.info(`organigram.json -> ${organigramFile}`);
  console.info(
    `  units: ${units.length}   holders: ${holders.length}   max depth: ${maxDepth}`,
  );
  reportCollisions("unit", collisions);
  console.info("");
  console.info(
    `  is_sector nodes: ${sectorRecords.length} (ADR-0001 expects 33)`,
  );
  console.info(
    `  sector depth distribution: ${JSON.stringify(depthHistogram)} (ADR-0001 expects depths 2, 3, 4)`,
  );
  for (const record of sectorRecords) {
    console.info(
      `    d${record.depth}  ${record.id.padEnd(12)}  ${record.node.cargo}`,
    );
  }

  if (sectorRecords.length !== 33) {
    console.warn(
      `\nWARNING: expected 33 sector nodes per ADR-0001, got ${sectorRecords.length}.`,
    );
    process.exitCode = 1;
  }
}

main();
