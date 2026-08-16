import { AgentError } from "./errors.js";

function parseRange(value, fallbackCount) {
  const match = value.match(/^(\d+)(?:,(\d+))?$/);
  if (!match) throw new AgentError(`Invalid unified diff range: ${value}`, { code: "invalid_patch" });
  return { start: Number(match[1]), count: match[2] === undefined ? fallbackCount : Number(match[2]) };
}

export function applyUnifiedPatch(source, patch) {
  if (typeof source !== "string" || typeof patch !== "string") {
    throw new AgentError("Patch and source must be text.", { code: "invalid_patch" });
  }

  const sourceLines = source.replace(/\r\n/g, "\n").split("\n");
  const patchLines = patch.replace(/\r\n/g, "\n").split("\n");
  const hunks = [];
  let current = null;

  for (const line of patchLines) {
    const header = line.match(/^@@\s+-(\d+(?:,\d+)?)\s+\+(\d+(?:,\d+)?)\s+@@/);
    if (header) {
      current = { old: parseRange(header[1], 1), next: parseRange(header[2], 1), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;
    const prefix = line[0];
    if (prefix !== " " && prefix !== "+" && prefix !== "-") {
      throw new AgentError(`Invalid line in unified diff: ${line}`, { code: "invalid_patch" });
    }
    current.lines.push(line);
  }

  if (!hunks.length) throw new AgentError("Patch contains no unified diff hunks.", { code: "invalid_patch" });

  const output = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const target = hunk.old.start === 0 ? 0 : hunk.old.start - 1;
    if (target < cursor || target > sourceLines.length) {
      throw new AgentError("Patch hunk is out of order or outside the file.", { code: "patch_mismatch" });
    }
    output.push(...sourceLines.slice(cursor, target));
    cursor = target;
    let removed = 0;
    let added = 0;

    for (const line of hunk.lines) {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === "+") {
        output.push(content);
        added += 1;
        continue;
      }
      if (sourceLines[cursor] !== content) {
        throw new AgentError(
          `Patch context mismatch near line ${cursor + 1}. Expected ${JSON.stringify(content)}.`,
          { code: "patch_mismatch" },
        );
      }
      if (prefix === " ") output.push(content);
      if (prefix === "-") removed += 1;
      cursor += 1;
    }

    const consumed = hunk.lines.filter((line) => line[0] !== "+").length;
    const produced = hunk.lines.filter((line) => line[0] !== "-").length;
    if (consumed !== hunk.old.count || produced !== hunk.next.count) {
      throw new AgentError(
        `Patch range counts do not match its body (removed ${removed}, added ${added}).`,
        { code: "invalid_patch" },
      );
    }
  }

  output.push(...sourceLines.slice(cursor));
  return output.join("\n");
}
