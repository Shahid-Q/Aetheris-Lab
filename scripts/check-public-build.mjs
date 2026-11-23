import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { URL } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const files = await readdir(dist, { recursive: true });
assert.ok(files.includes("index.html"), "Public HTML entry was not built");
assert.ok(files.some((file) => /^assets[/\\].+\.js$/.test(file)), "Public scripts were not built");
assert.deepEqual(
  JSON.parse(await readFile(new URL("_routes.json", dist), "utf8")).include,
  ["/api/*"],
  "Public Pages must only invoke Functions for public API routes",
);
const privateMarkers = [
  /\/admin(?:[/"'`?]|$)/,
  /admin-(?:toolbar|form|grid|evidence|login|shell)/,
  /Reviewer sign-in|Enter the admin password|Publish approved assessment|Retrieved source evidence/,
];
for (const file of files) {
  if (!/\.(html|js|css|json)$/.test(file)) continue;
  const asset = await readFile(new URL(file.replaceAll("\\", "/"), dist), "utf8");
  for (const marker of privateMarkers) {
    assert.doesNotMatch(asset, marker, file + " contains private reviewer interface material");
  }
}
