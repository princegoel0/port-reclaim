import process from "node:process";

export type Colour = "bold" | "dim" | "red" | "green" | "yellow";

const CODES: Record<Colour, string> = {
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
};

const RESET = "\u001b[0m";

export type ColourMode = "auto" | "always" | "never";

let mode: ColourMode = "auto";

export function setColourMode(next: ColourMode): void {
  mode = next;
}

export function colourEnabled(): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

// Wraps a whole segment rather than interpolating inside one, so message text stays greppable.
export function paint(colour: Colour, text: string): string {
  return colourEnabled() ? `${CODES[colour]}${text}${RESET}` : text;
}

