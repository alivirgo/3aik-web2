import { createInterface } from "node:readline/promises";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
};

export class TerminalUI {
  constructor({ input = process.stdin, output = process.stdout, error = process.stderr, color = output.isTTY && !process.env.NO_COLOR } = {}) {
    this.input = input;
    this.output = output;
    this.error = error;
    this.color = Boolean(color);
    this.interface = null;
  }

  style(value, ...styles) {
    if (!this.color) return String(value);
    return `${styles.map((name) => ANSI[name] || "").join("")}${value}${ANSI.reset}`;
  }

  write(value) { this.output.write(String(value)); }
  line(value = "") { this.output.write(`${value}\n`); }
  warn(value) { this.error.write(`${this.style(value, "yellow")}\n`); }
  fail(value) { this.error.write(`${this.style(value, "red")}\n`); }

  async question(prompt) {
    this.interface ||= createInterface({ input: this.input, output: this.output, terminal: Boolean(this.input.isTTY && this.output.isTTY) });
    return this.interface.question(prompt);
  }

  async confirm({ description, risk }) {
    if (!this.input.isTTY) return false;
    const label = risk === "dangerous" ? this.style("DANGEROUS", "red", "bold") : this.style(String(risk).toUpperCase(), "yellow");
    this.line(`\n${label} ${description}`);
    const answer = (await this.question("Allow? [y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  }

  close() {
    this.interface?.close();
    this.interface = null;
  }
}

export async function readStdin(input = process.stdin, maxBytes = 1_000_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error(`Standard input exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}
