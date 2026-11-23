import { z } from "zod";
import { unknown, validCas, type Solution } from "../src/domain";
import type { Evidence, EvidenceGap, Identity, SolutionSide } from "../src/review";
import { readBytes } from "./http";

const pubchem = "https://pubchem.ncbi.nlm.nih.gov";
const cdc = "https://www.cdc.gov/niosh/npg/";
const compoundSchema = z.object({
  CID: z.int().positive(),
  Title: z.string().min(1).max(500),
  MolecularFormula: z.string().min(1).max(500),
});
type Compound = z.infer<typeof compoundSchema>;
type Citation = Pick<Evidence, "source" | "kind" | "title" | "url" | "excerpt">;

async function retrieve(url: string, maxBytes: number) {
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8_000) });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("SOURCE_UNAVAILABLE");
  }
  const bytes = await readBytes(response, maxBytes);
  if (bytes instanceof Response) throw new Error("SOURCE_UNAVAILABLE");
  return new TextDecoder().decode(bytes);
}

function chemicalText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

// Compare elemental counts for simple molecular or condensed formulas.
function molecularFormula(value: string) {
  const text = chemicalText(value);
  if (!/^(?:[A-Z][a-z]?\d*){1,40}$/.test(text)) return null;
  const elements = new Map<string, number>();
  for (const [, element, digits] of text.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    const count = digits ? Number(digits) : 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) return null;
    elements.set(element, (elements.get(element) ?? 0) + count);
  }
  return JSON.stringify([...elements].sort(([a], [b]) => a.localeCompare(b)));
}

async function compounds(namespace: "name" | "fastformula", identifier: string) {
  const query = namespace === "fastformula" ? "?MaxRecords=3" : "";
  const data = await retrieve(
    pubchem + "/rest/pug/compound/" + namespace + "/" + encodeURIComponent(identifier)
      + "/property/Title,MolecularFormula/JSON" + query, 128 * 1024,
  );
  if (!data) return [];
  return z.object({ PropertyTable: z.object({ Properties: z.array(compoundSchema) }) })
    .parse(JSON.parse(data)).PropertyTable.Properties.slice(0, 3);
}

async function identityOf(solution: Solution) {
  const formula = molecularFormula(solution.formula);
  const name = chemicalText(solution.name);
  const cas = solution.cas === unknown && name !== unknown && validCas(name)
    ? name : solution.cas;
  const usableName = name !== unknown && name !== cas;
  const embeddedFormula = usableName ? molecularFormula(name) : null;
  const byCas = cas === unknown ? [] : await compounds("name", cas);
  const byName = usableName && !embeddedFormula ? await compounds("name", name) : [];
  const candidates = byCas.length ? byCas : byName;
  const formulaText = formula ? chemicalText(solution.formula) : embeddedFormula ? name : undefined;
  const targetFormula = formula ?? embeddedFormula;
  let records = candidates;
  let conflict = Boolean(byCas.length && byName.length &&
    !byCas.some((candidate) => byName.some(({ CID }) => candidate.CID === CID)));
  if (byCas.length && byName.length && !conflict) {
    records = byCas.filter((candidate) => byName.some(({ CID }) => candidate.CID === CID));
  }
  if (targetFormula && records.length) {
    const matches = records.filter((record) => molecularFormula(record.MolecularFormula) === targetFormula);
    conflict ||= matches.length === 0;
    if (matches.length) records = matches;
  }
  if (!candidates.length && formulaText) records = await compounds("fastformula", formulaText);
  if (conflict) records = [...new Map([...byCas, ...byName].map((record) => [record.CID, record])).values()];
  // A formula can represent isomers or different products even if a search returns one hit.
  const state = records.length === 0 ? "missing"
    : records.length !== 1 || conflict || !candidates.length ? "ambiguous" : "matched";
  const unverified = (cas !== unknown && !byCas.length)
    || (usableName && !embeddedFormula && !byName.length)
    || (solution.formula !== unknown && !formula);
  return { records, state, cas, unverified } as const;
}

const annotations = z.object({
  TOCHeading: z.string(),
  Information: z.array(z.object({
    Name: z.string().optional(),
    Value: z.object({ StringWithMarkup: z.array(z.object({ String: z.string() })).optional() }).optional(),
  })).optional(),
  Section: z.array(z.unknown()).optional(),
});
const incompatibilityHeadings = new Set([
  "Reactivity Profile", "Hazardous Reactivities and Incompatibilities",
]);

async function pubchemSafety(record: Compound): Promise<Citation[]> {
  const data = await retrieve(
    pubchem + "/rest/pug_view/data/compound/" + record.CID + "/JSON?heading=Safety%20and%20Hazards",
    1024 * 1024,
  );
  if (!data) return [];
  const result = z.object({
    Record: z.object({ RecordNumber: z.int(), Section: z.array(z.unknown()) }),
  }).parse(JSON.parse(data)).Record;
  if (result.RecordNumber !== record.CID) throw new Error("WRONG_COMPOUND");
  const found: Citation[] = [];
  function visit(raw: unknown, depth: number) {
    const parsed = annotations.safeParse(raw);
    if (!parsed.success || depth > 8) return;
    const section = parsed.data;
    const heading = section.TOCHeading;
    for (const entry of section.Information ?? []) {
      const kind = incompatibilityHeadings.has(heading) ? "incompatibility"
        : heading === "GHS Classification" && entry.Name === "GHS Hazard Statements" ? "hazard" : null;
      if (!kind || found.filter((evidence) => evidence.kind === kind).length >= 3) continue;
      for (const line of (entry.Value?.StringWithMarkup ?? []).slice(0, 3)) {
        const excerpt = line.String.replace(/\s+/g, " ").trim().slice(0, 900);
        if (!excerpt || (kind === "hazard" && !/^H\d{3}[a-z]*(?:\s|:|\+|$)/i.test(excerpt))) continue;
        if (found.some((item) => item.excerpt === excerpt)) continue;
        found.push({
          source: "PubChem", kind, title: record.Title + " · " + heading,
          url: pubchem + "/compound/" + record.CID + "#" + encodeURIComponent(heading), excerpt,
        });
        if (found.filter((evidence) => evidence.kind === kind).length >= 3) break;
      }
    }
    for (const child of section.Section ?? []) visit(child, depth + 1);
  }
  for (const section of result.Section) visit(section, 0);
  return found;
}

function htmlText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,6}|#x[0-9a-f]{1,6});/gi,
    (original, entity: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (!entity.startsWith("#")) return named[entity] ?? original;
      const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point <= 0x10ffff ? String.fromCodePoint(point) : original;
    }).replace(/\s+/g, " ").trim();
}

function indexEntries(html: string) {
  const items = new Map<string, { title: string; page: string }[]>();
  const rows = /<tr>\s*<td>\s*([^<]{1,200})<\/td>\s*<td>\s*<a\s+href=['"](npgd\d{4}\.html)['"]\s*>([\s\S]{1,600}?)<\/a>\s*<\/td>\s*<\/tr>/gi;
  for (const [, key, page, title] of html.matchAll(rows)) {
    const normalized = htmlText(key).toLowerCase();
    items.set(normalized, [...(items.get(normalized) ?? []), { title: htmlText(title), page }]);
  }
  if (!items.size) throw new Error("NIOSH_INDEX_FORMAT_CHANGED");
  return items;
}

async function compoundCas(cid: number) {
  const data = await retrieve(pubchem + "/rest/pug_view/data/compound/" + cid + "/JSON?heading=CAS", 128 * 1024);
  if (!data) return unknown;
  const schema = z.object({
    Record: z.object({ RecordNumber: z.literal(cid), Section: z.array(z.unknown()) }),
  });
  const numbers = new Set<string>();
  function visit(raw: unknown, depth: number) {
    const result = annotations.safeParse(raw);
    if (!result.success || depth > 6) return;
    const section = result.data;
    if (section.TOCHeading === "CAS") {
      for (const entry of section.Information ?? []) {
        for (const item of entry.Value?.StringWithMarkup ?? []) {
          if (item.String !== unknown && validCas(item.String)) numbers.add(item.String);
        }
      }
    }
    for (const child of section.Section ?? []) visit(child, depth + 1);
  }
  for (const section of schema.parse(JSON.parse(data)).Record.Section) visit(section, 0);
  return numbers.size === 1 ? [...numbers][0] : unknown;
}

async function nioshSafety(cas: string, loadIndex: () => Promise<ReturnType<typeof indexEntries>>): Promise<Citation[]> {
  if (cas === unknown) return [];
  const entries = (await loadIndex()).get(cas) ?? [];
  const matches = [...new Map(entries.map((entry) => [entry.page, entry])).values()];
  if (matches.length !== 1) return [];
  const { page, title } = matches[0];
  const url = cdc + page;
  const html = await retrieve(url, 768 * 1024);
  if (!html) return [];

  const fields = new Map<string, string>();
  const cards = /<div class="card-title h6">([\s\S]{1,300}?)<\/div>\s*<div class="card-body">\s*<div class="card-text">([\s\S]{0,4000}?)<\/div>/gi;
  for (const [, heading, body] of html.matchAll(cards)) {
    fields.set(htmlText(heading), htmlText(body).slice(0, 900));
  }
  if (!fields.size) throw new Error("NIOSH_RECORD_FORMAT_CHANGED");
  if (fields.get("CAS No.") !== cas) return [];

  const evidence: Citation[] = [{ source: "NIOSH", kind: "identity", title, url, excerpt: "CAS " + cas }];
  for (const [heading, kind] of [["Incompatibilities & Reactivities", "incompatibility"], ["Symptoms", "hazard"]] as const) {
    const excerpt = fields.get(heading);
    if (excerpt && !/^(?:none|not available|n\.d\.|\?)$/i.test(excerpt)) {
      evidence.push({ source: "NIOSH", kind, title: title + " · " + heading, url, excerpt });
    }
  }
  return evidence;
}

export function scientificSources() {
  // Reuse each index across both solutions within this invocation.
  let index: Promise<ReturnType<typeof indexEntries>> | undefined;
  function loadIndex() {
    return index ??= retrieve(cdc + "npgdcas.html", 1024 * 1024).then((html) => indexEntries(html ?? ""));
  }
  return async function collect(solution: Solution, side: SolutionSide) {
    const gaps: EvidenceGap[] = [];
    const evidence: Evidence[] = [];
    const add = (code: EvidenceGap["code"]) => gaps.push({ code, solution: side });
    const cite = (citation: Citation) => evidence.push({
      ...citation, id: crypto.randomUUID(), solution: side, retrievedAt: new Date().toISOString(),
    });
    let identity: Identity = { solution: side, state: "missing", records: [] };
    let chemical: Compound | undefined;
    let cas = solution.cas;
    try {
      const match = await identityOf(solution);
      cas = match.cas;
      identity = {
        solution: side, state: match.state,
        records: match.records.map(({ CID, Title, MolecularFormula }) =>
          ({ cid: CID, name: Title, formula: MolecularFormula })),
      };
      if (match.unverified) add("identifierUnverified");
      if (match.state === "matched") {
        chemical = match.records[0];
        cite({
          source: "PubChem", kind: "identity", title: chemical.Title,
          url: pubchem + "/compound/" + chemical.CID,
          excerpt: "CID " + chemical.CID + " · " + chemical.MolecularFormula,
        });
        if (cas === unknown) {
          try {
            cas = await compoundCas(chemical.CID);
          } catch {
            add("identifierUnverified");
          }
        }
        for (const citation of await pubchemSafety(chemical)) cite(citation);
      }
    } catch {
      add("pubchemUnavailable");
    }
    if (identity.state !== "matched") add("identity");
    try {
      const references = await nioshSafety(cas, loadIndex);
      if (!references.length) add("nioshNoRecord");
      for (const citation of references) cite(citation);
    } catch {
      add("nioshUnavailable");
    }
    for (const field of ["concentration", "solvent", "state", "temperature", "quantity"] as const) {
      if (solution[field] === unknown) add(field);
    }
    if (!evidence.some((value) => value.kind === "hazard")) add("hazards");
    if (!evidence.some((value) => value.kind === "incompatibility")) add("incompatibilities");
    return { identity, evidence, gaps };
  };
}
