// Scans Git-visible project files for common credential formats without printing matches.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const patterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
];
const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];

for (const path of paths) {
  let content;
  try { content = readFileSync(path, "utf8"); } catch { continue; }
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${path}: possible ${label}`);
  }
}

if (findings.length) {
  process.stderr.write(`Possible credentials found:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("No common credential patterns found in Git-visible files.\n");
}
