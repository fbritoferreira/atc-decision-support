#!/usr/bin/env node
/**
 * Check the countable claims in the papers against the code they describe.
 *
 * This exists because the same defect keeps recurring, and always in prose
 * that looks like documentation while actually being a measurement. The corpus
 * table asserted severities the detectors had stopped producing. Four passages
 * denied that the proximity detector computes time to closest point of
 * approach, months after it did. The test count has been stale three times.
 * The negative-control count was wrong twice. Each was found by hand, late,
 * and one of them by a reader who happened to be reading the rendered PDF.
 *
 * A number in a paper that describes the system is regenerable, so it should
 * be regenerated rather than remembered. This script extracts the ground truth
 * from the source and compares it against what each paper says.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/verify-paper-claims.mjs [--tests N] [paper.md ...]
 *
 * With no paths it reads every document that makes a claim about this
 * artifact: the published thesis, this app's README, CITATION.cff, the site's
 * research-card subtitles, the other paper the site publishes, every
 * engineering note under docs/, and the long-form documents in the separate
 * checkout beside this one. The notes come from a directory read rather than a
 * list, so that set follows the directory instead of falling behind it.
 *
 * Those are optional. They are read when that checkout sits beside this one
 * and named in the output when it does not, so a clean CI checkout cannot
 * report a clean pass over a smaller set without saying so.
 * This paragraph used to say they "cannot be checked automatically and are
 * passed by hand", which stopped being true on 2026-08-29 and is recorded here
 * because a header describing superseded behaviour is the same defect the
 * script exists to catch, in the script itself.
 *
 * --tests takes the count from a vitest run, since running the suite from
 * inside a check that the suite calls would recurse. Run it under tsx, not
 * bare node: the app's modules import each other without file extensions,
 * which Vite and tsx resolve and Node ESM does not, and the resolve hook below
 * only papers over that for a by-hand run.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";

// The app's own modules import each other without file extensions ("./data"),
// which Vite resolves and plain Node ESM does not. This script loads those
// modules directly to count scenarios and airports, so without this hook it
// dies on ERR_MODULE_NOT_FOUND before checking a single claim, and the failure
// looks like a missing file rather than a resolution rule. Adding extensions to
// the app source instead would change shipping code to suit a script.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // fall through to the unmodified specifier below
      }
    }
    return nextResolve(specifier, context);
  },
});

// Every default paper path is written relative to apps/atc, so they only
// resolved when the script happened to be run from there. From the repository
// root it reported three unreadable files and "sibling repository absent from
// this checkout" for a repository that was present, blaming missing data for a
// wrong working directory. Defaults now anchor to the app; paths typed on the
// command line stay relative to the caller, because someone who types a path
// means the one they can see.
const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A window is excluded from the pooled pair figure while it is still
// collecting, by the same rule imc-pool.py applies: newest snapshot younger
// than STILL_RUNNING_MIN. Mirroring the rule rather than naming the window is
// what makes the check useful. A hardcoded list was written first and was
// wrong in a way worth recording: when the named window closed, this check
// would have gone on excluding it, gone on computing the number the papers
// already state, and gone on passing, while imc-pool.py moved to a larger
// figure. A stale exclusion does not fail loudly, it agrees with the stale
// prose it is supposed to guard.
// Runs once across the document loop, not per document.
let eventLabelSkips = 0;
let docsCitingReports = 0;
let rulesCommentChecked = false;
let diagramsChecked = false;
let updatedDatesChecked = false;
const STILL_RUNNING_MIN = 10;
const stillSampling = (tag) => {
  // The snapshot files carry the timestamps; the pairs dump for a quiet window
  // can be empty while the window is very much alive.
  let newest = 0;
  for (const f of (() => {
    try {
      return readdirSync(locate("data"));
    } catch {
      return [];
    }
  })()) {
    if (!f.startsWith("fp-") || !f.endsWith(`-${tag}.csv`)) continue;
    const lines = readFileSync(resolve(locate("data"), f), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    for (const line of lines.slice(1)) {
      const t = Date.parse(line.split(",")[0]);
      if (Number.isFinite(t) && t > newest) newest = t;
    }
  }
  if (newest === 0) return false;
  return (Date.now() - newest) / 60000 < STILL_RUNNING_MIN;
};

const locate = (p) => resolve(APP_DIR, p);

// The long-form documents live in a separate checkout beside this one. Its
// directory name is deliberately not recorded here: this repository is public
// and the sibling is not, so naming it would publish the existence and purpose
// of a private repository to every reader of a public one. The location is
// discovered instead, by looking through sibling directories for the paper
// itself, and every check that needs it already skips by name when it is
// absent. ATC_DOCS_DIR overrides the search when the checkout sits elsewhere.
const SIBLING_MARKER = "atc_whitepaper.md";
const docsDir = (() => {
  const fromEnv = process.env.ATC_DOCS_DIR;
  if (fromEnv && existsSync(resolve(fromEnv, SIBLING_MARKER))) return fromEnv;
  const parent = resolve(APP_DIR, "../../..");
  try {
    for (const entry of readdirSync(parent)) {
      const candidate = resolve(parent, entry);
      if (existsSync(resolve(candidate, SIBLING_MARKER))) return candidate;
    }
  } catch {
    // no parent to search; treated the same as not found
  }
  return null;
})();

/**
 * The documents that checkout asks to be checked, read from its own manifest.
 *
 * The list used to live here, which meant this public repository named the
 * sibling's files and so disclosed that a private repository exists and what it
 * is for. The sibling owns its own list now and this file names none of it.
 */
const manifestRoles = new Map();
const manifestDocs = () => {
  if (!docsDir) return [];
  const manifest = resolve(docsDir, "docs-manifest.txt");
  if (!existsSync(manifest)) return [];
  const out = [];
  for (const raw of readFileSync(manifest, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const tag = line.match(/\s+\[(\w+)\]$/);
    const rel = tag ? line.slice(0, tag.index).trim() : line;
    const abs = resolve(docsDir, rel);
    if (tag) manifestRoles.set(abs, tag[1]);
    out.push(abs);
  }
  return out;
};

/** A path inside the documents checkout, or a path that will simply not exist. */
const docs = (p) => (docsDir ? resolve(docsDir, p) : resolve(APP_DIR, "__no_docs__", p));


// The README is checked alongside the papers because it is the first thing a
// reviewer opening the repository reads, and on 2026-08-28 it was the most
// stale document in the project: 117 tests against 207, 23 scenarios against
// 28, 6 negative controls against 11, and an early sampling figure the 24-hour
// window had superseded. Nothing checked it, so nothing said so.
const DEFAULT_PAPERS = [
  // The hand-written parts the journal candidate is assembled from. Added
  // 2026-09-01: the candidate is read here, so their claims looked covered
  // transitively, and a planted wrong incident count in the abstract survived
  // that path because no pattern matched its wording. Reading the sources
  // directly means every check applies to them rather than only the ones whose
  // phrasing happens to overlap. They are the only claim-bearing documents in
  // either repository the checker had never opened.
  // The application's own route file, which carries the detector count in the
  // page description served to every visitor and rendered into every link
  // preview. Added 2026-09-01: it is the one place a count claim reaches a
  // reader who has opened neither paper, and nothing read it.
  "src/routes/index.tsx",
  // The panel shown when the live feed refuses, which is what a reviewer sees
  // whenever the upstreams are rate-limiting, and both were refusing on the day
  // this was added. It names the scenario count, the reconstruction count and
  // the negative-control count in the one screen that stands in for the
  // application when the application cannot show anything.
  "src/components/FeedUnavailable.tsx",
  // The about page, which described the corpus as twenty-three scenarios with
  // six negative controls until 2026-09-01: both counts were years of the
  // project out of date and both were being served to anyone who opened the
  // page. Found by grepping the interface for spelled-out numbers after the
  // panel above turned one up.
  "src/routes/about.tsx",
  // llms.txt, the machine-readable site summary served at /llms.txt. It
  // describes this work to anything that crawls the site and states the
  // incident count. Added 2026-09-01 after the about page turned out to be
  // advertising a corpus two revisions old; this is the same kind of artifact,
  // read by more things and by fewer people.
  "../web/src/pages/llms.txt.ts",
  // The ICSPIS abstract is plain text, not markdown, because the submission
  // form rejected a paste that included the notes around it. The outreach
  // directory scan filters on .md, so the one document that was actually
  // submitted to a conference was the one document not checked, while its notes
  // file beside it was. Listed explicitly for that reason.
  // The JOAS manuscript, and the same lesson one level worse. The ICSPIS
  // abstract was the one document actually submitted and the one document not
  // checked. This one is under peer review at a journal as submission 9105,
  // and until 2026-09-02 nothing here read it either, because the scan filters
  // on .md and it is LaTeX. Its structural counts were verified by hand that
  // day and all agreed; the point of listing it is the revision that has not
  // happened yet, when an edit under review is exactly when a number drifts
  // and exactly when nobody can afford it to.
  "../web/src/papers/atc-decision-support.md",
  "README.md",
  // Travels with the repository and feeds the Zenodo deposit that Section 8.4
  // names as the first adoption step. It described sixteen scenarios, seven
  // incidents and six US airports until 2026-08-29.
  "CITATION.cff",
  // The research cards on the site and the homepage are rendered from these
  // subtitles, so they are a published claim about the artifact like any other.
  "../web/src/lib/research.ts",
  // The other paper this site publishes, added 2026-08-29. It carries no
  // countable claim this script knows about, so only the cross-reference and
  // cited-path checks bite, and both are worth having: it is 17,500 words with
  // thirty internal references and nothing had ever checked one of them. It was
  // absent because the list grew around the ATC work rather than around the
  // question of which published documents exist.
  "../web/src/papers/the-living-map.md",
  // Every engineering note under docs/, read from the directory rather than
  // listed. Four were listed here first, chosen by grepping for the detector
  // and scenario counts, and that missed eleven of the fifteen: a note can
  // quote the paper, cite a path or reference a section without ever stating a
  // count. Listing them by hand reproduced in miniature the defect this whole
  // pass is about, which is a checked set that grew around what was being
  // described instead of around which documents exist. A directory read cannot
  // fall behind the directory.
  ...readdirSync(resolve(APP_DIR, "docs"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `docs/${f}`),
];

// The long-form documents live in a sibling checkout, so they cannot be
// required: a clean checkout of this repo alone has no such directory and the
// script must still pass there. They are checked when present and reported as
// skipped when not, because the alternative found in the first draft of this
// list was to leave them out entirely, and that put the two highest-stakes
// documents in the project outside every automated check while the four
// lowest-stakes ones were covered. A reader of the summary line can now see
// how many of the six were actually read.
const OPTIONAL_PAPERS = [
  docs("atc_whitepaper.md"),
  
  // Added last, and it is the document with the most riding on it: the profile
  // a professional reviewer reads. It restates the findings count, the test
  // count and the scenario count from the papers, and nothing had ever read it,
  // so it said sixty-two findings against a list of sixty-three. The list grew
  // around the papers rather than around the question of which documents make
  // claims about the artifact.
  
  // Found by the same sweep, and worse: the IEEE Senior Member application
  // said 146 automated tests against 224, so its number was two corrections
  // behind while the profile's was one. Both describe the artifact to a reader
  // who cannot check it.
  
  // Worst of the three when it was added: 126 automated tests, three
  // corrections behind, and a six-scenario negative-control corpus that has
  // held eleven. It is labelled with the date of the pass it described, which
  // is honest and did not stop an attorney reading it as current state.
  
  // That checkout had no entry point until 2026-09-01, so its six
  // scripts and its four principal documents were reachable only by listing
  // directories. Its README lists them, and listing a path is a claim that
  // the path exists, which is what this check is for.
  docs("README.md"),
  // The sibling checkout's copy of The Living Map, which this site also publishes as
  // the-living-map.md. Two copies of one paper with no generator between them
  // is the arrangement that put a stale thesis in that checkout until it was
  // deleted on 2026-08-25. The prose is currently identical; the copies differ
  // only in that this one carries a title block and PNG figures for the PDF
  // while the published one uses mermaid. Reading both means a claim that goes
  // stale in one and not the other is reported rather than waited for.
  docs("whitepaper_final.md"),
  // The two ATC outreach folders, which hold what actually gets sent. Their
  // page counts went stale twice: the NASA Ames README said 19 pages against
  // 21 while carrying the instruction to "check the page count against the
  // file rather than this sentence", and the dormant MITRE follow-up said 19
  // as of today's date while warning that "this line has already gone stale
  // once". A warning that a number may be stale is not a check, and both were
  // wrong on the day they were dated.
  //
  // Discovered rather than named. The list held "12-atc-stakeholder" and
  // "13-nasa-ames" because those were the folders that existed when the ATC
  // outreach began, which is the list growing around the work rather than
  // around which documents make claims. `14-adsb-feeds` was created later and
  // states "seventeen airports" in an email addressed to a data provider, and
  // nothing read it. Every outreach folder is scanned now, and the employment
  // letters that make no claim about the prototype print nothing, which costs
  // one line of output each and removes the question of when to extend the
  // list.
  ...(() => {
    const root = resolve(APP_DIR, docs("outreach"));
    if (!existsSync(root)) return [];
    const entries = readdirSync(root, { withFileTypes: true });
    // The folder's own index sits beside the folders and would be skipped by a
    // directories-only scan, which is the same one-document hole in miniature.
    const loose = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => docs(`outreach/${e.name}`))
      .sort();
    const nested = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .flatMap((dir) =>
        readdirSync(resolve(root, dir))
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((f) => docs(`outreach/${dir}/${f}`)),
      );
    return [...loose, ...nested];
  })(),
];
const args = process.argv.slice(2);
const testsIdx = args.indexOf("--tests");
const claimedTests = testsIdx >= 0 ? Number.parseInt(args[testsIdx + 1], 10) : null;
// The guard on testsIdx matters. Without --tests, testsIdx is -1, so
// `i !== testsIdx + 1` excludes index 0 and silently drops the first explicit
// path: one path given, the run checked the six defaults instead; two given, it
// checked only the second. Both reported a clean result for documents nobody
// asked about. That is the second defect in this one line, after the version
// recorded below that used the empty result, and both had the same shape.
const skipIdx = testsIdx >= 0 ? testsIdx + 1 : -1;
const explicit = args.filter((a, i) => !a.startsWith("--") && i !== skipIdx);
// Fall back to the default when only flags were given. The first version of
// this line filtered the flags out and then used the empty result, so the
// script reported zero claims checked and exited zero: a checker that passes
// by checking nothing, which is the same shape as the negative controls that
// asserted silence without running their doctrine.
// Resolved against the working directory, not import.meta.url, because that is
// what readFileSync below does for every entry in both lists. Basing the
// existence test on the script's own directory instead would have declared
// every optional paper missing while the required ones resolved fine, and the
// script would have reported a clean skip rather than a broken path.
const optionalPresent = OPTIONAL_PAPERS.filter((f) => existsSync(locate(f)));
const optionalMissing = OPTIONAL_PAPERS.filter((f) => !optionalPresent.includes(f));
const explicitPapers = explicit.map((p) => ({ label: p, file: resolve(p) }));
// The sibling's own documents come from its manifest, already absolute, and are
// labelled by basename so the output does not print the private checkout's path
// on every line. Reported by name when the manifest lists something that is not
// there, for the same reason the optional list is: a document that vanished
// should not read as a clean pass over a smaller set.
const manifestPaths = manifestDocs();
const manifestMissing = manifestPaths.filter((f) => !existsSync(f));
const manifestPresent = manifestPaths
  .filter((f) => existsSync(f))
  .map((f) => ({ label: f.split("/").slice(-1)[0], file: f }));
const defaultPapers = [
  ...[...DEFAULT_PAPERS, ...optionalPresent].map((p) => ({
    label: p,
    file: locate(p),
  })),
  ...manifestPresent,
];
// Deduplicated by resolved path. The manifest and the inline list overlap on
// the documents that are not sensitive to name, and reading one twice would
// double every claim it carries and report a document count nobody could match
// against the directory.
const dedupe = (list) => {
  const seen = new Set();
  return list.filter(({ file }) => !seen.has(file) && seen.add(file));
};
const papers = dedupe(explicit.length > 0 ? explicitPapers : defaultPapers);

const { SCENARIOS } = await import("../src/sim/scenarios.ts");
const { runAllRules } = await import("../src/sim/rules.ts");
const { AIRPORTS } = await import("../src/sim/airports.ts");

const rules = readFileSync(new URL("../src/sim/rules.ts", import.meta.url), "utf8");
const numFrom = (src, name) => {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*(-?[\\d.]+)`));
  return m ? Number(m[1]) : null;
};
const liveAdsb = readFileSync(
  new URL("../src/sim/live-adsb.ts", import.meta.url),
  "utf8",
);
const runwayInferSrcEarly = readFileSync(
  new URL("../src/sim/runway-infer.ts", import.meta.url),
  "utf8",
);
const crossTrackNm = numFrom(runwayInferSrcEarly, "MAX_CROSS_TRACK_NM");
const rangeNm = numFrom(liveAdsb, "RANGE_NM");
const dmodNm = numFrom(rules, "DMOD_NM");
const verticalCriticalFt = numFrom(rules, "VERTICAL_CRITICAL_FT");

const predictSrc = readFileSync(
  new URL("../src/sim/predict.ts", import.meta.url),
  "utf8",
);

// The projection horizons. Both papers state them twice each, once in minutes
// as words and once in seconds as digits, and all four sentences describe one
// array. Adding a fourth horizon or dropping one would leave every one of them
// wrong with nothing to say so.
const horizonsMin = (
  predictSrc.match(/const\s+PREDICTIONS_MIN\s*=\s*\[([^\]]+)\]/)?.[1] ?? ""
)
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n));

const runwayInfer = readFileSync(
  new URL("../src/sim/runway-infer.ts", import.meta.url),
  "utf8",
);

// The angular gates, read from the constants that define them. Both papers
// describe them in prose, "inside a 30-degree gate" and "runway identity on
// 20", and those sentences are load-bearing: the section on the units error
// turns on the two gates being different sizes. Nothing checked them, so
// retuning either constant would have left four sentences across two papers
// describing a system that no longer exists, silently, which is the shape of
// every other defect this script was built for.
//
// Exactly the two constants the prose calls gates, and no others. The first
// version also admitted FINAL_ALIGNMENT_DEG, which is the tolerance for
// treating an arrival as established on final and happens to be 30. Retuning
// COURSE_GATE_DEG from 30 to 25 then changed nothing the check could see,
// because 30 was still in the set by way of an unrelated constant, and the
// papers' "30-degree gate" went on passing. A membership test is only as
// strong as the set is tight.
const gateDegrees = new Set(
  [
    ...rules.matchAll(/const\s+ALIGN_TOLERANCE_DEG\s*=\s*(\d+)/g),
    ...runwayInfer.matchAll(/const\s+COURSE_GATE_DEG\s*=\s*(\d+)/g),
  ].map((m) => Number(m[1])),
);
const types = readFileSync(new URL("../src/sim/types.ts", import.meta.url), "utf8");

// The Alert union, taken from the first `category:` field in types.ts. That is
// the right block today and there is nothing in the syntax guaranteeing it stays
// the first, so the extraction is checked against two members it must contain
// rather than trusted. A wrong block would otherwise produce a plausible number
// and report every document as stale against it, which is the failure mode this
// script exists to prevent rather than commit.
// Every filename under apps/atc, for checking citations written as a bare
// basename. The path check below requires a directory prefix, so `src/...` and
// `scripts/...` were verified while the six script names the outreach paper
// cites in backticks were not checked at all: a rename would have left them
// pointing at nothing with no test failing. Resolving a bare name to any file
// with that basename is deliberately weaker than resolving a full path, because
// a document naming `types.ts` is not claiming it sits in scripts/. It still
// catches the case that actually happens, which is a file being renamed or
// deleted while the prose keeps its old name.
const FILE_NAMES = new Set();
{
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // dist is build output: walking it is slow and would index generated
      // filenames that no source tree has, so a citation could resolve against
      // an artifact rather than a file someone can open.
      if (entry.name === "node_modules" || entry.name === "data") continue;
      if (entry.name === "dist" || entry.name === "build") continue;
      if (entry.name.startsWith(".")) continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else FILE_NAMES.add(entry.name);
    }
  };
  walk(APP_DIR);
  // apps/web too, which holds the papers themselves and research.ts. The index
  // walked only this app and the sibling repository, so a document citing
  // `research.ts` was reported as citing a file that does not exist while the
  // file sat two directories away. The index has to cover wherever the cited
  // files are, not wherever the checker happens to live.
  {
    const web = resolve(APP_DIR, "../web");
    if (existsSync(web)) walk(web);
  }
  // The sibling repository too, when it is there. Its own documents cite its
  // own scripts, and indexing only this app reported build-whitepaper-pdf.sh as
  // missing on the first run: a checker confidently wrong about a file sitting
  // next to the document that names it.
  for (const optional of optionalPresent) {
    const repoRoot = resolve(APP_DIR, optional, "..");
    if (existsSync(repoRoot)) walk(repoRoot);
  }
}

const alertCategories = new Set(
  [...(types.match(/category:[^;]*;/s)?.[0] ?? "").matchAll(/"([a-z-]+)"/g)].map(
    (m) => m[1],
  ),
);
for (const required of ["runway-conflict", "proximity-conflict"]) {
  if (!alertCategories.has(required)) {
    console.error(
      `alert-category extraction found no "${required}" in the block it read ` +
        `from types.ts, so it is reading the wrong union. Refusing to check ` +
        `category counts against ${alertCategories.size} of something else.`,
    );
    process.exit(2);
  }
}
// Counted from the exported DETECTORS list rather than from spread calls in
// runAllRules. It read `...detectX(state)` until 2026-09-02, when the
// population became an ordered exported list so a detector could be left out
// for an ablation. The pattern then matched nothing and the check reported
// the code as having zero detectors against eleven claimed, which is the
// right failure: a checker coupled to the shape of the source should break
// loudly when the shape changes, not silently agree.
// Count claims read by hand and found correct, in documents this project cannot
// annotate. The inline <!-- claim-verified --> marker is the normal escape and
// it needs a document somebody can edit freely. The JOAS manuscript is not one:
// it is under peer review as submission 9105, and a second copy is published in
// the open-data archive with a single-commit history, so annotating it for the
// benefit of a checker means force-pushing a live archive during review. That
// is worse than a precise allowlist.
//
// Precise is the operative word. Each entry names the document, the check, the
// claimed value and a fragment of the sentence, so a NEW mismatch in the same
// document still fails. This is not "skip counts in the manuscript".
//
// All seven were read on 2026-09-02 and are the checker over-matching, which its
// own comments predict for these patterns: specific subset claims such as "two
// detectors run on synthesised inputs" and "three negative controls from NASA
// ASRS reports", a historical count correctly qualified as what the corpus held
// at the time, and the negative-control pattern catching "28-scenario corpus".
const VETTED = [
  ["joas/main.tex", "detector count", 2, "reimplementation of two detectors"],
  ["joas/main.tex", "detector count", 2, "two detectors run on synthesised inputs"],
  ["joas/main.tex", "negative-control count", 2, "Two negative controls were passing"],
  ["joas/main.tex", "negative-control count", 3, "three negative controls from NASA"],
  ["joas/main.tex", "negative-control count", 28, "28-scenario corpus"],
  ["joas/main.tex", "scenario count", 23, "all 23 scenarios the corpus held at the time"],
];

const vettedByHand = (doc, label, claimed, sentence) =>
  VETTED.some(
    ([d, l, c, fragment]) =>
      doc.endsWith(d) &&
      l === label &&
      c === claimed &&
      sentence.replace(/\s+/g, " ").includes(fragment),
  );

const detectors = [...rules.matchAll(/category: "([a-z-]+)", run: detect/g)].map(
  (m) => m[1],
);

const truth = {
  detectors: new Set(detectors).size,
  airports: Object.keys(AIRPORTS).length,
  // ICAO prefix K, which covers the contiguous United States and nothing
  // else. Alaska (PA) and Hawaii (PH) would be counted as international by
  // this rule. That is deliberate rather than overlooked: the registry has
  // no country field, and adding PANC would raise the total here while
  // leaving the US figure alone, so a paper updated to say eleven would be
  // reported as a mismatch instead of quietly agreeing with a wrong rule.
  usAirports: Object.keys(AIRPORTS).filter((k) => k.startsWith("K")).length,
  // The other half of the same breakdown. Ten US and seven international were
  // both stated in two documents and only the first was checked, which is the
  // blind spot finding 49 records: verifying the parts of a breakdown one at a
  // time leaves the ones nobody wrote a pattern for unverified, and they look
  // identical to the ones that pass.
  intlAirports: Object.keys(AIRPORTS).filter((k) => !k.startsWith("K")).length,
  // Read off the Alert union in types.ts, which is what baseline-compare.mjs
  // asserts emitters against. The thesis said eight remaining categories from
  // the day the type held eight until 2026-08-29, through three additions,
  // while the assertion it cited covered all eleven the whole time.
  // Scoped to the category field, not to every string union in the file. The
  // first version matched any line of the form | "some-token" and counted 20
  // across unrelated unions, which is the failure this checker exists to make
  // loud: it reported a mismatch against a number nothing in the papers claims.
  alertCategories: alertCategories.size,
  scenarios: SCENARIOS.length,
  incidents: SCENARIOS.filter((s) => s.id.startsWith("incident-")).length,
  negativeControls: SCENARIOS.filter((s) => s.id.startsWith("negative-control")).length,
  // The third kind. The README and CITATION.cff both broke the corpus down as
  // "28 scenarios: 9 incidents, 11 negative controls", which accounts for
  // twenty and left eight unmentioned anywhere: the operational
  // demonstrations a reviewer is told to load from the scenario picker. Both
  // stated figures were correct and both were checked, which is how a third of
  // the corpus went missing from its own summary.
  //
  // Counted rather than summed. A first attempt added up the numbers in the
  // breakdown sentence and compared against the total, and reported "ok" on
  // the README opening, where the parts it added were a subdivision of the
  // incident count and the flight number of American 11. It reached 28 by
  // coincidence.
  otherScenarios: SCENARIOS.filter(
    (s) => !s.id.startsWith("incident-") && !s.id.startsWith("negative-control"),
  ).length,
  tests: claimedTests,
};

// Incident scenarios whose NAME states what kind of event it was. Numbers are
// not the only claim in a paper that can go stale: on 2026-08-28 the whitepaper
// called incident-jfk-2026 "a 2026 JFK go-around" when the scenario is an
// airborne near-miss between two departures, and called the LaGuardia aborted
// takeoff a runway incursion. Both were wrong against the code, both disagreed
// with the other paper, and no numeric check could see either.
//
// Only the scenarios whose name contains an event-type phrase are checkable
// this way. "Tenerife", "Avianca 052" and "Comair 5191" name a place or a
// flight and say nothing a paper could contradict, so they are not checked
// here rather than being checked loosely.
// `phrase` is the wording the scenario name uses and is what the check reports;
// `also` lists wordings that describe the same kind of event and are therefore
// not the defect this looks for. The findings ledger calls the Potomac case "the
// 2025 Potomac collision", which is correct, and demanding the exact string
// "mid-air" would have been a checker asking prose to match its own vocabulary
// rather than the facts. What it still catches is a document calling a mid-air
// something structurally different, a runway incursion or a ground collision.
const EVENT_PHRASES = [
  { id: "incident-dca-2025", phrase: "mid-air", also: ["midair collision", "collision"] },
  { id: "incident-lga-2025", phrase: "aborted takeoff", also: ["rejected takeoff", "aborted its takeoff"] },
  { id: "incident-jfk-2026", phrase: "airborne near-miss", also: ["near-miss", "loss of separation"] },
];
// Hyphens and case vary between the scenario names and the papers' prose
// ("Mid-Air" against "midair"), and that variation is not the defect being
// looked for.
const loose = (t) => t.toLowerCase().replace(/[-\u2011\u2013\u2014\s]+/g, "");

// Number words the papers actually use. Deliberately short: an unmapped word
// is reported rather than silently skipped, so the list cannot rot quietly.
// One through six were absent until 2026-08-29, and their absence was not a
// gap in coverage but a hole in the middle of it: a claim written with a small
// number word matched no pattern at all, so the run printed "no claim found"
// and passed. The defect this list exists to catch was CITATION.cff saying
// "six US airports" against ten, which is the exact token that was missing.
// Regression-testing the airport check by planting that sentence is what
// exposed it; the plant produced two fewer claims checked and zero problems,
// which is the failure mode this script was written to make impossible.
const HUNDREDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

const WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
  // The tens, all of them. This list was extended by hand four times, from a
  // start at seven, then to twenty, to seventy, and finally here, and every
  // ceiling was found the same way: a real claim printed UNPARSED with the
  // word, which is the designed behaviour and why the edge is a nuisance
  // rather than a silent pass.
  //
  // The third extension was called a fix for the class. It was not. It added
  // the compound rule below, which splits a hyphenated word and adds the
  // halves, and that rule looks BOTH halves up here; with the tens stopping at
  // seventy it could reach seventy-nine and no further. The ledger reaching
  // eighty printed UNPARSED again. The tens are a closed set of eight words,
  // so listing all of them is what actually ends this: units below twenty plus
  // every ten, with the compound rule covering the ninety-nine values between.
  // The explicit compounds that used to sit here are gone, since the rule
  // produces them.
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Compounds are composed rather than listed. WORDS has been extended twice by
// hand, first from a list starting at seven and then up to seventy, and each
// time the ceiling was found by a real claim printing UNPARSED: "Seventy-one"
// was the third. A tens-plus-units word is two words joined by a hyphen, so
// splitting on the hyphen and adding the halves covers every value to
// ninety-nine without another list. The parts are still checked against WORDS,
// so a hyphenated non-number stays unparsed rather than becoming a wrong
// number, which is the failure mode that matters here.
// "One hundred" is two words, and the ledger reached it on 2026-08-31. The
// ceiling this file had been extended to four times was ninety-nine, and the
// prediction recorded here was that a hundred would print UNPARSED. It did not:
// the patterns capture ONE token before the noun, so a two-word number matches
// nothing and the check disappears instead of complaining. The claims-checked
// total fell by two and no findings-count line was printed at all, which is the
// silent-skip shape this file exists to prevent, in this file.
const asNumber = (token) => {
  const words = String(token).trim().toLowerCase().split(/\s+/);
  // "<unit> hundred" and "<unit> hundred and <rest>". The second form arrived
  // one finding after the first, and it split the two checks that read this:
  // the restated-count pattern had been widened to capture the "and" clause so
  // it printed UNPARSED, while the findings-count pattern had not and went
  // silent again. Both are widened now and both forms parse here.
  if (words.length >= 2 && words[1] === "hundred") {
    const scale = HUNDREDS[words[0]];
    if (scale === undefined) return null;
    if (words.length === 2) return scale * 100;
    if (words.length >= 4 && words[2] === "and") {
      const rest = asNumber(words.slice(3).join(" "));
      return rest === null || rest >= 100 ? null : scale * 100 + rest;
    }
    return null;
  }
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  const lower = token.toLowerCase();
  if (WORDS[lower] !== undefined) return WORDS[lower];
  const parts = lower.split("-");
  if (parts.length === 2) {
    const tens = WORDS[parts[0]];
    const units = WORDS[parts[1]];
    if (tens !== undefined && units !== undefined && tens >= 20 && tens % 10 === 0 && units < 10) {
      return tens + units;
    }
  }
  return null;
};

// Each check is a pattern with a capture group holding the claimed count, and
// the truth key it must equal. Patterns are written against the phrasing the
// papers use rather than a general parser, because a general parser would
// silently match the wrong sentence.
// Only match where a NUMBER stands in the slot. The first version accepted any
// word there and duly reported "so detectors" and "the detectors" as unparsed
// claims, which buries the real mismatches in noise.
// Longest first. "twenty" before "twenty-four" only works because the engine
// backtracks into the rest of the pattern, which is a property of this
// particular alternation rather than something to rely on: sorting by length
// makes the longer word win outright and stops a future pattern that happens
// not to backtrack from capturing "thirty" out of "thirty-six".
// The pattern has to know the SHAPE of a compound, not a list of compounds.
// WORDS was doing double duty here, supplying both the values to parse and the
// alternatives to match, so trimming the explicit compounds out of it stopped
// "twenty-eight scenarios" matching as a compound at all: the alternation fell
// back to the bare "eight" inside it and reported a claim of 8 against 28,
// eight times across the documents. A tens-unit compound is generated from the
// two closed sets instead, and listed first so it wins against the bare unit.
const TENS = Object.keys(WORDS).filter((w) => WORDS[w] >= 20 && WORDS[w] % 10 === 0);
const UNITS = Object.keys(WORDS).filter((w) => WORDS[w] < 10);
// The hundreds forms belong here too, and not only in the two findings-count
// patterns that were widened when the ledger reached one hundred. Every count
// check in CHECKS resolves NUM, so a paper writing "two hundred and thirty-seven
// tests" instead of digits would match nothing and the check would vanish rather
// than complain, which is exactly what happened to the findings count. Listed
// before the shorter alternatives so the longest form wins.
const HUNDREDS_WORDS = Object.keys(HUNDREDS);
const TENS_UNITS = `(?:${TENS.join("|")})-(?:${UNITS.join("|")})`;
const NUM =
  "(\\d+|" +
  `(?:${HUNDREDS_WORDS.join("|")})\\s+hundred(?:\\s+and\\s+(?:${TENS_UNITS}|${Object.keys(WORDS).join("|")}))?|` +
  `${TENS_UNITS}|` +
  Object.keys(WORDS)
    .sort((a, b) => b.length - a.length)
    .join("|") +
  ")";
// Spaces in a pattern become \s+ so a claim wrapped across lines still matches.
// CITATION.cff wraps its abstract at the YAML fold, which split "11 negative
// controls" over two lines and made the claim invisible to a literal space.
const rx = (body, flags = "gi") =>
  new RegExp(body.replace(/NUM/g, NUM).replace(/(?<!\\)\s(?![*+?])/g, "\\s+"), flags);

const CHECKS = [
  // Why this first pattern is deliberately loose, and why seven lines across the
  // documents carry a claim-verified marker reading "a subset that does
  // something, not a count of the population": population claims and subset
  // claims are not separable by pattern. "The eleven detectors cover" is a
  // population claim and "two detectors cannot" is a subset, but the whitepaper
  // abstract writes "alerting from eleven small detectors" with no article at
  // all, in the same shape as the subsets. Requiring the definite article would
  // stop reporting the abstract's claim, silently, in every document at once.
  // Over-matching and exempting by hand is louder and smaller: the cost is seven
  // annotated lines, and the alternative cost is a missed claim that prints
  // "no claim found", which is the line a document making no claim prints. Do
  // not tidy the markers away by narrowing this.
  { key: "detectors", label: "detector count", patterns: [
    rx("NUM (?:deterministic )?(?:doctrine |doctrinal )?detectors"),
    rx("NUM-detector population"),
    // The submitted ICSPIS abstract opens "Eleven small, independent,
    // deterministic detector functions compose the conflict-alerting layer",
    // and the pattern above wants the count adjacent to the noun. The headline
    // number of the one document sent to a conference went unchecked on a word
    // order the papers happen not to use.
    rx("NUM small, independent, deterministic detector functions"),
    // "the detector population is nine" sat three paragraphs below "the
    // population is eleven detectors" on one page of the thesis until
    // 2026-08-29, and this script passed seven detector-count claims on that
    // same file without seeing it, because neither pattern above matches a
    // count that trails the noun. Second time a missed phrasing has reported
    // success; the test count did it in the appendix.
    rx("detector population is NUM"),
    rx("population is NUM detectors"),
    // Third missed phrasing, found the same way as the first two: by reading a
    // paragraph rather than by the checker reporting anything. Section 6.9 said
    // "eight doctrines to the population's eight" while the population was
    // eleven, and no pattern above matches a count that trails a possessive.
    // Only where the count ends the clause. "the population's eleven, with no
    // suppression" is a detector count; "the population's one critical" is an
    // alert count, and the first version of this pattern reported the second
    // as a stale detector claim, which is a checker inventing a mismatch.
    rx("population's NUM(?=[,.])"),
    rx("population's NUM detectors"),
  ]},
  { key: "negativeControls", label: "negative-control count", patterns: [
    rx("NUM[- ]scenario negative-control corpus"),
    // Same panel: "an eleven-scenario corpus that must stay silent".
    rx("NUM[- ]scenario corpus"),
    // about.tsx: "eleven form a negative-control corpus that must stay quiet".
    rx("NUM form a negative-control corpus"),
    // Not preceded by a dot: "6.8 Negative controls" is a heading and its "8"
    // is a section number, which this matched on the first attempt.
    rx("(?<![.\\d])NUM negative controls"),
    rx("corpus now holds NUM scenarios"),
    rx("negative controls \\(NUM\\)"),
  ]},
  { key: "incidents", label: "incident count", patterns: [
    rx("NUM incidents were reconstructed"),
    rx("NUM incidents,"),
    rx("NUM incidents reconstructed"),
    rx("NUM documented incidents"),
    // The ICSPIS abstract and its notes write "nine incident reconstructions",
    // a phrasing none of the patterns above reached, so the figure a conference
    // submission asserts was unguarded while every paper's copy of it was not.
    rx("NUM incident reconstructions"),
    // The handoff document writes "28 scenarios; 9 reconstruct documented
    // incidents", where the count trails a semicolon and leads a verb.
    rx("NUM reconstruct documented incidents"),
    rx("NUM publicly-documented incidents"),
    // The T-AES abstract writes "reconstructs nine incidents from", which none
    // of the six patterns above reach. Found 2026-09-01 by planting a wrong
    // count in taes-parts/abstract.md, rebuilding the candidate and watching
    // the checker report no problems. That paragraph is the most-read one in
    // the submission, and it was the only claim-bearing document in either
    // repository that this file never opened, so the miss compounded: an
    // unchecked source feeding a checked document is only as guarded as the
    // patterns that happen to match its wording.
    rx("reconstructs NUM incidents"),
    // FeedUnavailable.tsx: "including nine reconstructions of documented
    // accidents". The corpus calls them reconstructions in the surface text and
    // incidents in the papers, so both spellings need a pattern.
    rx("NUM reconstructions of documented accidents"),
  ]},
  // Thirteen airport-count claims sat across all six documents with no check
  // on any of them until 2026-08-29, and CITATION.cff had said "six US
  // airports" against ten for as long as it had existed. The patterns are
  // narrow on purpose: the papers also report false-positive sampling "at five
  // US airports", which is a different quantity that happens to share the noun,
  // so a general "NUM airports" would report the registry count against a
  // sampling figure and be wrong in both directions at once.
  { key: "alertCategories", label: "alert-category count", patterns: [
    rx("NUM remaining categories"),
    rx("all NUM have emitters"),
    rx("NUM (?:alert )?categories have emitters"),
    rx("grown to NUM"),
  ]},
  { key: "airports", label: "airport count", patterns: [
    rx("NUM airports of which"),
    rx("NUM airports in the registry"),
    // Same phrasing gap, same document: "seventeen airports ingested".
    rx("NUM airports ingested"),
    // The summary document writes "live ADS-B and weather ingest for
    // seventeen airports, 226 automated tests", which none of the shapes above
    // reach. Anchored rather than a bare "NUM airports": collapsing all of
    // these to that shape was tried on 2026-08-31 and reported twelve
    // mismatches, every one a window describing the three or five fields it
    // sampled, against the one real claim it added. Twelve exemption markers to
    // catch one drift is the patterns being narrowed in the other direction.
    //
    // "ingest for" and "weather for" were two anchors until an email to a data
    // provider wrote "for seventeen airports and nothing else", which neither
    // reached. One "for NUM airports" covers all three and matches none of the
    // twelve subset sentences, which is the difference between widening a
    // pattern and abandoning the anchor.
    rx("for NUM airports"),
    rx("NUM airports via the route"),
    rx("NUM airports, NUM of them"),
    rx("NUM airports, NUM US"),
    rx("NUM airports \\(NUM US"),
    rx("NUM airports:"),
  ]},
  { key: "intlAirports", label: "international airport count", patterns: [
    // Case-sensitive. The thesis cites "the 7th International Conference on
    // Research in Air Transportation" and "the 8th International Joint
    // Conference", and a case-insensitive pattern is one ordinal away from
    // reporting a reference list as a stale airport count.
    rx("NUM international", "g"),
  ]},
  { key: "usAirports", label: "US airport count", patterns: [
    rx("NUM are in the United States"),
    rx("NUM of them in the United States"),
    // Definite article. "at five US airports" is the sampling claim and carries
    // no "the"; "the ten US airports" names the NASR subset of the registry.
    rx("the NUM US airports"),
    rx("airports \\(NUM US"),
    rx("airports, NUM US and"),
  ]},
  { key: "otherScenarios", label: "demonstration-scenario count", patterns: [
    rx("NUM operational demonstrations"),
  ]},
  { key: "scenarios", label: "scenario count", patterns: [
    rx("NUM frozen scenarios"),
    rx("NUM scenarios:"),
    rx("NUM scenarios,? of which"),
    // "across all N scenarios" is a claim about the whole corpus and no shape
    // above reached it. Found by listing every no-claim-found result where the
    // noun sits beside a number in the same document: twelve such cases, ten
    // legitimate subsets like "four passages describing a detector", and two
    // population claims going unchecked. One of the two was a sentence written
    // the same day. A pattern list cannot be complete, so the way to extend it
    // is to ask which documents contain the noun and a number and still report
    // nothing found, rather than waiting for a stale claim to be noticed.
    rx("all NUM scenarios"),
    // The comma is not cosmetic. The IEEE Senior Member application wrote
    // "Twenty-four scenarios, of which nine reconstruct documented incidents"
    // against a corpus of 28, and the pattern above without the optional comma
    // matched nothing, so the check printed "no claim found" for a document
    // that plainly makes the claim. Found by auditing the no-claim-found lines
    // rather than the failures, because a document that states a count and a
    // document that states none look identical in that output.
    // "twenty-eight scenarios are unchanged" is how the units-fix section
    // states the corpus size, and no pattern above saw it, so the thesis
    // reported "scenario count: no claim found" while making the claim twice.
    // Anchored on "unchanged" rather than the looser "NUM scenarios are",
    // which would also match "nine scenarios are reconstructions built from
    // published reports" and report a true subset statement as a stale count.
    rx("NUM scenarios (?:are )?unchanged"),
    // "11 deterministic detectors, 28 scenarios" is how the handoff and the
    // profile state the corpus size, and no pattern above saw it. Anchored on
    // the preceding "detectors," rather than the looser "NUM scenarios;",
    // because a semicolon follows subset counts too ("nine scenarios; each
    // one a reconstruction") and matching those reports a true statement as a
    // stale count. The detector clause only ever precedes the corpus total.
    rx("detectors, NUM scenarios"),
    // FeedUnavailable.tsx: "no indication that twenty-eight deterministic
    // scenarios are one keystroke away". Added 2026-09-01 with the file, which
    // is the panel a reviewer meets whenever the upstream feeds refuse.
    rx("NUM deterministic scenarios"),
  ]},
  { key: "tests", label: "test count", patterns: [
    /(\d+) tests? (?:at this revision|pass)/gi,
    /test suite \((\d+) tests/gi,
    // Appendix A.4 phrasing. It read "now holds 76 tests" against an actual
    // 207 on 2026-08-28, three stale counts after this script was written to
    // stop exactly that, because the claim was worded in a way none of the
    // patterns above matched. A checker that misses a phrasing reports "no
    // claim found", which reads identically to a paper that makes no claim.
    /holds (\d+) tests/gi,
    /#\s*(\d+) tests/gi,
    // Comma or colon. The README writes 'tests: one per claim' and this pattern
    // required a comma, so a count that had been stale at 310 since well
    // before 2026-09-02 sat two lines below a correct one and was never read.
    /(\d+) tests[,:] one per claim/gi,
    // The long-form documents phrase it this way and carried 146 against 207.
    /(\d+) automated tests/gi,
  ]},
];

// The findings ledger is the ground truth for how many findings there are, so
// it is read once here rather than per document. Any other document stating
// the count is then checked against the list itself instead of against the
// ledger's own prose, which is a claim rather than a source. PROFILE_FOR_
// COUNSEL.md carried "There are sixty-two so far" against a list of sixty-
// three, and nothing read it: the existing check keys on the ledger's own
// heading, so a count restated anywhere else was unguarded.
const countFindings = (text) => {
  const marker = text.match(/\*\*The self-correction record[^*]*\*\*/);
  if (!marker) return null;
  const tail = text.slice(text.indexOf(marker[0]));
  let n = 0;
  for (const m of tail.matchAll(/^(\d+)\. /gm)) {
    if (Number(m[1]) !== n + 1) break;
    n = Number(m[1]);
  }
  return n || null;
};

const thesisFile = papers.find((p) => p.file.endsWith("atc-decision-support.md"));
let thesisNorm = null;
if (thesisFile) {
  try {
    thesisNorm = readFileSync(thesisFile.file, "utf8").replace(/\s+/g, " ");
  } catch {
    // absent; the quotation check reports as skipped rather than passing
  }
}

// The ledger is identified by a role tag in the sibling's manifest rather
// than by its filename, for the same reason the list moved there: naming it
// here discloses it. A manifest line may carry a trailing [ledger] tag.
const ledgerFile = papers.find((p) => manifestRoles.get(p.file) === "ledger");
let ledgerFindings = null;
if (ledgerFile) {
  try {
    ledgerFindings = countFindings(readFileSync(ledgerFile.file, "utf8"));
  } catch {
    // absent sibling repository; the restated-count check reports as skipped
  }
}

let failures = 0;
let checked = 0;
let exempt = 0;

for (const { label, file } of papers) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // A document inside this app that cannot be read is a fault. One outside it
    // is not: the standalone extraction of this app has no sibling web package
    // and no documents checkout, and counting their absence as eight failures
    // made the published repository fail its own suite on a clean extraction.
    // Every cross-package read in this file skips by name; the document list
    // did not.
    if (label.startsWith("..")) {
      console.log(`\n${label}: skipped, not present beside this app`);
      continue;
    }
    console.error(`cannot read ${label} (looked in ${file})`);
    failures++;
    continue;
  }
  console.log(`\n${label}`);
  for (const { key, label, patterns } of CHECKS) {
    const expected = truth[key];
    if (expected == null) {
      console.log(`  ${label}: skipped, no ground truth supplied`);
      continue;
    }
    let found = false;
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        found = true;
        // A claim may legitimately differ from the current count: a version
        // note describing a run at a named commit, or a subset such as the
        // eight detectable incidents out of nine. Those carry an inline
        // <!-- claim-verified: why --> on the same line, which is invisible in
        // the rendered paper and explicit in the source. Anything unmarked is
        // reported, so the escape hatch cannot be used silently.
        const lineStart = text.lastIndexOf("\n", match.index) + 1;
        let lineEnd = text.indexOf("\n", match.index);
        if (lineEnd === -1) lineEnd = text.length;
        if (text.slice(lineStart, lineEnd).includes("claim-verified")) {
          // Named, not merely counted. The marker is line-scoped on purpose,
          // and the comment on the cited-path check spells out the cost: a
          // marker covering one claim exempts every other claim on its line. On
          // 2026-08-31 the thesis had a marker for an absent test file sitting
          // in the same paragraph as "now holds 227 tests", so the test count
          // in the longest document was exempt by proximity rather than by
          // intent, and the aggregate "N marked claim-verified" said nothing
          // about which claims those were. Printing the matched text makes an
          // accidental exemption look different from a deliberate one.
          console.log(`  ${label}: exempt "${match[0].trim()}"`);
          exempt++;
          continue;
        }
        checked++;
        const claimed = asNumber(match[1]);
        if (claimed === null) {
          console.log(`  ${label}: UNPARSED "${match[1]}" in "${match[0].trim()}"`);
          failures++;
        } else if (claimed !== expected && vettedByHand(
            file,
            label,
            claimed,
            // The captured phrase is only the count and its noun, so the
            // surrounding sentence is what distinguishes "two detectors run
            // on synthesised inputs" from any other "two detectors".
            text.slice(Math.max(0, match.index - 90), match.index + 90),
          )) {
          // Verified by reading, not suppressed by pattern. See VETTED below.
          exempt++;
          console.log(
            `  ${label}: exempt, read by hand (claims ${claimed}) — "${match[0].trim()}"`,
          );
        } else if (claimed !== expected) {
          console.log(`  ${label}: MISMATCH claims ${claimed}, code has ${expected} — "${match[0].trim()}"`);
          failures++;
        } else {
          console.log(`  ${label}: ok (${claimed})`);
        }
      }
    }
    if (!found) console.log(`  ${label}: no claim found`);
  }

  // Section cross-references. Swept by hand on 2026-08-29 and clean, which is
  // the reason to automate it rather than the reason not to: the whitepaper had
  // carried a reference to "Section 6.8" copied from the thesis's numbering,
  // and in a paper with no subsections at all it resolved to nothing. A
  // reference qualified as belonging to another document ("Section 8 of the
  // full thesis") is left alone.
  {
    const headings = new Set();
    for (const line of text.split("\n")) {
      const m = line.match(/^#{2,4}\s+(?:Appendix\s+)?((?:A\.)?\d+(?:\.\d+)*)\b/);
      if (m) headings.add(m[1]);
    }
    // Two lookaheads, not one. (?!\d) and (?!\.\d) together stop the engine
    // backtracking to a shorter number, which is what let "Section 6.7.1 of
    // the thesis" match as "6.7": the "of the" lookahead then saw a "." and
    // succeeded, reporting a cross-document reference as a broken internal
    // one. The earlier single (?![\d.]) did that job but rejected any trailing
    // period at all, so a reference ending a sentence, "see Section 6.8." or
    // "Section 12.", matched nothing and was dropped rather than checked. It
    // read as a clean result over every reference when it was a clean result
    // over the references that happened not to end a sentence. Splitting the
    // lookahead keeps the guard and distinguishes "6.8." from "6.8.1". The i
    // flag was added for the same reason: a reference written mid-sentence as
    // "section 6.8" is ordinary English and was invisible to the check, which
    // is the same silent-drop failure as the trailing period.
    const refs = new Set(
      [...text.matchAll(/Section[s]?\s+((?:A\.)?\d+(?:\.\d+)*)(?!\d)(?!\.\d)(?!\s+of the)/gi)].map(
        (m) => m[1],
      ),
    );
    // Every reference must match a heading exactly, dotted or not. The first
    // version fell back to the parent section, so "Section 6.99" resolved
    // because a section 6 exists and the check passed on a reference to
    // nothing. "Section 6" still resolves under the exact rule, because the
    // section heading is itself numbered and in the set; it needs no fallback,
    // and the ternary that used to express one had two identical branches,
    // which left a comment promising behaviour the code did not have.
    const unresolved = [...refs].filter((r) => !headings.has(r));
    // A document that numbers no subsections cannot hold an internal
    // subsection reference. The ledger heads its sections "00.", "0.",
    // "1." and cites the thesis's 6.7.1, which is another document's numbering
    // and not this one's to resolve.
    const hasDotted = [...headings].some((h) => h.includes("."));
    // A fragment assembled into a larger paper does not own the numbering it
    // cites. taes-parts/related-work.md heads itself "1.1" and refers to
    // Sections 1, 2 and 7, which exist in the assembled candidate and not in
    // the part; requiring it to resolve them is a category error, and the
    // dotted-heading guard above does not catch it because 1.1 is dotted. The
    // discriminator is a top-level heading: a document that never numbers a
    // whole section is a piece of one.
    // A fragment cannot resolve a reference to a whole section it does not
    // contain, but it can resolve one to a subsection it heads. Dropping the
    // whole check for such a document was the first attempt and cost coverage:
    // findings-chain-draft.md heads 6.3 through 6.13 and cites Section 6.3,
    // which is its own, and it stopped being checked at all. So only the
    // top-level references are excused, and only where the document heads no
    // whole section itself.
    const ownsNumbering = [...headings].some((h) => !h.includes("."));
    const answerable = ownsNumbering
      ? unresolved
      : unresolved.filter((r) => r.includes("."));
    if (hasDotted) {
      checked++;
      if (answerable.length === 0) {
        console.log(
          `  cross-references: ok (${refs.size - answerable.length} resolve${
            ownsNumbering ? "" : ", top-level refs excused as a fragment"
          })`,
        );
      } else {
        console.log(`  cross-references: UNRESOLVED ${answerable.join(", ")}`);
        failures++;
      }
    } else if (hasDotted && refs.size > 0) {
      // Named rather than silent: a document that resolves nothing and prints
      // nothing is indistinguishable from one that passed.
      console.log(
        "  cross-references: skipped, this document is a fragment and does not own its numbering",
      );
    }
  }

  // Cited file paths. The thesis said a raw CSV was "preserved at
  // atc-data/fp-kjfk-24h-2026-08-04.csv" and that directory has never existed.
  // A path in backticks reads as a thing a reader can open.
  {
    const cited = new Set(
      [...text.matchAll(
        /`((?:apps\/atc\/|src\/|scripts\/|docs\/|functions\/|atc-data\/)[A-Za-z0-9_./+-]+\.(?:ts|tsx|mjs|py|md|csv|json|sh))`/g,
      )].map((m) => m[1]),
    );
    const appRoot = new URL("..", import.meta.url).pathname;
    // A cited path is resolved against the prototype app and, for a document
    // that lives elsewhere, against its own directory too. Every path cited by
    // the long-form documents until now pointed into this repository, so the
    // single root was never wrong and never right for a reason: the first time
    // the findings ledger cited a script of its own, scripts/find-duplicate-
    // docs.py, it was reported MISSING while sitting beside the document that
    // named it. A path is relative to the document that writes it.
    const docRoot = `${dirname(file)}/`;
    const missing = [];
    for (const c of cited) {
      const rel = c.startsWith("apps/atc/") ? c.slice("apps/atc/".length) : c;
      if (existsSync(`${appRoot}${rel}`) || existsSync(resolve(docRoot, c))) continue;
      // A path the document explicitly says is absent is the finding, not a
      // defect. Those carry claim-verified on the same line, like counts do.
      //
      // "Same line" is the rule everywhere here, and it couples prose layout to
      // what gets checked. Rewrapping a paragraph moved a marker off the claim
      // it covered on 2026-08-29 and produced a loud false failure, which is
      // the harmless direction. The other one is not: joining a line carrying a
      // marker to a line carrying a genuine stale claim exempts the stale claim
      // and prints nothing. If a marker ever needs to cover a claim that is not
      // on its line, move the marker, never widen the rule.
      const idx = text.indexOf("`" + c + "`");
      const lineStart = text.lastIndexOf("\n", idx) + 1;
      let lineEnd = text.indexOf("\n", idx);
      if (lineEnd === -1) lineEnd = text.length;
      if (text.slice(lineStart, lineEnd).includes("claim-verified")) {
        exempt++;
        continue;
      }
      missing.push(c);
    }
    // Bare basenames, resolved against the index above rather than a directory.
    const bare = new Set(
      // md added 2026-08-31. The list held code and CITATION.cff and omitted the
      // extension the engineering notes actually use to cite each other, which
      // is why four such citations across docs/ were checked by nothing. The
      // omission was arbitrary rather than a decision: there is no reason a
      // renamed .ts should be caught and a renamed note should not. All four
      // resolve today, so this guards correct citations rather than fixing a
      // defect, and it is the same one-token widening that the airport anchor
      // and the number-word list each needed.
      [...text.matchAll(/`([A-Za-z0-9_+-]+\.(?:ts|tsx|mjs|py|sh|cff|md))`/g)].map(
        (m) => m[1],
      ),
    );
    for (const b of bare) {
      if (FILE_NAMES.has(b)) {
        cited.add(b);
        continue;
      }
      const idx = text.indexOf("`" + b + "`");
      const ls = text.lastIndexOf("\n", idx) + 1;
      let le = text.indexOf("\n", idx);
      if (le === -1) le = text.length;
      if (text.slice(ls, le).includes("claim-verified")) {
        exempt++;
        continue;
      }
      missing.push(b);
    }
    if (cited.size > 0) {
      checked++;
      if (missing.length === 0) {
        console.log(`  cited paths: ok (${cited.size} exist)`);
      } else {
        console.log(`  cited paths: MISSING ${missing.join(", ")}`);
        failures++;
      }
    }
  }

  // The pooled per-pair figure the papers lean on hardest is re-derived here
  // when the dumps are present. Added 2026-09-01, after the neighbouring
  // sentence reporting 46 violations was found to reproduce from nothing while
  // this one reproduces exactly. Window dumps are gitignored, so this SKIPS
  // rather than fails when data/ is absent: a check that fails on a clean clone
  // gets disabled, and a check that silently passes there would be worse than
  // none. The still-sampling window is excluded the same way imc-pool.py
  // excludes it, by tag, because its rows are the difference between 167 and
  // the 165 the papers state.
  {
    const claim = text.match(
      /(\d{2,4}) pairs of which (\d{1,4}) violate/,
    );
    if (claim) {
      checked++;
      const dir = locate("data");
      let dumps = [];
      try {
        dumps = readdirSync(dir).filter(
          (f) => f.startsWith("pairs-") && f.endsWith(".csv"),
        );
      } catch {
        dumps = [];
      }
      const usable = dumps.filter(
        (f) => !stillSampling(f.slice("pairs-".length, -".csv".length)),
      );
      if (usable.length === 0) {
        console.log(
          "  pooled pair figure: skipped, no window dumps on this checkout",
        );
      } else {
        let pairs = 0;
        let violating = 0;
        for (const f of usable) {
          const lines = readFileSync(resolve(dir, f), "utf8")
            .split("\n")
            .filter((l) => l.trim().length > 0);
          if (lines.length < 2) continue;
          const cols = lines[0].split(",");
          const gapAt = cols.indexOf("gap_nm");
          const reqAt = cols.indexOf("required_nm");
          if (gapAt === -1 || reqAt === -1) continue;
          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            const gap = Number(cells[gapAt]);
            const req = Number(cells[reqAt]);
            if (!Number.isFinite(gap) || !Number.isFinite(req)) continue;
            pairs++;
            if (gap < req) violating++;
          }
        }
        const wantPairs = Number(claim[1]);
        const wantViol = Number(claim[2]);
        if (pairs === wantPairs && violating === wantViol) {
          console.log(
            `  pooled pair figure: ok (${pairs} pairs, ${violating} violating)`,
          );
        } else {
          console.log(
            `  pooled pair figure: MISMATCH dumps give ${pairs} pairs and ` +
              `${violating} violating, this document says ${wantPairs} and ${wantViol}`,
          );
          failures++;
        }
      }
    }
  }

  // The same pooled figure appears in a source comment, and no check in this
  // file reads source comments. Added 2026-09-01 after rules.ts was found still
  // citing 45 of 46 violations as the evidence for capping radar-floor alerts
  // in visual conditions, months of revisions after that count stopped being
  // reproducible. Prose in a paper is audited on every run; prose in the file
  // the audit is written from is not, and the second kind is what the next
  // person reads before changing the rule. Runs once, not per document.
  if (!rulesCommentChecked) {
    rulesCommentChecked = true;
    const src = readFileSync(resolve(APP_DIR, "src/sim/rules.ts"), "utf8");
    const m = src.match(/(\d+) of (?:the )?(\d+) violations are against a radar floor/);
    if (m) {
      checked++;
      const dir = locate("data");
      let dumps = [];
      try {
        dumps = readdirSync(dir).filter(
          (f) => f.startsWith("pairs-") && f.endsWith(".csv"),
        );
      } catch {
        dumps = [];
      }
      const usable = dumps.filter(
        (f) => !stillSampling(f.slice("pairs-".length, -".csv".length)),
      );
      if (usable.length === 0) {
        console.log(
          "  rules.ts pooled figure: skipped, no window dumps on this checkout",
        );
      } else {
        let floor = 0;
        let violating = 0;
        for (const f of usable) {
          const lines = readFileSync(resolve(dir, f), "utf8")
            .split("\n")
            .filter((l) => l.trim().length > 0);
          if (lines.length < 2) continue;
          const cols = lines[0].split(",");
          const g = cols.indexOf("gap_nm");
          const r = cols.indexOf("required_nm");
          if (g === -1 || r === -1) continue;
          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            const gap = Number(cells[g]);
            const req = Number(cells[r]);
            if (!Number.isFinite(gap) || !Number.isFinite(req)) continue;
            if (gap >= req) continue;
            violating++;
            // The radar floor is 2.5 or 3 NM; anything larger is a wake minimum.
            if (req <= 3) floor++;
          }
        }
        if (Number(m[1]) === floor && Number(m[2]) === violating) {
          console.log(
            `  rules.ts pooled figure: ok (${floor} of ${violating} against the floor)`,
          );
        } else {
          console.log(
            `  rules.ts pooled figure: MISMATCH dumps give ${floor} of ${violating}, ` +
              `the comment says ${m[1]} of ${m[2]}`,
          );
          failures++;
        }
      }
    }
  }

  // The seeded-weather share, re-derived where the snapshot dumps exist. The
  // papers state it as evidence that a defaulted field cannot be audited using
  // fields that share its default, and the number moves whenever a window is
  // added, so it gets the same treatment as the pooled pair figure: recomputed
  // when the data is here, skipped by name when it is not.
  {
    const claim = text.match(
      /which is (\d[\d,]*) of (\d[\d,]*): the three fields move/,
    );
    if (claim) {
      checked++;
      const dir = locate("data");
      let files = [];
      try {
        // Still-sampling windows are excluded the same way the pooled pair
        // figure excludes them. Without this the total climbs while a window
        // is open, so the check fails every few minutes against a paper that
        // was correct when written: observed 2026-09-01 going from 3,065 to
        // 3,069 inside ten minutes. A check that demands prose track a live
        // counter is not a check, it is a treadmill.
        files = readdirSync(dir).filter(
          (f) =>
            f.startsWith("fp-") &&
            f.endsWith(".csv") &&
            !f.includes("kjfk-run") &&
            !stillSampling(f.replace(/^fp-[a-z0-9]+-/, "").replace(/\.csv$/, "")),
        );
      } catch {
        files = [];
      }
      if (files.length === 0) {
        console.log(
          "  seeded-weather share: skipped, no snapshot dumps on this checkout",
        );
      } else {
        let seeded = 0;
        let total = 0;
        for (const f of files) {
          const lines = readFileSync(resolve(dir, f), "utf8")
            .split("\n")
            .filter((l) => l.trim().length > 0);
          if (lines.length < 2) continue;
          const cols = lines[0].split(",");
          const v = cols.indexOf("visibility_nm");
          const c = cols.indexOf("ceiling_ft");
          const w = cols.indexOf("wx_condition");
          if (v === -1 || c === -1 || w === -1) continue;
          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            if (!cells[w]) continue;
            total++;
            if (cells[v] === "10" && cells[c] === "20000") seeded++;
          }
        }
        const wantSeeded = Number(claim[1].replace(/,/g, ""));
        const wantTotal = Number(claim[2].replace(/,/g, ""));
        if (seeded === wantSeeded && total === wantTotal) {
          console.log(`  seeded-weather share: ok (${seeded} of ${total})`);
        } else {
          console.log(
            `  seeded-weather share: MISMATCH dumps give ${seeded} of ${total}, ` +
              `this document says ${wantSeeded} of ${wantTotal}`,
          );
          failures++;
        }
      }
    }
  }

  // The outreach paper embeds three PNGs and the thesis renders three mermaid
  // diagrams, and until 2026-09-01 nothing connected them: the images were
  // built before the thesis carried any mermaid at all. They were compared by
  // opening them and they agree, and the mermaid was extracted to
  // the documents checkout so the pictures have a recorded source. This checks the
  // extracted source still matches the thesis, which is the half of the drift
  // that can be automated; the PNG itself still has no renderer, so a change to
  // the diagram will pass here and leave the image stale, and that limit is
  // stated rather than implied. Runs once, not per document.
  if (!diagramsChecked) {
    diagramsChecked = true;
    const dir = resolve(APP_DIR, docs("diagrams"));
    let sources = [];
    try {
      sources = readdirSync(dir).filter((f) => f.endsWith(".mmd")).sort();
    } catch {
      sources = [];
    }
    if (sources.length === 0) {
      console.log("  diagram sources: skipped, none present on this checkout");
    } else {
      checked++;
      const thesis = readFileSync(
        resolve(APP_DIR, "../web/src/papers/atc-decision-support.md"),
        "utf8",
      );
      const blocks = [...thesis.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(
        (m) => m[1].trim(),
      );
      const drifted = [];
      if (blocks.length !== sources.length) {
        drifted.push(
          `${blocks.length} mermaid blocks against ${sources.length} sources`,
        );
      }
      sources.forEach((file, index) => {
        const body = readFileSync(resolve(dir, file), "utf8")
          .split("\n")
          .filter((line) => !line.startsWith("%%"))
          .join("\n")
          .trim();
        if (body !== blocks[index]) drifted.push(file);
      });
      if (drifted.length === 0) {
        console.log(`  diagram sources: ok (${sources.length} match the thesis)`);
      } else {
        console.log(`  diagram sources: DRIFTED ${drifted.join(", ")}`);
        failures++;
      }
    }
  }

  // The site lists an "updated" date for each paper, and nothing compared it to
  // the paper. It read 2026-08-29 while the thesis discussed events from
  // 2026-09-01, so a reader was told the document was three days older than its
  // own contents. The comparison used here is the paper's own newest dated
  // reference: a document that describes something happening on a day cannot
  // have last been updated before it. That is a lower bound rather than an
  // equality, since a revision can add prose without adding a date, and a lower
  // bound is what catches the case that happened. Runs once, not per document.
  if (!updatedDatesChecked) {
    updatedDatesChecked = true;
    // The research index belongs to the sibling web package, which does not
    // exist in the standalone extraction of this app. Reading it unguarded made
    // the suite crash outright there rather than skip, so the repository that
    // gets published failed its own tests on a clean extraction. Every other
    // cross-package read in this file already skips by name; this one did not.
    const indexPath = resolve(APP_DIR, "../web/src/lib/research.ts");
    const index = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
    if (index === null) {
      console.log("  research index dates: skipped, no web package beside this app");
    } else {
    const stale = [];
    for (const paper of ["atc-decision-support", "the-living-map"]) {
      const entry = index.slice(index.indexOf(`slug: "${paper}"`));
      const updated = entry.match(/updated: "(\d{4}-\d{2}-\d{2})"/)?.[1];
      if (!updated) continue;
      let body;
      try {
        body = readFileSync(
          resolve(APP_DIR, `../web/src/papers/${paper}.md`),
          "utf8",
        );
      } catch {
        continue;
      }
      const dates = [...body.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(
        (m) => m[1],
      );
      if (dates.length === 0) continue;
      const newest = dates.sort().at(-1);
      if (newest > updated) stale.push(`${paper}: updated ${updated}, cites ${newest}`);
    }
    checked++;
    if (stale.length === 0) {
      console.log("  research index dates: ok (no paper outruns its updated date)");
    } else {
      console.log(`  research index dates: STALE ${stale.join("; ")}`);
      failures++;
    }
    }
  }

  // The section listing what cuts against the results states how many there
  // are and then enumerates them, and nothing compared the two. It is the
  // section a reviewer weighs most, and the failure mode is silent: adding an
  // eighth counter-finding without touching the heading leaves a paper
  // claiming to disclose seven while disclosing eight, which reads as an
  // undercount of its own honesty rather than an overcount of its results.
  // Whitespace is normalised first because the source is hard-wrapped and an
  // ordinal can straddle a line break, which defeated the first attempt at
  // counting these by hand.
  {
    const flat = text.replace(/\s+/g, " ");
    const stated = flat.match(
      /\b(Two|Three|Four|Five|Six|Seven|Eight|Nine) (?:findings|things) (?:that )?cut against/,
    );
    if (stated) {
      checked++;
      const words = ["one","two","three","four","five","six","seven","eight","nine"];
      const target = words.indexOf(stated[1].toLowerCase()) + 1;
      const ordinals = [
        "first","second","third","fourth","fifth","sixth","seventh","eighth","ninth",
      ];
      const from = flat.indexOf(stated[0]);
      const segment = flat.slice(from, from + 3000);
      let found = 0;
      for (const word of ordinals) {
        if (segment.includes(`The ${word} is`)) found++;
      }
      if (found === 0) {
        // The thesis states "Three results cut against this" and then runs
        // them as plain paragraphs with no ordinals, which this cannot count.
        // Skipped by name rather than failed: a check that cannot see the
        // enumeration has not found a mismatch, it has found a different
        // style, and reporting that as a defect trains a reader to ignore it.
        console.log(
          "  counter-findings: skipped, this document does not enumerate them with ordinals",
        );
      } else if (found === target) {
        console.log(`  counter-findings: ok (${target} stated, ${found} enumerated)`);
      } else {
        console.log(
          `  counter-findings: MISMATCH ${target} stated, ${found} enumerated`,
        );
        failures++;
      }
    }
  }

  // The proximity geometry split, re-derived where the dumps exist. Added
  // 2026-09-01 when it settled an engineering note that had been open since
  // August, and quoted in both papers as an independent check on the
  // parallel-approach result. Skips by name without dumps, like the pooled
  // pair figure, because the windows are not committed.
  {
    const flatText = text.replace(/\s+/g, " ");
    const poolClaim = flatText.match(
      // The word before "window dumps" is not always the number: the
      // documents say "seven settled window dumps", and capturing the
      // adjacent word gave NaN and a mismatch against a correct document.
      /([\d,]+) (?:proximity )?pairs[^.]{0,90}?(\w+)(?: settled)? window dumps/,
    );
    const claim = flatText.match(
      // Both papers state this and word it differently: one reads "in-trail,
      // ... 69.2 per cent diagonal", the other "in trail against 69.2 per cent
      // diagonal". Whitespace is normalised first because the sources are
      // hard-wrapped and the phrase straddles a line break in one of them.
      /(\d+\.\d) per cent in.{0,6}trail.{0,60}?(\d+\.\d) per cent diagonal/,
    );
    if (claim || poolClaim) {
      checked++;
      const dir = locate("data");
      let dumps = [];
      try {
        // Excluding windows still sampling, which the pooled-pair check has
        // always done and this one did not. Same dumps, two different rules,
        // and the consequence was a figure that could not be written down: the
        // total moved from 6,933 to 6,934 in the minutes between stating it in
        // three documents and checking them, because a live window was still
        // appending rows. A count over a set that includes a file being
        // written is not a measurement.
        dumps = readdirSync(dir).filter(
          (f) =>
            f.startsWith("prox-") &&
            f.endsWith(".csv") &&
            !stillSampling(f.slice("prox-".length, -".csv".length)),
        );
      } catch {
        dumps = [];
      }
      if (dumps.length === 0) {
        console.log("  proximity geometry: skipped, no window dumps on this checkout");
      } else {
        let inTrail = 0;
        let diagonal = 0;
        let total = 0;
        for (const f of dumps) {
          const lines = readFileSync(resolve(dir, f), "utf8")
            .split("\n")
            .filter((l) => l.trim().length > 0);
          if (lines.length < 2) continue;
          const cols = lines[0].split(",");
          const ctAt = cols.indexOf("cross_track_nm");
          const atAt = cols.indexOf("along_track_nm");
          if (ctAt === -1 || atAt === -1) continue;
          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            const ct = Math.abs(Number(cells[ctAt]));
            const at = Math.abs(Number(cells[atAt]));
            if (!Number.isFinite(ct) || !Number.isFinite(at) || ct + at === 0) continue;
            total++;
            const share = at / (ct + at);
            if (share >= 0.8) inTrail++;
            else if (share > 0.2) diagonal++;
          }
        }
        // The pair total and the dump count are stated beside the
        // percentages and were not checked, so both went stale twice in one
        // afternoon while the percentages held: 6,899 to 6,918 to 6,933 across
        // three window closures, with 19.0 and 69.2 unmoved throughout. A
        // figure that moves whenever a window closes needs a guard more than a
        // stable one does, not less.
        {
          const stated = poolClaim;
          if (stated) {
            // asNumber rather than a local table. The table this replaces
            // stopped at ten, and on 2026-09-02 an eleventh window closed, so a
            // paper correctly updated to say "eleven settled window dumps"
            // produced "this document says 7282 in NaN" and read as the paper
            // being wrong. A lookup sized for the data as it was, in a file
            // whose whole purpose is catching numbers that have moved.
            const claimedPairs = Number(stated[1].replace(/,/g, ""));
            const claimedDumps = asNumber(stated[2]) ?? Number(stated[2]);
            if (claimedPairs !== total || claimedDumps !== dumps.length) {
              console.log(
                `  proximity pool: MISMATCH dumps hold ${total} pairs in ${dumps.length} file(s), this document says ${claimedPairs} in ${claimedDumps}`,
              );
              failures++;
            } else {
              console.log(
                `  proximity pool: ok (${total} pairs, ${dumps.length} dumps)`,
              );
            }
          }
        }
        const pct = (n) => Number(((100 * n) / total).toFixed(1));
        if (!claim) {
          // States the pool and not the percentages, which the table in
          // proximity-first-read.md does.
        } else if (pct(inTrail) === Number(claim[1]) && pct(diagonal) === Number(claim[2])) {
          console.log(
            `  proximity geometry: ok (${pct(inTrail)}% in-trail, ${pct(diagonal)}% diagonal of ${total})`,
          );
        } else if (
          (() => {
            // The findings ledger records what a measurement gave on the day it
            // was taken, and a later window moves the pooled figure without
            // making the record wrong. Those entries carry the same line-scoped
            // <!-- claim-verified: why --> marker the count checks honour. This
            // check had no exemption path at all, so on 2026-09-02 the only way
            // to make it pass was to rewrite a historical entry, which would
            // turn the ledger into a running total instead of a record.
            const start = text.lastIndexOf("\n", claim.index) + 1;
            let end = text.indexOf("\n", claim.index);
            if (end === -1) end = text.length;
            return text.slice(start, end).includes("claim-verified");
          })()
        ) {
          exempt++;
          console.log(
            `  proximity geometry: exempt, marked claim-verified (says ${claim[1]} and ${claim[2]})`,
          );
        } else {
          console.log(
            `  proximity geometry: MISMATCH dumps give ${pct(inTrail)} and ${pct(diagonal)}, ` +
              `this document says ${claim[1]} and ${claim[2]}`,
          );
          failures++;
        }
      }
    }
  }

  // How close the recorded violations sit to their thresholds, which both
  // papers state as evidence that the count is sensitive to measurement error.
  // Added 2026-09-01 with the measurement. Skips by name without dumps.
  {
    const flat = text.replace(/\s+/g, " ");
    const claim = flat.match(
      /(\d+) sit\s*within 0\.05 NM of (?:their|the) requirement, (\d+) within 0\.10 and (\d+) within 0\.20/,
    );
    if (claim) {
      checked++;
      const dir = locate("data");
      let dumps = [];
      try {
        dumps = readdirSync(dir).filter(
          (f) => f.startsWith("pairs-") && f.endsWith(".csv"),
        );
      } catch {
        dumps = [];
      }
      const usable = dumps.filter(
        (f) => !stillSampling(f.slice("pairs-".length, -".csv".length)),
      );
      if (usable.length === 0) {
        console.log("  violation margins: skipped, no window dumps on this checkout");
      } else {
        const deficits = [];
        for (const f of usable) {
          const lines = readFileSync(resolve(dir, f), "utf8")
            .split("\n")
            .filter((l) => l.trim().length > 0);
          if (lines.length < 2) continue;
          const cols = lines[0].split(",");
          const g = cols.indexOf("gap_nm");
          const r = cols.indexOf("required_nm");
          if (g === -1 || r === -1) continue;
          for (const line of lines.slice(1)) {
            const cells = line.split(",");
            const gap = Number(cells[g]);
            const req = Number(cells[r]);
            if (!Number.isFinite(gap) || !Number.isFinite(req) || gap >= req) continue;
            deficits.push(req - gap);
          }
        }
        const within = (b) => deficits.filter((d) => d <= b + 1e-9).length;
        const got = [within(0.05), within(0.1), within(0.2)];
        const want = [Number(claim[1]), Number(claim[2]), Number(claim[3])];
        if (got.every((n, i) => n === want[i])) {
          console.log(`  violation margins: ok (${got.join(", ")} within 0.05, 0.10, 0.20 NM)`);
        } else {
          console.log(
            `  violation margins: MISMATCH dumps give ${got.join(", ")}, this document says ${want.join(", ")}`,
          );
          failures++;
        }
      }
    }
  }

  // The papers count this script's own dump-dependent checks, and that number
  // went stale the moment a fifth was added, two hours after the sentence was
  // written and verified. A count describing a codebase is a claim about the
  // codebase and goes stale from the same edit that makes it worth stating, so
  // it is checked here against the source rather than maintained by hand. The
  // skip strings are the marker because every such check must emit one; a
  // check that recomputes from dumps and does not say so when they are missing
  // is the defect this counts, not an omission from the tally.
  {
    // Not one-shot. Both papers carry this sentence, and a single run guards
    // whichever is read first and leaves the other free to drift: planting a
    // stale count in the second one passed silently until this was changed.
    // One-shot is right for a check that reads the same source every time and
    // wrong for one that reads the document, which is the distinction the
    // first two attempts here got backwards in opposite directions.
    const self = readFileSync(
      locate("scripts/verify-paper-claims.mjs"),
      "utf8",
    );
    const actual = (
      self.match(/skipped, no (?:window|snapshot) dumps/g) ?? []
    ).length;
    const stated = text
      .replace(/\s+/g, " ")
      .match(/(\w+) of its checks recompute figures from the window dumps/);
    if (stated) {
      checked++;
      const words = { three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
      const claimed = words[stated[1].toLowerCase()] ?? Number(stated[1]);
      if (claimed === actual) {
        console.log(`  dump-dependent check count: ok (${actual})`);
      } else {
        console.log(
          `  dump-dependent check count: MISMATCH the script has ${actual}, this document says ${claimed}`,
        );
        failures++;
      }
    }
  }

  // Where a paper says imc-pool.py prints the recorded and admitted counts
  // together, that sentence describes a script's output, and no other check in
  // this file compares prose against what a script does. The gap is on record:
  // both papers once said the pooler "reports no data rather than zero" as the
  // concrete evidence for a reproducibility limit, and a later improvement to
  // the script made the sentence false with nothing to catch it. This does not
  // run the script, which needs window data; it requires the print statement
  // the prose describes to still be in the source.
  {
    const describes = text.includes(
      "prints it as one line on a checkout that holds the windows",
    );
    if (describes) {
      checked++;
      const poolSrc = readFileSync(locate("scripts/imc-pool.py"), "utf8");
      const hasBoth =
        poolSrc.includes("recorded pairs:") && poolSrc.includes("admitted:");
      if (hasBoth) {
        console.log("  imc-pool.py output: ok (prints recorded and admitted)");
      } else {
        console.log(
          "  imc-pool.py output: MISMATCH the paper describes a line this script no longer prints",
        );
        failures++;
      }
    }
  }

  // Measurement-window tags cited in prose must name a window the pooling
  // script knows about. Added 2026-09-01 after a sentence attributed a figure
  // to "the window closed on 2026-08-29" and three windows closed that day, so
  // the citation could not be checked at all. The repair is to quote the tag,
  // and a quoted tag is only worth more than a date if it is a real one: a
  // typo in `imc-2026-08-291331` points at nothing and reads as precise.
  // CORRECTED_WINDOWS in imc-pool.py is the authority rather than the contents
  // of data/, because window dumps are gitignored and a check that consults
  // them would pass here and fail on a clean clone.
  {
    const poolSrc = readFileSync(
      locate("scripts/imc-pool.py"),
      "utf8",
    );
    const known = new Set();
    // Both lists count: CORRECTED_WINDOWS is what pools, SUPERSEDED_WINDOWS is
    // what ran under older doctrine and is still cited by name. A tag in
    // neither is a typo or a window nothing records.
    for (const name of ["CORRECTED_WINDOWS = [", "SUPERSEDED_WINDOWS = ["]) {
      const at = poolSrc.indexOf(name);
      if (at === -1) continue;
      for (const m of poolSrc
        .slice(at, poolSrc.indexOf("]", at))
        .matchAll(/"([^"]+)"/g))
        known.add(m[1]);
    }
    if (known.size === 0) {
      console.log("  window tags: CANNOT READ CORRECTED_WINDOWS in imc-pool.py");
      failures++;
    } else {
      const cited = new Set(
        [...text.matchAll(/`(tuned\d+|imc-[0-9-]{8,})`/g)].map((m) => m[1]),
      );
      const unknown = [...cited].filter((t) => !known.has(t));
      if (cited.size > 0) {
        checked++;
        if (unknown.length === 0) {
          console.log(`  window tags: ok (${cited.size} named, all known)`);
        } else {
          console.log(
            `  window tags: UNKNOWN ${unknown.join(", ")} not a known window tag`,
          );
          failures++;
        }
      }
    }
  }

  // ASRS report numbers cited in prose must match a scenario that encodes that
  // report. Three negative controls carry a specific NASA ASRS report in their
  // name (ACN 2071367, CALLBACK 461, ACN 2069720) and the papers cite two of
  // them by number. A digit wrong in one of those is a citation of a real
  // public record that is not the record described, which no count check and no
  // amount of proofreading reliably catches, and which is worse than a stale
  // number because it looks verifiable.
  {
    const cited = new Set(
      [...text.matchAll(/\b(?:ACN|CALLBACK)\s*#?\s*(\d{3,})/gi)].map(
        (m) => m[1],
      ),
    );
    if (cited.size > 0) {
      checked++;
      const corpus = SCENARIOS.map((x) => x.name).join(" ");
      const unmatched = [...cited].filter((n) => !corpus.includes(n));
      if (unmatched.length === 0) {
        console.log(`  ASRS citations: ok (${cited.size} match the corpus)`);
      } else {
        console.log(
          `  ASRS citations: NO SCENARIO for ${unmatched.join(", ")}`,
        );
        failures++;
      }
    }
  }

  // AIR-26/02 was added to the pattern on 2026-09-02, when correcting the
  // Potomac citation showed the papers had begun naming report numbers as well
  // as dockets and this check could not see them. Widening the pattern alone
  // would have failed, because the corpus held only the docket; the scenario's
  // report field carries both now, which keeps the corpus the authority.
  // The thesis carries a table giving each incident its source, its published
  // cause and the highest-severity alert it produces. The last column is the
  // only place in either paper that states a per-incident severity, and nothing
  // read it: on 2026-09-02 it said the JFK reconstruction produced a warning
  // while the code produced a critical, and it had been wrong for long enough
  // that correcting the scenario changed the answer again, to advisory. The
  // suite already pins each incident's top severity, which is why the drift was
  // invisible; the pin and the paper were never compared.
  //
  // Matched by an explicit token per scenario rather than by row order or by
  // fuzzy name matching, because the table labels the rows differently from the
  // scenario names ("LGA aborted takeoff" against "LaGuardia Aborted Takeoff")
  // and a positional match would pair the wrong rows the moment a row moves.
  {
    const ROW_TOKEN = {
      "incident-tenerife-1977": "Tenerife",
      "incident-avianca052-1990": "Avianca 052",
      "incident-lax-1991": "USAir 1493",
      "incident-linate-2001": "Linate",
      "incident-dca-2025": "Potomac mid-air",
      "incident-lga-2025": "LGA aborted takeoff",
      "incident-jfk-2026": "JFK near-miss",
      "incident-comair5191-2006": "Comair 5191",
    };
    const rows = text
      .split("\n")
      .filter((l) => l.startsWith("| ") && /critical|warning|advisory/.test(l));
    if (rows.length) {
      const RANK = { none: 0, info: 1, advisory: 2, warning: 3, critical: 4 };
      const bad = [];
      let matched = 0;
      for (const [id, token] of Object.entries(ROW_TOKEN)) {
        const row = rows.find((l) => l.includes(token));
        if (!row) continue;
        const scenario = SCENARIOS.find((x) => x.id === id);
        if (!scenario) continue;
        matched++;
        const top = runAllRules(scenario.build()).reduce(
          (acc, a) => (RANK[a.severity] > RANK[acc] ? a.severity : acc),
          "none",
        );
        const stated = ["critical", "warning", "advisory"].filter((w) =>
          row.toLowerCase().includes(w),
        );
        if (!stated.includes(top))
          bad.push(`${token}: table says ${stated.join("/") || "nothing"}, code produces ${top}`);
      }
      if (matched >= 4) {
        checked++;
        if (bad.length === 0) {
          console.log(`  incident severity table: ok (${matched} rows match the code)`);
        } else {
          for (const b of bad) console.log(`  incident severity table: ${b}`);
          failures++;
        }
      }
    }
  }

  // Official accident report identifiers, checked the same way and for the same
  // reason. Each incident scenario carries the report it was reconstructed from
  // in `incident.report`, so the corpus is the authority and no second list is
  // kept. The papers cite AAR-91/04, AAR-91/08, AAR-07/05 and DCA25MA108; the
  // corpus writes the first two as "NTSB/AAR-91/04" against the papers' "NTSB
  // AAR-91/04", which is why the identifier alone is matched rather than the
  // whole string.
  {
    const reports = new Set(
      [...text.matchAll(/\b(AAR-\d{2}\/\d{2}|AIR-\d{2}\/\d{2}|DCA\d{2}[A-Z]{2}\d{3})\b/g)].map(
        (m) => m[1],
      ),
    );
    if (reports.size > 0) {
      docsCitingReports++;
      checked++;
      const corpus = SCENARIOS.map((x) => x.incident?.report ?? "").join(" ");
      const unmatched = [...reports].filter((r) => !corpus.includes(r));
      if (unmatched.length === 0) {
        console.log(
          `  accident-report citations: ok (${reports.size} match the corpus)`,
        );
      } else {
        console.log(
          `  accident-report citations: NO SCENARIO for ${unmatched.join(", ")}`,
        );
        failures++;
      }
    }
  }

  // Page counts advertised on the research cards, against the PDFs those cards
  // link to. The ATC card read "PDF · 40 pp" while the file was 44: the count
  // moved three times in one day of editing and the card moved never. It sits in
  // a document this script already reads, so the claim was inside the checked
  // set with no pattern to catch it, which is the gap this whole file keeps
  // closing one phrasing at a time.
  //
  // Needs pdfinfo. Skipped by name when it is absent rather than passed over,
  // because a page count that silently stops being checked is how the card got
  // here.
  {
    for (const m of text.matchAll(/slug:\s*"([a-z-]+)"/g)) {
      const slug = m[1];
      // Sliced to the next entry, not to a fixed byte count. 900 characters
      // covered the ATC entry until a comment was added inside it and pushed
      // the chip to 961, at which point the card silently stopped being
      // checked and the summary still read no problems. A window measured in
      // bytes is a magic number waiting for the content to grow.
      const nextSlug = text.indexOf('slug:', m.index + 1);
      const after = text.slice(m.index, nextSlug === -1 ? undefined : nextSlug);
      // Anchored on "PDF ... N pp" without excluding quotes. The first version
      // used [^"]*? and stopped matching the moment a comment containing a
      // quoted phrase was added above the artifacts line, which silently
      // dropped this card from the check while the summary still said no
      // problems. A checker disabled by a comment is the failure this file
      // exists to prevent, committed by the file itself.
      const claimed = after.match(/PDF[^\n]{0,40}?(\d+)\s*pp/);
      if (!claimed) continue;
      const pdf = resolve(APP_DIR, `../web/public/research/${slug}.pdf`);
      if (!existsSync(pdf)) continue;
      checked++;
      const probe = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
      if (probe.status !== 0) {
        checked--;
        console.log(`  page count (${slug}): skipped, pdfinfo not on PATH`);
        continue;
      }
      const actual = Number.parseInt(
        (probe.stdout.match(/^Pages:\s*(\d+)/m) ?? [])[1] ?? "",
        10,
      );
      if (actual === Number.parseInt(claimed[1], 10)) {
        console.log(`  page count (${slug}): ok (${actual} pp)`);
      } else {
        console.log(
          `  page count (${slug}): MISMATCH card says ${claimed[1]} pp, ` +
            `the PDF has ${actual}`,
        );
        failures++;
      }
    }
  }

  // Ordinal chains in headings. The outreach paper promises seven findings that
  // cut against its results and then heads its sections Third, Fourth, Fifth,
  // Sixth and Seventh, with no First and no Second anywhere: a reader met
  // "Third:" never having been told what the first two were. Both existed in the
  // introducing section and were the only two not labelled.
  //
  // Counts get checked because a script can regenerate them. An ordinal chain is
  // a claim too, and nothing regenerated it. Headings are the scope, because a
  // paragraph may legitimately say "two caveats: first, second" without starting
  // a document-wide chain, and the thesis does exactly that.
  {
    const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth",
      "seventh", "eighth", "ninth", "tenth"];
    const used = new Set();
    for (const m of text.matchAll(/^#{2,4}[^\n]*?\b([A-Z][a-z]+):/gm)) {
      const k = ORDINALS.indexOf(m[1].toLowerCase());
      if (k !== -1) used.add(k + 1);
    }
    if (used.size > 0) {
      checked++;
      const highest = Math.max(...used);
      const missing = [];
      for (let n = 1; n <= highest; n++) {
        if (used.has(n)) continue;
        // A lower ordinal may be introduced in prose rather than a heading,
        // which is legitimate; it just has to be somewhere.
        const word = ORDINALS[n - 1];
        const inProse = new RegExp(`\\b(the )?${word}\\b`, "i").test(text);
        if (!inProse) missing.push(word);
      }
      if (missing.length === 0) {
        console.log(`  ordinal chain: ok (runs to ${ORDINALS[highest - 1]})`);
      } else {
        console.log(
          `  ordinal chain: BROKEN headings reach ${ORDINALS[highest - 1]} ` +
            `but ${missing.join(" and ")} appear nowhere`,
        );
        failures++;
      }
    }
  }

  // The doctrine table. Section 5.4 says how many detectors there are and then
  // lists them, and the two had drifted apart: the sentence read eleven, which
  // this script checks, while the table under it carried seven rows and had
  // done through four additions. Weather shift, runway surface, runway identity
  // and emergency squawk were absent from the table that exists to enumerate
  // the population, in the section a reader goes to for what the system does.
  // Third enumeration defect in this file's history, after the abstract's
  // concern list and the airport list, and the same lesson each time: a count
  // and a list of the same thing are two claims, and checking one is not
  // checking the other.
  {
    const heading = text.indexOf("### 5.4");
    // Keyed on the table's own header row, not on the section number. Section
    // 5.4 exists in the other paper this site publishes and is about something
    // else entirely, and keying on the number alone reported that paper as
    // listing zero detectors: a check firing on a document it knows nothing
    // about, which is how a checker manufactures a defect rather than finding
    // one.
    const looksLikeDoctrineTable =
      heading !== -1 && /\|\s*Detector\s*\|/i.test(text.slice(heading, heading + 4000));
    if (looksLikeDoctrineTable) {
      checked++;
      const next = text.indexOf("\n### ", heading + 1);
      const section = text.slice(heading, next === -1 ? undefined : next);
      const rows = section
        .split("\n")
        .filter((l) => l.startsWith("|"))
        .filter((l) => !/^\|\s*-+\s*\|/.test(l));
      // Minus the header row.
      const listed = Math.max(0, rows.length - 1);
      if (listed === truth.detectors) {
        console.log(`  doctrine table: ok (${listed} rows)`);
      } else {
        console.log(
          `  doctrine table: MISMATCH lists ${listed} detectors, ` +
            `code dispatches ${truth.detectors}`,
        );
        failures++;
      }
    }
  }

  // Enumerated populations. A count check cannot see these: the abstract listed
  // ten of the eleven doctrinal concerns and every numeric detector claim in
  // the same document said eleven and was right, so nothing disagreed with
  // anything. The list is the claim, and it is checked as a list.
  //
  // Both honour the inline marker, like every other check here, because the
  // findings ledger quotes the ten-item list verbatim as the defect it is
  // describing and a checker that cannot tell a quotation from a claim forces
  // the prose to paraphrase its own evidence.
  const markedAt = (index) => {
    const start = text.lastIndexOf("\n", index) + 1;
    let end = text.indexOf("\n", index);
    if (end === -1) end = text.length;
    return text.slice(start, end).includes("claim-verified");
  };

  {
    const enumerated = text.match(/(?:\d+|[a-z-]+) airports:\s*([^.]*)\./i);
    if (enumerated && markedAt(enumerated.index)) {
      exempt++;
    } else if (enumerated) {
      checked++;
      const listed = new Set(
        [...enumerated[1].matchAll(/\b([A-Z]{4})\b/g)].map((m) => m[1]),
      );
      const registry = new Set(Object.keys(AIRPORTS));
      // A list naming airports in prose ("Kennedy and Atlanta untuned, then
      // O'Hare and Dallas Fort Worth") is the false-positive sampling set, not
      // the registry, and it carries no ICAO codes to compare. Skipping is
      // correct; reporting seventeen missing codes against it, which the first
      // version did, is a checker matching on a noun and ignoring the subject.
      const missing = [...registry].filter((a) => !listed.has(a));
      const extra = [...listed].filter((a) => !registry.has(a));
      if (listed.size === 0) {
        checked--;
        console.log(
          "  airport enumeration: skipped, this list names airports in prose " +
            "rather than by ICAO code",
        );
      } else if (missing.length === 0 && extra.length === 0) {
        console.log(`  airport enumeration: ok (${listed.size} named)`);
      } else {
        console.log(
          `  airport enumeration: MISMATCH` +
            (missing.length ? ` missing ${missing.join(", ")}` : "") +
            (extra.length ? ` not in registry ${extra.join(", ")}` : ""),
        );
        failures++;
      }
    }
  }

  // Items are counted, not named, because the prose names ("wake-turbulence
  // spacing") deliberately do not match the dispatch identifiers
  // (detectWakeSpacing) and forcing them to would make an abstract read like an
  // API listing.
  {
    const concerns = text.match(/doctrinal concern \(([^)]*)\)/);
    if (concerns && markedAt(concerns.index)) {
      exempt++;
    } else if (concerns) {
      checked++;
      const items = concerns[1].split(",").map((c) => c.trim()).filter(Boolean);
      if (items.length === truth.detectors) {
        console.log(`  concern enumeration: ok (${items.length} listed)`);
      } else {
        console.log(
          `  concern enumeration: MISMATCH lists ${items.length}, ` +
            `code dispatches ${truth.detectors}`,
        );
        failures++;
      }
    }
  }

  // The findings ledger states its own length in prose above the list. Its
  // ground truth is the document rather than the code, so it is checked here
  // rather than in CHECKS: the number moved five times in one day on
  // 2026-08-29 and was corrected by hand each time, which is the condition
  // every other check in this file exists to remove.
  {
    const stated = text.match(
      /\*\*The self-correction record[^*]*\*\*\s+([A-Za-z-]+(?:\s+hundred(?:\s+and\s+[A-Za-z-]+)?)?) findings/,
    );
    // The marker without a parse is the failure that actually happened. At one
    // hundred the number became two words, the single-token capture matched
    // nothing, and this check did not report UNPARSED: it printed nothing at
    // all and the claims total quietly fell by two. Widening the pattern fixed
    // that number and not the class, because the next form it cannot read, a
    // thousand or a hundred-and-word it does not know, fails the same silent
    // way. So the presence of the paragraph is checked separately from the
    // presence of a number in it.
    if (!stated && /\*\*The self-correction record/.test(text)) {
      console.log(
        "  findings count: NOT READ, the self-correction paragraph is here and its number did not parse",
      );
      failures++;
    }
    if (stated) {
      checked++;
      const claimed = asNumber(stated[1]);
      const tail = text.slice(text.indexOf(stated[0]));
      const nums = [...tail.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
      let n = 0;
      for (const value of nums) {
        if (value !== n + 1) break;
        n = value;
      }
      if (claimed === null) {
        console.log(`  findings count: UNPARSED "${stated[1]}"`);
        failures++;
      } else if (claimed !== n) {
        console.log(
          `  findings count: MISMATCH prose says ${claimed}, the list holds ${n}`,
        );
        failures++;
      } else if (nums.some((v) => v > n + 1 && v <= n + 12)) {
        // The run above stops at the first gap, so a ledger that skips 63 and
        // continues at 64 would report 62 and pass while everything past the
        // gap went uncounted. Numbers just above the run mean a dropped entry
        // rather than a shorter list. The window starts at n + 2 and is capped
        // at twelve because the sections after the ledger open numbered lists
        // of their own that restart at 1, and those must not read as findings.
        const orphans = nums.filter((v) => v > n + 1 && v <= n + 12);
        console.log(
          `  findings count: GAP the run ends at ${n} but ${orphans.join(", ")} follow, so an entry is missing`,
        );
        failures++;
      } else {
        console.log(`  findings count: ok (${n})`);
      }
    }
  }

  // Quotations attributed to the thesis in the present tense. Narrow on
  // purpose: it fires only on "Section 5.3 says \"...\"" and close relatives,
  // and only on quotes of thirty characters or more. Present tense is the whole
  // of how a deliberate historical quotation is told from a drifted current
  // one. "Section 6.9 said 'two doctrines postdate the baseline freeze'" is
  // finding 48 quoting the defect it reports, and the sentence goes on to say
  // three do; "Section 5.3 says" asserts what the paper contains now. The
  // grammar already draws that line, so this follows it rather than asking
  // every historical quotation to carry a marker.
  {
    const quoted = [
      ...text.matchAll(
        /Section\s+\d+(?:\.\d+)*\s+(?:says|reads|calls it|describes it as)\s+"([^"]{30,})"/gi,
      ),
    ].map((m) => m[1]);
    if (quoted.length && !file.endsWith("atc-decision-support.md")) {
      if (thesisNorm === null) {
        console.log("  quotations of the thesis: skipped, the thesis is not readable from here");
      } else {
        checked += quoted.length;
        const drifted = quoted.filter((q) => !thesisNorm.includes(q.replace(/\s+/g, " ")));
        if (drifted.length === 0) {
          console.log(`  quotations of the thesis: ok (${quoted.length} verbatim)`);
        } else {
          for (const q of drifted) {
            console.log(`  quotations of the thesis: NOT FOUND "${q.slice(0, 64)}"`);
          }
          failures += drifted.length;
        }
      }
    }
  }

  // One whitespace-normalised copy of the document for every check below that
  // matches a phrase rather than a token. These documents are hard-wrapped at
  // about 78 columns, so any phrase of more than a few words spans a line
  // break and a pattern written as the sentence reads matches nothing and
  // reports nothing, which is indistinguishable from a document that makes no
  // such claim. Two checks written today were already skipping a claim each
  // for exactly this reason: the whitepaper's rotorcraft sentence and its
  // "gates on 30 degrees".
  //
  // The CHECKS table above does not need this, because rx() rewrites every
  // literal space in a pattern to \s+ before compiling it, which is the same
  // fix applied at the other end. Either is fine; pick one on purpose. A
  // hand-written literal regex run against raw `text` is the combination that
  // silently under-reports, and it is the one both of today's new checks
  // reached for.
  const flatText = text.replace(/\s+/g, " ");

  // A PDF named in prose with a page count beside it, resolved against the
  // document's own directory. Distinct from the research-card check below,
  // which knows the site's slug layout; this one only needs the file to sit
  // where the sentence says it does, which is how outreach packages are
  // assembled. Skipped rather than failed when pdfinfo is absent or the file
  // is not there, because neither is a claim about the artifact.
  {
    // The path class carries `/` so a document can cite a PDF that does not sit
    // beside it. The handoff document stated the outreach whitepaper's page
    // count from the repository root while the PDF sits two directories down,
    // and a basename-only pattern resolved it against the wrong directory,
    // found nothing, and skipped. That count was wrong at the time.
    for (const m of flatText.matchAll(/([\w./-]+\.pdf)[^.]{0,60}?(\d+)\s+pages/gi)) {
      const pdf = resolve(dirname(file), m[1]);
      if (!existsSync(pdf)) continue;
      const probe = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
      if (probe.error) {
        console.log(`  attached page count (${m[1]}): skipped, pdfinfo not on PATH`);
        continue;
      }
      const actual = Number((probe.stdout ?? "").match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!Number.isFinite(actual)) continue;
      checked++;
      if (actual !== Number(m[2])) {
        console.log(
          `  attached page count: MISMATCH ${m[1]} is ${actual} pages, this document says ${m[2]}`,
        );
        failures++;
      } else {
        console.log(`  attached page count: ok (${m[1]}, ${actual} pages)`);
      }
    }
  }

  // Stated limitations of the live ingest, checked in the direction that
  // actually fails. Both papers say the feed supplies a vertical rate, a
  // navigation-accuracy category, an emitter category and a multilateration
  // flag, and that this ingest reads none of them. Those sentences are the
  // basis of a declared difference from airborne TCAS, so they matter, and
  // they go stale in an unusual way: not when the code breaks but when it
  // improves. Whoever wires up baro_rate will fix a real limitation and leave
  // two papers claiming it, and nothing else here would notice, because every
  // other check asks whether the prose has fallen behind the code rather than
  // whether the code has moved past the prose.
  {
    const UNREAD = [
      { field: "baro_rate", says: /ingest does not read the vertical rate|vertical test is instantaneous|Vertical rate is supplied and not read/i },
      { field: "nac_p", says: /navigation accuracy category, and .{0,40}most sat|does not read it either/i },
      // Two phrasings for the same claim, because the README words it its own
      // way. A check keyed to one document's sentence covers one document.
      { field: "category", says: /emitter category identifying a rotorcraft|emitter category is not read at all/i },
      { field: "mlat", says: /multilateration-derived rather than broadcast/i },
    ];
    for (const { field, says } of UNREAD) {
      if (!says.test(flatText)) continue;
      checked++;
      if (new RegExp(`\\b${field}\\b`).test(liveAdsb)) {
        console.log(
          `  stated ingest limitation: STALE this document says ${field} is unread and src/sim/live-adsb.ts now references it`,
        );
        failures++;
      } else {
        console.log(`  stated ingest limitation: ok (${field} is still unread)`);
      }
    }
  }

  // Thresholds quoted with their unit, matched only where the prose names the
  // thing the constant governs. Bare numbers are useless here: 3, 30, 40 and 60
  // are all constants and all appear dozens of times in these documents for
  // unrelated reasons, so an enumeration of every constant against every number
  // would report agreement everywhere and mean nothing. These four earn a check
  // because each has one phrasing that can only be about that constant.
  {
    const THRESHOLDS = [
      { re: /within ([\d.]+) NM of cross-track/gi, value: crossTrackNm, what: "cross-track admission" },
      { re: /within (\d+) NM of the airport reference point/gi, value: rangeNm, what: "live ingest radius" },
      { re: /ADS-B within (\d+) NM/gi, value: rangeNm, what: "live ingest radius" },
      { re: /\((\d+(?:\.\d+)?) NM, (\d+) ft\)/g, value: [dmodNm, verticalCriticalFt], what: "proximity threshold pair" },
    ];
    for (const { re, value, what } of THRESHOLDS) {
      for (const m of flatText.matchAll(re)) {
        if (value === null || (Array.isArray(value) && value.some((v) => v === null))) continue;
        checked++;
        const got = Array.isArray(value) ? [Number(m[1]), Number(m[2])] : Number(m[1]);
        const want = value;
        const same = Array.isArray(want) ? got.join() === want.join() : got === want;
        if (same) {
          console.log(`  ${what}: ok (${[got].flat().join(", ")})`);
        } else {
          console.log(
            `  ${what}: MISMATCH prose says ${[got].flat().join(", ")}, the code uses ${[want].flat().join(", ")}`,
          );
          failures++;
        }
      }
    }
  }

  // Projection horizons, in the two forms the papers write them. The seconds
  // form is compared against the constants times sixty; the minutes form is
  // generated from the constants as words and looked for verbatim, so a fourth
  // horizon changes the expected string and the old sentence stops matching.
  // Both forms are optional: a document that states neither is not failed for
  // it, and one that states either is checked on that one.
  if (horizonsMin.length) {
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
    const secs = [...flatText.matchAll(/\+(\d+), \+(\d+),? and \+(\d+) seconds/g)];
    const expectSecs = horizonsMin.map((m) => m * 60);
    for (const m of secs) {
      checked++;
      const got = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (got.join() !== expectSecs.join()) {
        console.log(
          `  projection horizons: MISMATCH prose says ${got.join(", ")} seconds, the code projects ${expectSecs.join(", ")}`,
        );
        failures++;
      } else {
        console.log(`  projection horizons: ok (${got.join(", ")} seconds)`);
      }
    }
    const expectWords =
      horizonsMin.length > 1 && horizonsMin.every((m) => m < WORDS.length)
        ? `${horizonsMin.slice(0, -1).map((m) => WORDS[m]).join(", ")} and ${WORDS[horizonsMin.at(-1)]} minutes`
        : null;
    if (expectWords && /\b(one|two|three|four)[,a-z ]*and [a-z]+ minutes\b/.test(text)) {
      checked++;
      if (text.replace(/\s+/g, " ").includes(expectWords)) {
        console.log(`  projection horizons: ok ("${expectWords}")`);
      } else {
        console.log(
          `  projection horizons: MISMATCH the code projects "${expectWords}" and this document does not say so`,
        );
        failures++;
      }
    }
  }

  // Angular gates named in prose. Only the "N-degree gate" and "gates on N
  // degrees" constructions, which name a threshold, never the many sentences
  // that report a measured angle: "the spread across strips was 14.8 degrees"
  // is data, not a gate, and a check that could not tell them apart would fire
  // on every measurement in Section 6.7.
  //
  // Membership, not identity: it asserts the number is one of the gate
  // constants, not which gate the sentence means. That catches a retuned
  // constant, which is the drift that happens, and would not catch a sentence
  // that swapped the two gates, which has not. Stated so the limit is visible
  // rather than discovered later.
  {
    const gates = [
      ...flatText.matchAll(/(\d+)[- ]degree gate/gi),
      ...flatText.matchAll(/gates? on (\d+) degrees/gi),
      // "20-degree inference gate", "the 20 degree tolerance" and "the gate
      // widened to 30 degrees" are all statements of a gate constant, and the
      // two shapes above reached none of them: they require "degree gate" and
      // "gate on N degrees" adjacently. One engineering note stated the gates
      // four times in prose with nothing checking any of it. Widening took the
      // checked total from 239 to 255 with no mismatches, so every one of those
      // sixteen statements already agreed with the code and none needed an
      // exemption for a historical value.
      ...flatText.matchAll(/(\d+)[- ]degree (?:\w+ )?(?:gate|tolerance)/gi),
      ...flatText.matchAll(/gate\w* (?:widened|narrowed) to (\d+) degrees/gi),
    ].map((m) => Number(m[1]));
    if (gates.length) {
      checked += gates.length;
      const wrong = [...new Set(gates.filter((g) => !gateDegrees.has(g)))];
      if (wrong.length === 0) {
        console.log(`  angular gates: ok (${gates.length} match the constants)`);
      } else {
        console.log(
          `  angular gates: MISMATCH prose says ${wrong.join(", ")}, the code defines ${[...gateDegrees].sort((a, b) => a - b).join(", ")}`,
        );
        failures += wrong.length;
      }
    }
  }

  // The same count restated in another document. The ledger states it beside
  // the list, so a drift there is caught by the check above; a document that
  // repeats the number carries no list to check it against and drifts
  // silently. The summary document said sixty-two while the ledger held
  // sixty-three. Checked against the list rather than against the ledger's
  // prose, because two documents agreeing on a wrong number is the failure
  // this is meant to catch.
  {
    // Two phrasings, not one. The handoff document restates the count as
    // "N findings that run against its own design" and drifted to sixty-four
    // against a ledger of one hundred and twenty-nine, in the same sentence
    // that tells the reader every countable claim in the file is regenerated
    // from the code by this script. This file was in the checked set the whole
    // time; no pattern reached that wording, and a check that reports nothing
    // reads exactly like a document making no claim.
    const RESTATED = [
      /There are ([A-Za-z-]+(?:\s+hundred)?(?:\s+and\s+[A-Za-z-]+)?) so far\./,
      /([A-Za-z-]+(?:\s+hundred)?(?:\s+and\s+[A-Za-z-]+)?) findings that run against/i,
    ];
    const restated = RESTATED.reduce((hit, re) => hit ?? text.match(re), null);
    // Same guard as the findings count above, for the same reason: this sentence
    // being present while its number does not parse is a silent skip, and the
    // number is written in words that grow a token at a time.
    if (
      !restated &&
      (/There are [A-Za-z-].{0,40}so far\./.test(text) ||
        /[A-Za-z-].{0,40}findings that run against/i.test(text))
    ) {
      console.log(
        "  restated findings count: NOT READ, the sentence is here and its number did not parse",
      );
      failures++;
    }
    if (restated) {
      if (ledgerFindings === null) {
        console.log(
          "  restated findings count: skipped, the findings ledger is not beside this checkout",
        );
      } else {
        checked++;
        const claimed = asNumber(restated[1]);
        if (claimed === null) {
          console.log(`  restated findings count: UNPARSED "${restated[1]}"`);
          failures++;
        } else if (claimed !== ledgerFindings) {
          console.log(
            `  restated findings count: MISMATCH this document says ${claimed}, the ledger lists ${ledgerFindings}`,
          );
          failures++;
        } else {
          console.log(`  restated findings count: ok (${claimed})`);
        }
      }
    }
  }

  // Cited commits, for the same reason as cited paths. A version note pinning a
  // measurement to commit `73105897` sat in Section 6.7 until 2026-08-29 naming
  // an object that resolves to nothing: the branch was squashed on merge, which
  // rewrites the hash, so the citation was unresolvable from the day it was
  // published. Squash merges are the normal way for this to happen and it will
  // happen again, which is why it is checked rather than fixed once.
  // Honours the same inline marker the count checks do, because a document that
  // explains an unresolvable hash has to quote it, and a check that cannot tell
  // a citation from a description of one forces the prose to omit the evidence.
  const commits = new Set(
    [...text.matchAll(/commit `([0-9a-f]{7,40})`/g)]
      .filter((m) => {
        const start = text.lastIndexOf("\n", m.index) + 1;
        let end = text.indexOf("\n", m.index);
        if (end === -1) end = text.length;
        if (text.slice(start, end).includes("claim-verified")) {
          exempt++;
          return false;
        }
        return true;
      })
      .map((m) => m[1]),
  );
  if (commits.size > 0) {
    checked++;
    const unresolved = [...commits].filter((c) => {
      const r = spawnSync("git", ["cat-file", "-e", `${c}^{commit}`], {
        cwd: APP_DIR,
      });
      return r.status !== 0;
    });
    if (unresolved.length === 0) {
      console.log(`  cited commits: ok (${commits.size} resolve)`);
    } else {
      console.log(`  cited commits: UNRESOLVABLE ${unresolved.join(", ")}`);
      failures++;
    }
  }

  // Event-type labels. A document that reproduces the incident corpus must
  // describe each case as the kind of event the scenario says it is. A document
  // that does not reproduce the corpus has nothing to get wrong: the README
  // says "nine incidents" and names none of them, so requiring it to say
  // "airborne near-miss" would be a checker inventing a claim. Presence of the
  // named incidents is the test, and it is the corpus itself rather than a
  // filename, so a new document describing the corpus is covered automatically.
  // All three anchors, not two of three. At two, the findings ledger qualified
  // by mentioning Tenerife and Linate in one sentence about runway geometry, and
  // was then required to name every incident and to use the scenario's own word
  // for each event. It discusses eight of the nine because the ninth never
  // produced a finding, which is what a findings ledger is, and it calls the
  // Potomac case a collision, which is correct. A document that genuinely
  // reproduces the corpus names all three anchors; one that mentions a couple in
  // passing does not.
  const ANCHORS = ["Avianca", "Tenerife", "Linate"];
  const anchorsPresent = ANCHORS.filter((n) => text.includes(n));
  const describesCorpus = anchorsPresent.length === ANCHORS.length;
  if (!describesCorpus && anchorsPresent.length === 0) {
    // Counted rather than printed. This is the routine case: most audited
    // documents never list incidents, and printing a line for each put forty
    // identical skips in an output carrying nine meaningful ones, which buries
    // the signal the named-skip discipline exists to create. The total is
    // reported once at the end, so nothing is hidden and nothing repeats.
    eventLabelSkips++;
  } else if (!describesCorpus) {
    // Partial is the dangerous state, so it is named rather than skipped. A
    // document that reproduced the corpus and then lost an incident would drop
    // below the gate and stop being checked at exactly the moment it needed to
    // be, which is a silent skip wearing the clothes of a clean run.
    console.log(
      `  event label: skipped, this document names ${anchorsPresent.join(" and ")} ` +
        `but not ${ANCHORS.filter((n) => !anchorsPresent.includes(n)).join(" or ")}, ` +
        "so it is not treated as reproducing the corpus",
    );
  }
  const loosePaper = loose(text);
  for (const { id, phrase, also = [] } of describesCorpus ? EVENT_PHRASES : []) {
    const scenario = SCENARIOS.find((sc) => sc.id === id);
    if (!scenario) {
      console.log(`  event label: scenario ${id} is gone; update EVENT_PHRASES`);
      failures++;
      continue;
    }
    if (!loose(scenario.name).includes(loose(phrase))) {
      console.log(`  event label: ${id} renamed to "${scenario.name}"; EVENT_PHRASES is stale`);
      failures++;
      continue;
    }
    checked++;
    const used = [phrase, ...also].find((p) => loosePaper.includes(loose(p)));
    if (used) {
      console.log(`  event label: ok (${id} described as "${used}")`);
    } else {
      console.log(`  event label: MISSING ${id} is "${scenario.name}" but this paper never calls it "${phrase}"`);
      failures++;
    }
  }

  // Every incident in the corpus must be identifiable in a document that
  // reproduces the corpus. This is the enumeration problem again: a paper can
  // say "nine incidents", be checked and pass, and describe eight of them.
  //
  // Candidates come from the scenario id and the scenario name rather than a
  // hand-kept table, because the two documents legitimately name the same case
  // differently: the thesis calls incident-lax-1991 "USAir 1493 / SkyWest
  // 5569" and the outreach paper calls it LAX, and neither is wrong. Matching
  // either the id's middle segment or the first word of the name accepts both
  // without a list that has to be maintained alongside the corpus.
  if (describesCorpus) {
    const unnamed = [];
    for (const scenario of SCENARIOS.filter((x) => x.id.startsWith("incident-"))) {
      const candidates = [
        scenario.id.split("-")[1],
        scenario.name.split(/[\s\u00b7]+/)[0],
      ].filter(Boolean);
      if (!candidates.some((c) => loosePaper.includes(loose(c)))) {
        unnamed.push(`${scenario.id} (tried ${candidates.join(", ")})`);
      }
    }
    checked++;
    if (unnamed.length === 0) {
      console.log(
        `  incident coverage: ok (all ${truth.incidents} identifiable)`,
      );
    } else {
      console.log(`  incident coverage: UNNAMED ${unnamed.join("; ")}`);
      failures++;
    }
  }

}

console.log(
  `\nground truth: ${truth.detectors} detectors, ${truth.scenarios} scenarios ` +
    `(${truth.incidents} incidents, ${truth.negativeControls} negative controls, ` +
    `${truth.otherScenarios} demonstrations), ` +
    `${truth.airports} airports (${truth.usAirports} US, ` +
    `${truth.intlAirports} international), ` +
    `${truth.alertCategories} alert categories` +
    (truth.tests ? `, ${truth.tests} tests` : ""),
);
// Every engineering note has to appear in the README's index. The notes are the
// record of what went wrong in this system, and three of the fifteen were cited
// from no document at all until 2026-09-01: reachable only by listing the
// directory. An index fixes that once and then rots, because the next note is
// written without it, and an index missing an entry is exactly as quiet as no
// index. The count in the prose is checked here too, for the same reason every
// other count in this project is.
{
  const docsDir = resolve(APP_DIR, "docs");
  const readmeFile = resolve(APP_DIR, "README.md");
  if (!existsSync(docsDir) || !existsSync(readmeFile)) {
    console.log("\nengineering-note index: skipped, docs/ or README.md is absent");
  } else {
    const notes = readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();
    const readme = readFileSync(readmeFile, "utf8");
    const unlisted = notes.filter((n) => !readme.includes(`docs/${n}`));
    const stated = readme.match(/`docs\/` holds (\d+) notes/);
    const problems = [];
    if (unlisted.length) problems.push(`not in the README index: ${unlisted.join(", ")}`);
    if (!stated) problems.push("the README no longer states how many notes docs/ holds");
    else if (Number(stated[1]) !== notes.length)
      problems.push(`the README says ${stated[1]} notes, docs/ holds ${notes.length}`);
    if (problems.length === 0) {
      console.log(`\nengineering-note index: ok (${notes.length} notes, all listed)`);
    } else {
      for (const pr of problems) console.log(`\nengineering-note index: ${pr}`);
      failures += problems.length;
    }
    checked += 1;
  }
}

// The T-AES submission candidate is assembled from the outreach whitepaper, and
// seven of its sections are that paper's text unchanged. Nothing stopped the two
// drifting apart: the candidate is hand-edited where it is compressed, so a
// later edit to the whitepaper simply would not reach it, and the assembly is
// not a script that could be re-run to notice.
//
// Three sections are DECLARED divergent, with the reason, and the check asserts
// they still differ. That half matters as much: a declared divergence that
// quietly becomes identical means an edit was lost, which is the same reasoning
// as every pinned defect in the suite.
const CANDIDATE_SECTIONS = {
  verbatim: [
    ["1. The problem", "1. The problem"],
    ["4. A correction this paper depends on", "4. A correction this paper depends on"],
    ["5. What the doctrinal-change drill actually showed", "5. What the doctrinal-change drill actually showed"],
    ["6. The open problem the measurements exposed", "6. The open problem the measurements exposed"],
    ["6.1 The untuned rate, and what the category crosstab attributed it to", "6.1 The untuned rate, and what the category crosstab attributed it to"],
    ["6.2 Two causes, two fixes, and a first re-measurement", "6.2 Two causes, two fixes, and a first re-measurement"],
    ["6.5 Hour-matching, and the reduction that survived it", "6.3 Hour-matching, and the reduction that survived it"],
  ],
  divergent: [
    ["2. The architecture", "2. The architecture", "the candidate cites ATPA, DO-185B and the STCA guidelines where the systems are described"],
    ["3. How it was checked", "3. How it was checked", "the candidate drops the negative-control narrative its findings chain already states"],
    ["7. What this is for", "7. What this is for", "the candidate names the instrument-condition sample where the whitepaper cites a section number"],
    ["Abstract", "Abstract", "rewritten to IEEE length in taes-parts, 417 words to 260"],
    ["Reproducibility", "Reproducibility", "rewritten in taes-parts to state the re-run against re-derive distinction once instead of walking six scripts"],
    ["6.6 Seven findings that cut against these results", "6.6 Seven findings that cut against these results", "the candidate carries the compressed chain, the outreach paper the full narration"],
  ],
};

const sectionsOf = (text) => {
  const lines = text.split("\n");
  const heads = [];
  lines.forEach((l, i) => {
    if (/^#{2,3} /.test(l)) heads.push([i, l.replace(/^#+\s*/, "").trim()]);
  });
  const out = new Map();
  heads.forEach(([i, title], k) => {
    const end = k + 1 < heads.length ? heads[k + 1][0] : lines.length;
    out.set(title, lines.slice(i + 1, end).join(" ").replace(/\s+/g, " ").trim());
  });
  return out;
};

{
  // The submission PDF's Title. It was empty for a long time, on the one file
  // of the three that an editor and a reviewer actually open, and four
  // attempts to fix it failed before the cause turned up: the title was passed
  // as a pandoc variable, which fills the rendered \title and leaves
  // title-meta empty, so the template omitted pdftitle and hyperref wrote an
  // empty Info dictionary over every hand-written \pdfinfo block. Nothing
  // would have reported the regression, so this reads the shipped PDF and
  // decodes the field rather than trusting that the build still passes the
  // title as metadata.
  const pdf = resolve(
    APP_DIR,
    docs("outreach/15-venues/atc_taes_candidate.pdf"),
  );
  const sh = resolve(
    APP_DIR,
    docs("scripts/build-taes-pdf.sh"),
  );
  if (!existsSync(pdf) || !existsSync(sh)) {
    console.log("\nsubmission PDF metadata: skipped, the built PDF is not beside this check");
  } else {
    const sub = readFileSync(sh, "utf8");
    const raw = readFileSync(pdf, "latin1");
    // hyperref writes these as UTF-16BE with a byte-order mark, every byte
    // octal escaped, so the field is unreadable without decoding and a test
    // for emptiness on the raw string would pass on a value of two mark bytes
    // and nothing else.
    const decode = (field) => {
      const bytes = [];
      for (let i = 0; i < field.length; ) {
        if (field[i] === "\\" && /[0-7]/.test(field[i + 1] ?? "")) {
          bytes.push(parseInt(field.slice(i + 1, i + 4), 8));
          i += 4;
        } else if (field[i] === "\\") {
          bytes.push(field.charCodeAt(i + 1));
          i += 2;
        } else {
          bytes.push(field.charCodeAt(i));
          i += 1;
        }
      }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        let out = "";
        for (let i = 2; i + 1 < bytes.length; i += 2)
          out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return out;
      }
      return bytes.map((b) => String.fromCharCode(b)).join("");
    };
    console.log("");
    // Both fields, not just the one that was broken first. The Author was
    // empty for longer than the Title and for a different reason, the
    // generator dropping the outreach paper's byline, so a check covering only
    // the field that prompted it would have passed on the larger gap.
    for (const [field, varName] of [
      ["Title", "TITLE"],
      ["Author", "AUTHOR"],
    ]) {
      const want = sub.match(new RegExp(`^${varName}="(.+)"$`, "m"))?.[1] ?? "";
      const pattern = new RegExp(`/${field}\\s*\\(((?:\\\\.|[^\\\\)])*)\\)`);
      const got = decode(raw.match(pattern)?.[1] ?? "");
      if (!want) {
        console.log(`submission PDF ${field.toLowerCase()}: the build script has no ${varName}= line to check against`);
        failures++;
      } else if (got === want) {
        console.log(`submission PDF ${field.toLowerCase()}: ok (${got.length} chars)`);
      } else if (!got) {
        console.log(`submission PDF ${field.toLowerCase()}: MISSING, the shipped PDF has an empty ${field}`);
        failures++;
      } else {
        console.log(`submission PDF ${field.toLowerCase()}: DRIFT, the PDF says "${got}" and the build script sets "${want}"`);
        failures++;
      }
    }
  }
}

{
  // The three figures exist in three forms: the mermaid fences in the thesis,
  // which the site renders and which are the source; the .mmd copies beside the
  // whitepaper; and the TikZ sources the LaTeX builds use, which were drawn by
  // hand from the mermaid. Each .mmd header admitted that nothing rendered one
  // from the other and either could drift, and it was right: the first TikZ
  // attempt at the smallest diagram laid five nodes out left to right where the
  // mermaid declares top-down, which reads perfectly well and is a different
  // diagram. This compares the node labels across all three forms, which is
  // cheap, needs no browser, and turns "compared by eye" into a check.
  const thesis = resolve(APP_DIR, "../web/src/papers/atc-decision-support.md");
  const dir = resolve(APP_DIR, docs("diagrams"));
  if (!existsSync(thesis) || !existsSync(dir)) {
    console.log("\nfigure label agreement: skipped, the thesis or the diagram sources are not beside this check");
  } else {
    // mermaid labels: NAME["Label"] and the stadium form NAME(["Label"]).
    const mermaidLabels = (src) =>
      new Set(
        [...src.matchAll(/\w+\(?\[\s*"([^"]+)"\s*\]\)?/g)].map((m) =>
          m[1].replace(/\s+/g, " ").trim(),
        ),
      );
    // TikZ labels: the braced text at the end of a \node line, with \texttt{}
    // and the \\ line break removed so the two forms are comparable.
    const tikzLabels = (src) =>
      new Set(
        [...src.matchAll(/\\node\[[^\]]*\]\s*\(\w+\)\s*at\s*\([^)]*\)\s*\{(.+?)\};/g)].map((m) =>
          m[1]
            .replace(/\\texttt\{([^}]*)\}/g, "$1")
            .replace(/\\\\/g, " ")
            .replace(/[{}]/g, "")
            .replace(/\s+/g, " ")
            .trim(),
        ),
      );
    const fences = [
      ...readFileSync(thesis, "utf8").matchAll(/```mermaid\n([\s\S]*?)```/g),
    ].map((m) => m[1]);
    const problems = [];
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith(".mmd"))
      .sort();
    if (sources.length !== fences.length)
      problems.push(
        `the thesis has ${fences.length} mermaid fence(s) and there are ${sources.length} .mmd source(s)`,
      );
    let compared = 0;
    const comparable = [];
    for (const [i, file] of sources.entries()) {
      const mmd = mermaidLabels(readFileSync(resolve(dir, file), "utf8"));
      const tex = resolve(dir, file.replace(/\.mmd$/, ".tex"));
      const fence = fences[i] === undefined ? null : mermaidLabels(fences[i]);
      const name = file.replace(/\.mmd$/, "");
      if (fence) {
        for (const label of mmd)
          if (!fence.has(label))
            problems.push(`${name}: .mmd has "${label}", the thesis fence does not`);
        for (const label of fence)
          if (!mmd.has(label))
            problems.push(`${name}: the thesis fence has "${label}", the .mmd does not`);
      }
      if (existsSync(tex)) {
        comparable.push([file, readFileSync(resolve(dir, file), "utf8"), tex]);
        const drawn = tikzLabels(readFileSync(tex, "utf8"));
        for (const label of mmd)
          if (!drawn.has(label))
            problems.push(`${name}: source has "${label}", the TikZ does not`);
        for (const label of drawn)
          if (!mmd.has(label))
            problems.push(`${name}: the TikZ has "${label}", the source does not`);
        compared++;
      }
    }
    // Labels alone do not describe a diagram. A drawing can carry every node and
    // still omit an edge, which is a wrong diagram that this check called
    // correct until the counts were compared too. Mermaid writes one arrow per
    // line and a chain like A --> B --> C is two, so the arrows are counted
    // rather than the lines; TikZ draws one flow per edge.
    for (const [file, mmdText, texPath] of comparable) {
      const arrows = (mmdText.match(/-->/g) ?? []).length;
      const draws = (readFileSync(texPath, "utf8").match(/\\draw\[flow\]/g) ?? []).length;
      // \foreach over a node list draws several edges from one statement, so a
      // literal count understates it. Expand those before comparing.
      const foreach = [
        ...readFileSync(texPath, "utf8").matchAll(
          /\\foreach\s+\\\w+\s+in\s*\{([^}]*)\}/g,
        ),
      ].reduce((n, m) => n + m[1].split(",").filter((x) => x.trim()).length - 1, 0);
      if (arrows !== draws + foreach)
        problems.push(
          `${file.replace(/\.mmd$/, "")}: ${arrows} edge(s) in the source, ${draws + foreach} drawn`,
        );
    }

    // The loop above walks the .mmd sources, so a TikZ figure with no source
    // beside it is never compared to anything and the check stays green while
    // the drawing is unguarded. Named rather than counted, because the point is
    // which file.
    for (const tex of readdirSync(dir).filter((f) => f.endsWith(".tex"))) {
      if (tex === "figure-preamble.tex") continue;
      if (!existsSync(resolve(dir, tex.replace(/\.tex$/, ".mmd"))))
        problems.push(`${tex}: drawn but has no .mmd source, so nothing checks its labels`);
    }
    console.log("");
    // Without this the check passes when no .tex is found, and it found none
    // for as long as the paths were wrong.
    if (compared === 0) {
      console.log("figure label agreement: no TikZ sources compared, which cannot be right");
      failures++;
    } else if (problems.length === 0) {
      console.log(
        `figure label agreement: ok (${sources.length} source(s), ${compared} drawn, against ${fences.length} thesis fence(s))`,
      );
    } else {
      for (const p of problems) console.log(`figure label agreement: ${p}`);
      failures++;
    }
  }
}

{
  // The venue note states the outreach paper's length in four ways for four
  // purposes: a comparison table, the Section 6 share, a per-section cut budget,
  // and the gap against a competing venue's 12,000 word ceiling. Every one of
  // them moved twice on 2026-09-01, once when the figures were captioned and
  // again when a third case was added to a section, and both times they were
  // found by hand because nothing checked them. They are all computable from the
  // paper.
  const paper = resolve(APP_DIR, docs("atc_whitepaper.md"));
  const note = resolve(APP_DIR, docs("outreach/15-venues/README.md"));
  if (!existsSync(paper) || !existsSync(note)) {
    console.log("\nwhitepaper length: skipped, the paper or the venue note is not beside this check");
  } else {
    // Code fences excluded, because a listing is not prose and the note says so.
    const text = readFileSync(paper, "utf8").replace(/```[\s\S]*?```/g, "");
    const whole = text.split(/\s+/).filter(Boolean).length;
    // Body means words under a heading, which excludes the front matter and the
    // heading text itself. Three measures differing by exactly those two things
    // is what made them reconcilable when they disagreed.
    const sections = [];
    let current = null;
    for (const line of text.split("\n")) {
      if (/^#{2,3} /.test(line)) {
        sections.push((current = { title: line.replace(/^#+\s*/, "").trim(), words: 0 }));
      } else if (current) {
        current.words += line.split(/\s+/).filter(Boolean).length;
      }
    }
    const body = sections.reduce((n, s) => n + s.words, 0);
    const six = sections
      .filter((s) => /^6[.\s]/.test(s.title) || s.title === "6")
      .reduce((n, s) => n + s.words, 0);
    const noteText = readFileSync(note, "utf8").replace(/\s+/g, " ");
    const num = (rx) => {
      const m = noteText.match(rx);
      return m ? Number(m[1].replace(/,/g, "")) : null;
    };
    // The cut is derived from the two figures above it, and deriving it by hand
    // is how it went wrong: with the body recomputed correctly, the cut was
    // updated to a guessed 11,436 where the subtraction gives 11,523. The check
    // covered the inputs and not the arithmetic, so it passed.
    const problems = [];
    let compared = 0;
    const budgetTotal = num(/\*\*total\*\* \| \*\*[\d,]+\*\* \| \*\*([\d,]+)\*\*/);
    const claimedCut = num(/the cut is ([\d,]+) words/);
    const claimedPct = num(/the cut is [\d,]+ words, (\d+) per cent of the body/);
    if (budgetTotal !== null && claimedCut !== null) {
      const cut = body - budgetTotal;
      if (claimedCut !== cut)
        problems.push(`the cut: the note says ${claimedCut}, ${body} minus ${budgetTotal} is ${cut}`);
      const pct = Math.round((100 * cut) / body);
      if (claimedPct !== null && claimedPct !== pct)
        problems.push(`the cut share: the note says ${claimedPct} per cent, the figures give ${pct}`);
    }
    // The words-per-page rate, which is a number derived from two other numbers
    // and so goes stale without either of them changing visibly. It read 976 for
    // long enough to survive several recounts and matched neither the body nor
    // the whole file on any of them: 21,422 over 22 pages is 974, and the whole
    // file over the same pages is 1,000. Nothing caught it because every other
    // figure in this note is stated directly and checked against the paper,
    // while this one is stated as a rate and its inputs are elsewhere in the
    // sentence. Checked from the note's own text rather than from the built PDF,
    // so it runs without a LaTeX toolchain; the page count itself is verified by
    // reading the artefact, which is a separate concern from the arithmetic.
    const rate = num(/the body runs ([\d,]+) words per page/);
    const ratePages = num(/Across the ([\d,]+) pages of that build/);
    const rateTen = num(/ten\s+pages is roughly ([\d,]+) words/);
    if (rate !== null && ratePages !== null) {
      compared++;
      const expected = Math.round(body / ratePages);
      if (rate !== expected)
        problems.push(
          `words per page: the note says ${rate}, ${body} over ${ratePages} pages is ${expected}`,
        );
      if (rateTen !== null && rateTen !== rate * 10)
        problems.push(
          `ten-page estimate: the note says ${rateTen}, ${rate} times ten is ${rate * 10}`,
        );
    }
    const claims = [
      ["whole file", num(/([\d,]+) counts the whole file/), whole],
      ["body under headings", num(/under a heading come to ([\d,]+)/), body],
      ["Section 6", num(/Section 6 of the outreach paper is ([\d,]+) words/), six],
      ["budget total", num(/\*\*total\*\* \| \*\*([\d,]+)\*\*/), body],
    ];
    for (const [label, claimed, actual] of claims) {
      if (claimed === null) continue;
      compared++;
      if (claimed !== actual)
        problems.push(`${label}: the note says ${claimed}, the paper has ${actual}`);
    }
    console.log("");
    // Without this the check passes on a note that states none of them, which is
    // the failure mode of every pattern-matched claim in this file.
    if (compared === 0) {
      console.log("whitepaper length: no figure found in the note, which cannot be right");
      failures++;
    } else if (problems.length === 0) {
      console.log(`whitepaper length: ok (${compared} figure(s): ${whole} whole, ${body} body, ${six} in Section 6)`);
    } else {
      for (const pr of problems) console.log(`whitepaper length: ${pr}`);
      failures++;
    }
  }
}

{
  // Both papers state what imc-pool.py prints for the instrument-condition
  // sample, beside a running total across every window ever collected that this
  // checkout cannot recompute. The printed figure is checkable, and checking it
  // by asking the script is the point: three times now a hand-rolled join over
  // the same dumps has produced a plausible figure that disagreed with a correct
  // paper, because the pooler counts admitted pairs and a naive join counts
  // recorded ones, 117 against 167. Reimplementing the definition is the error
  // this check exists to stop, so it parses the producing script's own output.
  const pooler = resolve(APP_DIR, "scripts/imc-pool.py");
  const wp = resolve(APP_DIR, docs("atc_whitepaper.md"));
  if (!existsSync(pooler) || !existsSync(wp) || !existsSync(resolve(APP_DIR, "data"))) {
    console.log("\ninstrument sample: skipped, no snapshot dumps or no pooler on this checkout");
  } else {
    const run = spawnSync("python3", [pooler], {
      encoding: "utf8",
      cwd: APP_DIR,
    });
    const out = `${run.stdout ?? ""}`;
    // "  IFR       3 pairs      1 violating  (33%)"
    const line = out.match(/^\s*IFR\s+(\d+) pairs\s+(\d+) violating/m);
    if (run.status !== 0 || !line) {
      console.log("\ninstrument sample: skipped, the pooler produced no IFR line");
    } else {
      const [pairs, violating] = [Number(line[1]), Number(line[2])];
      const words = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      const flat = readFileSync(wp, "utf8").replace(/\s+/g, " ");
      // Anchored on the phrase that introduces the figure. Unanchored, the
      // first "N of M violating" anywhere in the paper matched instead, and the
      // check reported a correct document as claiming "1 of undefined".
      const claim = flat.match(
        /pooling script prints[^.]{0,40}?which is (\w+) of (\w+) violating/,
      );
      console.log("");
      if (!claim) {
        console.log("instrument sample: no claim found about what the pooler prints");
      } else {
        const claimedPairs = words[claim[1].toLowerCase()];
        const claimedViolating = words[claim[2].toLowerCase()];
        if (claimedPairs === pairs && claimedViolating === violating) {
          console.log(
            `instrument sample: ok (the pooler prints ${pairs} pair(s), ${violating} violating)`,
          );
        } else {
          console.log(
            `instrument sample: MISMATCH the pooler prints ${pairs} of ${violating} violating, the paper says ${claimedPairs} of ${claimedViolating}`,
          );
          failures++;
        }
      }
    }
  }
}

{
  // Every script in scripts/ must be named in the README. Six of twenty were
  // not, including the pooler whose admission rule is the definition that three
  // hand-written joins got wrong in one day, and a tool nobody can see is a
  // tool that gets rewritten. Directory-driven rather than list-driven, so the
  // check cannot fall behind the directory.
  const dir = resolve(APP_DIR, "scripts");
  const readme = resolve(APP_DIR, "README.md");
  if (!existsSync(dir) || !existsSync(readme)) {
    console.log("\nscript documentation: skipped, no scripts directory or README beside this check");
  } else {
    const text = readFileSync(readme, "utf8");
    const scripts = readdirSync(dir).filter((f) =>
      /\.(mjs|py|sh)$/.test(f),
    );
    const undocumented = scripts.filter((f) => !text.includes(f));
    console.log("");
    if (scripts.length === 0) {
      console.log("script documentation: no scripts found, which cannot be right");
      failures++;
    } else if (undocumented.length === 0) {
      console.log(`script documentation: ok (${scripts.length} script(s), all named in the README)`);
    } else {
      for (const f of undocumented)
        console.log(`script documentation: scripts/${f} is not named in the README`);
      failures++;
    }
  }
}

{
  // The thesis reproduces the proximity detector in an appendix as a
  // representative example. A paper that prints code has to print the code that
  // runs: nothing checked this, and a detector that changed after the appendix
  // was written would leave the paper showing a function the system no longer
  // has. Compared on the lines that decide something rather than character for
  // character, because the appendix legitimately drops comments and the
  // surrounding file's imports.
  const paperPath = resolve(APP_DIR, "../web/src/papers/atc-decision-support.md");
  const srcPath = resolve(APP_DIR, "src/sim/rules.ts");
  if (!existsSync(paperPath) || !existsSync(srcPath)) {
    console.log("\nappendix detector: skipped, the thesis or rules.ts is not beside this check");
  } else {
    const paper = readFileSync(paperPath, "utf8");
    const marker = "const detectProximityConflict";
    const at = paper.indexOf(marker);
    console.log("");
    if (at < 0) {
      console.log("appendix detector: the thesis no longer reproduces the detector, so nothing was compared");
      failures++;
    } else {
      const fence = paper.indexOf("```", at);
      const shown = paper.slice(at, fence < 0 ? undefined : fence);
      const src = readFileSync(srcPath, "utf8");
      const decisive = (text) =>
        text
          .split("\n")
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter(
            (l) =>
              !l.startsWith("//") &&
              /(PROXIMITY_|severity:|isConverging|parallelRunwayPair)/.test(l),
          );
      const lines = decisive(shown);
      const inSource = new Set(decisive(src));
      const drifted = lines.filter((l) => !inSource.has(l));
      if (lines.length === 0) {
        console.log("appendix detector: no decision lines found in the reproduction, which cannot be right");
        failures++;
      } else if (drifted.length === 0) {
        console.log(`appendix detector: ok (${lines.length} decision line(s) match rules.ts)`);
        // A.1 prints the Alert type and A.2 the demotion table. Both are
        // reproductions of source that can change underneath them, for the same
        // reason and with the same silence.
        const typesSrc = readFileSync(resolve(APP_DIR, "src/sim/types.ts"), "utf8");
        const predictSrc = readFileSync(resolve(APP_DIR, "src/sim/predict.ts"), "utf8");
        const shownCategories = [
          ...paper.slice(paper.indexOf("### A.1"), paper.indexOf("### A.2")).matchAll(/^\s*\|\s*"([a-z-]+)"/gm),
        ].map((m) => m[1]);
        const realCategories = [
          ...typesSrc.slice(typesSrc.indexOf("category:")).matchAll(/^\s*\|\s*"([a-z-]+)"/gm),
        ].map((m) => m[1]);
        const missing = shownCategories.filter((c) => !realCategories.includes(c));
        const extra = realCategories.filter((c) => !shownCategories.includes(c));
        if (shownCategories.length === 0) {
          console.log("appendix alert type: no categories found in A.1, which cannot be right");
          failures++;
        } else if (missing.length === 0 && extra.length === 0) {
          console.log(`appendix alert type: ok (${shownCategories.length} categories match types.ts)`);
        } else {
          console.log(
            `appendix alert type: DRIFTED, A.1 lists ${shownCategories.length} and types.ts has ${realCategories.length}` +
              (missing.length ? `; only in the paper: ${missing.join(", ")}` : "") +
              (extra.length ? `; only in the code: ${extra.join(", ")}` : ""),
          );
          failures++;
        }
        const demotions = [
          ...paper.slice(paper.indexOf("### A.2"), paper.indexOf("### A.3")).matchAll(/(critical|warning|advisory|info):\s*"(\w+)"/g),
        ].map((m) => `${m[1]}:"${m[2]}"`);
        const flatPredict = predictSrc.replace(/\s+/g, "");
        const badDemotions = demotions.filter((d) => !flatPredict.includes(d.replace(/\s+/g, "")));
        if (demotions.length === 0) {
          console.log("appendix demotion table: no mappings found in A.2, which cannot be right");
          failures++;
        } else if (badDemotions.length === 0) {
          console.log(`appendix demotion table: ok (${demotions.length} mapping(s) match predict.ts)`);
        } else {
          console.log(`appendix demotion table: DRIFTED ${badDemotions.join(", ")}`);
          failures++;
        }
      } else {
        for (const l of drifted)
          console.log(`appendix detector: DRIFTED, the thesis shows a line rules.ts does not have: ${l.slice(0, 90)}`);
        failures++;
      }
    }
  }
}

{
  const wpFile = resolve(APP_DIR, docs("atc_whitepaper.md"));
  const cdFile = resolve(APP_DIR, docs("outreach/15-venues/atc_taes_candidate.md"));
  if (!existsSync(wpFile) || !existsSync(cdFile)) {
    console.log("\nT-AES candidate: skipped, the outreach paper or the candidate is not beside this checkout");
  } else {
    const wp = sectionsOf(readFileSync(wpFile, "utf8"));
    const cd = sectionsOf(readFileSync(cdFile, "utf8"));
    const problems = [];
    for (const [w, c] of CANDIDATE_SECTIONS.verbatim) {
      const a = wp.get(w), b = cd.get(c);
      if (a === undefined || b === undefined) problems.push(`missing section: ${w} / ${c}`);
      else if (a !== b) problems.push(`drifted: "${c}" no longer matches the outreach paper`);
    }
    // Every section the two documents share a title for must be classified as
    // one or the other. The first version listed ten pairs and stopped there,
    // so three shared sections, the abstract, Reproducibility and the seven-
    // findings heading, were covered by neither list and could drift or
    // silently converge with nothing reporting it. A check that knows only the
    // cases that prompted it passes on the day a new one breaks, which is the
    // same defect as an outreach folder list naming the folders that existed
    // when it was written.
    {
      const classified = new Set([
        ...CANDIDATE_SECTIONS.verbatim.map(([, c]) => c),
        ...CANDIDATE_SECTIONS.divergent.map(([, c]) => c),
      ]);
      const shared = [...cd.keys()].filter((t) => wp.has(t) && !classified.has(t));
      for (const t of shared)
        problems.push(`unclassified: "${t}" is in both documents and in neither list`);
    }
    for (const [w, c, why] of CANDIDATE_SECTIONS.divergent) {
      const a = wp.get(w), b = cd.get(c);
      if (a === undefined || b === undefined) problems.push(`missing section: ${w} / ${c}`);
      else if (a === b) problems.push(`declared divergent but identical: "${c}" (${why})`);
    }
    if (problems.length === 0) {
      console.log(
        `\nT-AES candidate: ok (${CANDIDATE_SECTIONS.verbatim.length} sections verbatim, ` +
          `${CANDIDATE_SECTIONS.divergent.length} declared divergent)`,
      );
    } else {
      for (const p of problems) console.log(`\nT-AES candidate: ${p}`);
      failures += problems.length;
    }
    checked += CANDIDATE_SECTIONS.verbatim.length + CANDIDATE_SECTIONS.divergent.length;
  }
}

// The Living Map exists twice: apps/web/src/papers/the-living-map.md, which the
// site publishes, and the long-form copy the documents checkout carries
// with a title block and PNG figures for its PDF. There is no generator between
// them. That arrangement already failed once here, with a thesis copy that
// drifted three thousand words behind before it was deleted on 2026-08-25, so
// the skeletons are compared: a section added, removed or renamed in one and
// not the other is the first thing to move and the cheapest thing to catch.
// Prose is deliberately not compared, because the two legitimately differ in
// their figures and front matter and a check that cried wolf would be turned off.
{
  const pair = [
    resolve(APP_DIR, "../web/src/papers/the-living-map.md"),
    resolve(APP_DIR, docs("whitepaper_final.md")),
  ];
  if (pair.every((f) => existsSync(f))) {
    const headings = pair.map((f) =>
      [...readFileSync(f, "utf8").matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map((h) => h[1]),
    );
    checked++;
    if (headings[0].join("\u0000") === headings[1].join("\u0000")) {
      console.log(
        `\nThe Living Map, both copies: ok (${headings[0].length} sections match)`,
      );
    } else {
      const onlyPublished = headings[0].filter((h) => !headings[1].includes(h));
      const onlySibling = headings[1].filter((h) => !headings[0].includes(h));
      console.log("\nThe Living Map, both copies: DRIFTED");
      for (const h of onlyPublished) console.log(`  only in the published copy: ${h}`);
      for (const h of onlySibling) console.log(`  only in the sibling copy: ${h}`);
      if (!onlyPublished.length && !onlySibling.length) {
        console.log("  same sections, different order");
      }
      failures++;
    }
  } else {
    console.log("\nThe Living Map, both copies: skipped, only one is present");
  }
}

// A document citing no accident report is normal; a whole run citing none is
// not, and this check reports by printing only when it finds something, so it
// went from one matching document to zero without a word when an edit dropped
// the only docket number the thesis carried. Same shape as every silent-zero
// defect in this file.
// Scoped to a run that actually includes a paper. A standalone checkout has the
// code, the README and the engineering notes and none of the long-form writing,
// so nothing there cites an accident report and that is correct rather than
// wrong. The guard fired on every extraction until 2026-09-02, which is the
// same shape as the thing it was written to catch: a check reporting on
// something it was never given.
const hasLongForm = papers.some(
  (p) => /papers\/.+\.md$/.test(p.file) && existsSync(p.file),
);
if (hasLongForm && docsCitingReports === 0) {
  console.log(
    "\naccident-report citations: no document cited one, which cannot be right",
  );
  failures++;
}

console.log(
  `${checked} claims checked across ${papers.length} document(s), ` +
    `${failures} problem(s)` +
    (exempt ? `, ${exempt} marked claim-verified` : "") +
    (eventLabelSkips
      ? `; event labels skipped in ${eventLabelSkips} document(s) that do not reproduce the incident corpus`
      : ""),
);
// Named, not silent. A skipped document is the one case where this script can
// report zero problems while a stale claim sits in a file it never opened, so
// the reason it did not open it is printed rather than inferred from a count.
// The sibling's manifest, reported the same way its documents are. Without this
// a run with no documents checkout reads 61 documents instead of 65 and still
// prints zero problems, which is a clean pass over a smaller set: the exact
// thing this script exists to make impossible. The count alone is not enough,
// because nobody remembers what the count should be.
if (explicit.length === 0) {
  if (!docsDir) {
    console.log(
      "not checked: no documents checkout beside this one, so the long-form " +
        "documents were not read",
    );
  } else if (manifestPaths.length === 0) {
    console.log(
      "not checked: the documents checkout has no docs-manifest.txt, so it " +
        "contributed nothing",
    );
  } else if (manifestMissing.length > 0) {
    console.log(
      `not checked: the manifest lists ${manifestMissing.length} file(s) that ` +
        `are not there: ${manifestMissing.map((f) => f.split("/").slice(-1)[0]).join(", ")}`,
    );
  }
}

if (explicit.length === 0 && optionalMissing.length > 0) {
  console.log(
    `not checked: ${optionalMissing.join(", ")} ` +
      "(sibling repository absent from this checkout)",
  );
}
process.exit(failures > 0 ? 1 : 0);
