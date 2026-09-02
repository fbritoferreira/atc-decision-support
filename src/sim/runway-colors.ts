import type { Runway } from "./types";

export type RunwayPalette = {
  stroke: string;
  fill: string;
  text: string;
  glow: string;
};

const PALETTE: RunwayPalette[] = [
  {
    stroke: "#ec4899",
    fill: "rgba(236, 72, 153, 0.10)",
    text: "#fbcfe8",
    glow: "rgba(236, 72, 153, 0.5)",
  },
  {
    stroke: "#a78bfa",
    fill: "rgba(167, 139, 250, 0.10)",
    text: "#ddd6fe",
    glow: "rgba(167, 139, 250, 0.5)",
  },
  {
    stroke: "#14b8a6",
    fill: "rgba(20, 184, 166, 0.10)",
    text: "#99f6e4",
    glow: "rgba(20, 184, 166, 0.5)",
  },
  {
    stroke: "#fb923c",
    fill: "rgba(251, 146, 60, 0.10)",
    text: "#fed7aa",
    glow: "rgba(251, 146, 60, 0.5)",
  },
  {
    stroke: "#facc15",
    fill: "rgba(250, 204, 21, 0.10)",
    text: "#fde68a",
    glow: "rgba(250, 204, 21, 0.5)",
  },
  {
    stroke: "#f43f5e",
    fill: "rgba(244, 63, 94, 0.10)",
    text: "#fecdd3",
    glow: "rgba(244, 63, 94, 0.5)",
  },
  // Six entries wrapped at KORD, which has eight strips, so 04L/22R and
  // 10C/28C drew in the same pink and 04R/22L and 10R/28L in the same violet.
  // Indices 0 and 6, and 1 and 7, in the registry's own runway order.
  // The map's job at a field with four parallel pairs is to tell them apart,
  // and the attribution work this project reports leans on a reader being
  // able to. A test now pins the table to at least the widest field.
  {
    stroke: "#38bdf8",
    fill: "rgba(56, 189, 248, 0.10)",
    text: "#bae6fd",
    glow: "rgba(56, 189, 248, 0.5)",
  },
  {
    stroke: "#a3e635",
    fill: "rgba(163, 230, 53, 0.10)",
    text: "#d9f99d",
    glow: "rgba(163, 230, 53, 0.5)",
  },
];

const FALLBACK: RunwayPalette = {
  stroke: "#94a3b8",
  fill: "rgba(148, 163, 184, 0.10)",
  text: "#cbd5e1",
  glow: "rgba(148, 163, 184, 0.4)",
};

export const paletteForRunway = (
  runwayId: string | undefined,
  runways: Runway[],
): RunwayPalette => {
  if (!runwayId) return FALLBACK;
  const idx = runways.findIndex(
    (r) => r.id === runwayId || r.id.split("/").includes(runwayId),
  );
  if (idx < 0) return FALLBACK;
  return PALETTE[idx % PALETTE.length];
};

export const paletteByIndex = (index: number): RunwayPalette => {
  // Declared RunwayPalette and returned undefined for a negative index, since
  // JavaScript's % keeps the sign. No caller passes one today; the signature
  // was still false, and paletteForRunway guards the same lookup.
  if (!Number.isInteger(index) || index < 0) return FALLBACK;
  return PALETTE[index % PALETTE.length];
};
