import type { AgentSnapshot, Direction, ElementRow } from "./types.js";

function opsFlags(operations: string[]): string {
  return operations
    .map((operation) => {
      if (operation === "CLICK") {
        return "C";
      }
      if (operation === "TYPE_TEXT") {
        return "T";
      }
      if (operation === "SELECT") {
        return "S";
      }
      return operation.slice(0, 1);
    })
    .join("/");
}

function valueSuffix(element: ElementRow): string {
  if (element.value === undefined || element.value === "") {
    return element.operations.includes("TYPE_TEXT") ? " · empty" : "";
  }
  return ` · ${element.value}`;
}

export function formatTable(snapshot: AgentSnapshot, options: { full?: boolean } = {}): string {
  const page = snapshot.page;
  const height = page.scroll.height ?? "?";
  const omitted = page.omitted_actions ?? 0;
  const lines = [
    `${page.url}  ${page.title}`,
    `scroll ${page.scroll.y}/${height}  omitted ${omitted}  status ${snapshot.status}  actions ${snapshot.history.length}`,
    "",
  ];
  for (const element of snapshot.elements) {
    const role = (element.role ?? "").padEnd(10);
    lines.push(
      `[${element.index}] ${role} ${element.label}${valueSuffix(element)}  ops=${opsFlags(element.operations)}`,
    );
    if (element.options && element.options.length > 0) {
      for (const option of element.options.slice(0, 8)) {
        lines.push(`    ${option.index}  ${option.label}`);
      }
      if (element.options.length > 8) {
        lines.push(`    … ${element.options.length - 8} more options`);
      }
    }
  }
  const last = snapshot.history.at(-1);
  if (last) {
    lines.push("");
    lines.push(
      `last ${last.source} ${last.operation}${last.target ? ` ${last.target}` : ""}  changed=${last.page_changed}  ${last.url}`,
    );
  }
  if (options.full && page.text) {
    lines.push("");
    lines.push(page.text.slice(0, 6000));
  }
  return lines.join("\n");
}

export function formatDirections(directions: Direction[], options: { confidence?: number } = {}): string {
  const conf =
    options.confidence === undefined ? directions[0]?.operation_confidence : options.confidence;
  const header = `suggest  op_conf=${conf === undefined ? "?" : conf.toFixed(2)}  (${directions.length} shown)`;
  const rows = directions.map((direction) => {
    const target = direction.target ? ` ${direction.target}` : "";
    return `  ${direction.joint.toFixed(2)}  ${direction.operation}${target}  ${direction.label}`;
  });
  return [header, "", ...rows].join("\n");
}
