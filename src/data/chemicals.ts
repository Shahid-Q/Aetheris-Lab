import type { ChemicalRecord } from "../domain";
// Small, reviewed seed catalog. These are substance references, never solution-specific verdicts.
export const chemicals: ChemicalRecord[] = [
  {
    id: "ethanol",
    name: "Ethanol",
    aliases: ["Ethyl alcohol", "EtOH", "Grain alcohol"],
    formula: "CH3CH2OH",
    cas: "64-17-5",
    category: "Solvents",
    mass: 46.1,
    state: "Liquid",
    description: "A clear, colorless liquid; miscible with water.",
    hazards:
      "NIOSH lists a Class IB flammable liquid. Consult the linked reference and your product SDS.",
    incompatibilities:
      "NIOSH lists strong oxidizers, sodium, and several other reactive substances; consult the full source.",
    source: "https://www.cdc.gov/niosh/npg/npgd0262.html",
    verifiedOn: "2026-11-20",
  },
  {
    id: "acetone",
    name: "Acetone",
    aliases: ["Dimethyl ketone", "2-Propanone"],
    formula: "(CH3)2CO",
    cas: "67-64-1",
    category: "Solvents",
    mass: 58.1,
    state: "Liquid",
    description: "A colorless liquid; miscible with water.",
    hazards:
      "NIOSH lists a Class IB flammable liquid. Consult the linked reference and your product SDS.",
    incompatibilities: "NIOSH lists oxidizers and acids.",
    source: "https://www.cdc.gov/niosh/npg/npgd0004.html",
    verifiedOn: "2026-11-20",
  },
  {
    id: "sodium-hydroxide",
    name: "Sodium hydroxide",
    aliases: ["Caustic soda", "Lye", "Sodium hydrate"],
    formula: "NaOH",
    cas: "1310-73-2",
    category: "Bases",
    mass: 40,
    state: "Solid",
    description:
      "An odorless white or colorless solid. Solution properties depend on concentration.",
    hazards:
      "NIOSH describes eye and skin burns and heat generation on contact with water.",
    incompatibilities:
      "NIOSH lists acids, certain metals, flammable liquids, water, and other substances; consult the full source.",
    source: "https://www.cdc.gov/niosh/npg/npgd0565.html",
    verifiedOn: "2026-11-20",
  },
  {
    id: "hydrogen-peroxide",
    name: "Hydrogen peroxide",
    aliases: ["Hydrogen dioxide", "Peroxide", "Hydroperoxide"],
    formula: "H2O2",
    cas: "7722-84-1",
    category: "Oxidizers",
    mass: 34,
    state: "Liquid",
    description:
      "A colorless liquid, frequently supplied as an aqueous solution.",
    hazards:
      "NIOSH describes a powerful oxidizer; contact with combustible material can cause spontaneous combustion.",
    incompatibilities:
      "NIOSH lists oxidizable materials and several metals including iron and copper.",
    source: "https://www.cdc.gov/niosh/npg/npgd0335.html",
    verifiedOn: "2026-11-20",
  },
];
export const categories = [
  "All entries",
  "Solvents",
  "Bases",
  "Oxidizers",
  "Acids",
  "Salts",
  "Elements",
  "Equipment",
  "Safety topics",
];
export function searchChemicals(query: string, category = "All entries") {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/[₂₃]/g, (c) => (c === "₂" ? "2" : "3"));
  return chemicals.filter(
    (c) =>
      (category === "All entries" || c.category === category) &&
      [c.name, ...c.aliases, c.formula, c.cas, c.category].some((v) =>
        v.toLowerCase().includes(q),
      ),
  );
}
