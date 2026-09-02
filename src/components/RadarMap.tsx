import { useEffect, useRef, useState } from "react";
import type { Flight, Runway, SimState, TrailPoint, Weather } from "#/sim/types";
import { paletteByIndex, paletteForRunway, type RunwayPalette } from "#/sim/runway-colors";
import { Cloud, CloudRain, CloudSnow, Zap } from "lucide-react";
import { FlightDetailCard } from "./FlightDetailCard";

type Props = {
  state: SimState;
  highlightedIds: string[];
};

type FlightHitbox = {
  id: string;
  px: number;
  py: number;
  blockX: number;
  blockY: number;
  blockW: number;
  blockH: number;
};

type DatablockColor = {
  fill: string;
  stroke: string;
  text: string;
};

const RAD = Math.PI / 180;
const DEFAULT_RANGE_NM = 25;
const MIN_RANGE = 3;
const MAX_RANGE = 80;
const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

const isEmergency = (squawk: string): boolean => EMERGENCY_SQUAWKS.has(squawk);

const emergencyLabel = (squawk: string): string => {
  if (squawk === "7500") return "HIJACK";
  if (squawk === "7600") return "NORDO";
  if (squawk === "7700") return "EMRG";
  return "";
};

const colorFor = (
  f: Flight,
  highlighted: boolean,
  runways: Runway[],
): DatablockColor => {
  if (highlighted) {
    return { fill: "rgba(239, 68, 68, 0.18)", stroke: "#ef4444", text: "#fecaca" };
  }
  if (f.assignedRunway) {
    const p = paletteForRunway(f.assignedRunway, runways);
    return { fill: p.fill, stroke: p.stroke, text: p.text };
  }
  if (f.type === "departure") {
    return { fill: "rgba(56, 189, 248, 0.06)", stroke: "#38bdf8", text: "#bae6fd" };
  }
  if (f.phase === "final") {
    return { fill: "rgba(251, 191, 36, 0.08)", stroke: "#fbbf24", text: "#fde68a" };
  }
  return { fill: "rgba(74, 222, 128, 0.06)", stroke: "#4ade80", text: "#bbf7d0" };
};

const splitRunwayId = (id: string): [string, string] => {
  if (id.includes("/")) {
    const [a, b] = id.split("/");
    return [a, b];
  }
  return [id, ""];
};

const drawBackground = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
  grad.addColorStop(0, "#062028");
  grad.addColorStop(0.7, "#051419");
  grad.addColorStop(1, "#020608");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(74, 222, 128, 0.04)";
  ctx.lineWidth = 1;
  const gridStep = 40;
  for (let x = 0; x <= w; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
};

const ringStepFor = (rangeNm: number): number => {
  if (rangeNm <= 6) return 1;
  if (rangeNm <= 15) return 2;
  if (rangeNm <= 30) return 5;
  return 10;
};

const drawRangeRings = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pxPerNm: number,
  rangeNm: number,
) => {
  const ringStep = ringStepFor(rangeNm);
  ctx.strokeStyle = "rgba(74, 222, 128, 0.18)";
  ctx.fillStyle = "rgba(155, 199, 175, 0.55)";
  ctx.font = "9px 'JetBrains Mono', monospace";

  for (let r = ringStep; r <= rangeNm + 0.001; r += ringStep) {
    const px = r * pxPerNm;
    const last = Math.abs(r - rangeNm) < 0.001;
    ctx.setLineDash(last ? [] : [2, 4]);
    ctx.lineWidth = last ? 1.2 : 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, px, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    const labelX = cx + px + 4;
    const labelY = cy + 3;
    ctx.fillText(`${r}`, labelX, labelY);
  }
  ctx.setLineDash([]);
};

const drawCompassRose = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
) => {
  ctx.fillStyle = "rgba(190, 240, 215, 0.95)";
  ctx.font = "bold 13px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, 14);
  ctx.fillText("S", cx, h - 4);
  ctx.fillText("E", w - 10, cy + 4);
  ctx.fillText("W", 12, cy + 4);

  ctx.strokeStyle = "rgba(74, 222, 128, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 4, 0);
  ctx.lineTo(cx + 4, 0);
  ctx.moveTo(cx - 4, h);
  ctx.lineTo(cx + 4, h);
  ctx.moveTo(0, cy - 4);
  ctx.lineTo(0, cy + 4);
  ctx.moveTo(w, cy - 4);
  ctx.lineTo(w, cy + 4);
  ctx.stroke();

  ctx.textAlign = "start";
};

const drawRunway = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pxPerNm: number,
  rwy: Runway,
  index: number,
  total: number,
  palette: RunwayPalette,
) => {
  const lengthNm = rwy.lengthFt / 6076;
  const halfLen = (lengthNm / 2) * pxPerNm;
  // The aircraft on this canvas are placed by projecting latitude and
  // longitude about the airport reference point, which is a true-north frame.
  // Drawing the runway from its MAGNETIC heading therefore rotates the strip
  // relative to the traffic by the local variation: at KLAX that is 14
  // degrees, so an aircraft established on the ILS five miles out appeared
  // more than a mile off the centreline it was tracking. Fourth instance of
  // the true-versus-magnetic error this project has now found, and the only
  // one a viewer could see rather than infer.
  //
  // Scenario runways carry no true course and fall back to the magnetic value,
  // which is also the frame their hand-placed positions were authored in, so
  // the scenario picture is unchanged.
  const headingRad = ((rwy.trueCourseDeg ?? rwy.headingDeg) - 90) * RAD;
  const perpRad = headingRad + Math.PI / 2;
  const offsetNm = (index - (total - 1) / 2) * 0.35;
  const offsetPx = offsetNm * pxPerNm;
  const ox = Math.cos(perpRad) * offsetPx;
  const oy = Math.sin(perpRad) * offsetPx;

  const ax = cx + ox - Math.cos(headingRad) * halfLen;
  const ay = cy + oy - Math.sin(headingRad) * halfLen;
  const bx = cx + ox + Math.cos(headingRad) * halfLen;
  const by = cy + oy + Math.sin(headingRad) * halfLen;

  const width = Math.max(3, pxPerNm * 0.05);
  ctx.save();
  ctx.translate(cx + ox, cy + oy);
  ctx.rotate(headingRad);
  ctx.fillStyle = palette.stroke;
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 10;
  ctx.fillRect(-halfLen, -width / 2, halfLen * 2, width);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#0a1518";
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = -halfLen + 6; i < halfLen - 6; i += 6) {
    ctx.moveTo(i, -width / 2);
    ctx.lineTo(i, width / 2);
  }
  ctx.stroke();
  ctx.restore();

  const [aEnd, bEnd] = splitRunwayId(rwy.id);
  const labelOffset = 14;
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.fillStyle = palette.text;
  ctx.textAlign = "center";

  const drawEndLabel = (x: number, y: number, label: string, dirRad: number) => {
    const lx = x + Math.cos(dirRad) * labelOffset;
    const ly = y + Math.sin(dirRad) * labelOffset + 3;
    ctx.fillText(label, lx, ly);
  };

  drawEndLabel(ax, ay, aEnd, headingRad + Math.PI);
  if (bEnd) drawEndLabel(bx, by, bEnd, headingRad);
  ctx.textAlign = "start";
};

type PlaneLayout = {
  flight: Flight;
  px: number;
  py: number;
  clamped: boolean;
  highlighted: boolean;
  emergency: boolean;
  color: DatablockColor;
  line1: string;
  line2: string;
  blockW: number;
  blockH: number;
};

type Placed = PlaneLayout & {
  blockX: number;
  blockY: number;
};

const CANDIDATE_OFFSETS = [
  { dx: 14, dy: -28 },
  { dx: 14, dy: 0 },
  { dx: 14, dy: 14 },
  { dx: 0, dy: 18 },
  { dx: 0, dy: -38 },
  { dx: -14, dy: -28, leftAnchor: true },
  { dx: -14, dy: 0, leftAnchor: true },
  { dx: -14, dy: 14, leftAnchor: true },
] as const;

const candidateForPlane = (
  layout: PlaneLayout,
  offset: typeof CANDIDATE_OFFSETS[number],
): { blockX: number; blockY: number } => {
  const dx = "leftAnchor" in offset && offset.leftAnchor
    ? offset.dx - layout.blockW
    : offset.dx;
  return { blockX: layout.px + dx, blockY: layout.py + offset.dy };
};

const rectsOverlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const preferredOffsetIndex = (heading: number): number => {
  const h = ((heading % 360) + 360) % 360;
  if (h >= 315 || h < 45) return 1;
  if (h < 135) return 2;
  if (h < 225) return 6;
  return 0;
};

const placeBlocks = (
  layouts: PlaneLayout[],
  canvasW: number,
  canvasH: number,
): Placed[] => {
  const placed: Placed[] = [];
  const sorted = [...layouts].sort((a, b) => {
    if (a.emergency !== b.emergency) return a.emergency ? -1 : 1;
    if (a.highlighted !== b.highlighted) return a.highlighted ? -1 : 1;
    return Math.hypot(a.px - canvasW / 2, a.py - canvasH / 2) -
      Math.hypot(b.px - canvasW / 2, b.py - canvasH / 2);
  });

  for (const layout of sorted) {
    const preferred = preferredOffsetIndex(layout.flight.headingDeg);
    const order = [
      preferred,
      ...CANDIDATE_OFFSETS.map((_, i) => i).filter((i) => i !== preferred),
    ];
    let best: { blockX: number; blockY: number; score: number } | undefined;
    for (const idx of order) {
      const cand = candidateForPlane(layout, CANDIDATE_OFFSETS[idx]);
      const rect = {
        x: cand.blockX,
        y: cand.blockY,
        w: layout.blockW,
        h: layout.blockH,
      };
      const offCanvasPenalty =
        (rect.x < 0 ? -rect.x : 0) +
        (rect.x + rect.w > canvasW ? rect.x + rect.w - canvasW : 0) +
        (rect.y < 0 ? -rect.y : 0) +
        (rect.y + rect.h > canvasH ? rect.y + rect.h - canvasH : 0);
      let overlapPenalty = 0;
      for (const p of placed) {
        const r2 = { x: p.blockX, y: p.blockY, w: p.blockW, h: p.blockH };
        if (rectsOverlap(rect, r2)) overlapPenalty += 100;
      }
      const score = overlapPenalty + offCanvasPenalty * 0.5;
      if (!best || score < best.score) {
        best = { blockX: cand.blockX, blockY: cand.blockY, score };
        if (score === 0) break;
      }
    }
    placed.push({ ...layout, blockX: best!.blockX, blockY: best!.blockY });
  }
  return placed;
};

const hexToRgb = (hex: string): [number, number, number] => {
  const m = hex.replace("#", "");
  const r = Number.parseInt(m.slice(0, 2), 16);
  const g = Number.parseInt(m.slice(2, 4), 16);
  const b = Number.parseInt(m.slice(4, 6), 16);
  return [r, g, b];
};

const drawTrail = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pxPerNm: number,
  points: TrailPoint[],
  strokeHex: string,
) => {
  if (points.length < 2) return;
  const [r, g, b] = hexToRgb(strokeHex);
  const len = points.length;
  for (let i = 0; i < len - 1; i++) {
    const p = points[i];
    const px = cx + p.x * pxPerNm;
    const py = cy + p.y * pxPerNm;
    const age = (len - 1 - i) / len;
    const alpha = Math.max(0.04, (1 - age) * 0.45);
    const size = Math.max(1, 2.5 * (1 - age));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
};

const computeLayout = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pxPerNm: number,
  rangeNm: number,
  f: Flight,
  highlighted: boolean,
  runways: Runway[],
): PlaneLayout | null => {
  let { x, y } = { x: f.positionNm.x, y: f.positionNm.y };
  const distNm = Math.hypot(x, y);
  let clamped = false;
  if (distNm > rangeNm) {
    const scale = rangeNm / distNm;
    x *= scale;
    y *= scale;
    clamped = true;
  }
  const px = cx + x * pxPerNm;
  const py = cy + y * pxPerNm;
  const emergency = isEmergency(f.squawk);
  const color = emergency
    ? { fill: "rgba(239, 68, 68, 0.25)", stroke: "#ef4444", text: "#fecaca" }
    : colorFor(f, highlighted, runways);
  const line1 = f.callsign;
  const altFl = String(Math.round(f.altitudeFt / 100)).padStart(3, "0");
  const spd = String(Math.round(f.speedKts)).padStart(3, "0");
  const line2 = `${f.aircraft} ${altFl} ${spd}`;
  ctx.font = "bold 12px 'JetBrains Mono', monospace";
  const w1 = ctx.measureText(line1).width;
  ctx.font = "11px 'JetBrains Mono', monospace";
  const w2 = ctx.measureText(line2).width;
  const blockW = Math.max(w1, w2) + 8;
  return {
    flight: f,
    px,
    py,
    clamped,
    highlighted,
    emergency,
    color,
    line1,
    line2,
    blockW,
    blockH: 30,
  };
};

const drawClampedIndicator = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  px: number,
  py: number,
) => {
  ctx.strokeStyle = "rgba(155, 199, 175, 0.35)";
  ctx.fillStyle = "rgba(155, 199, 175, 0.6)";
  ctx.lineWidth = 1;
  const rad = Math.atan2(py - cy, px - cx);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px - Math.cos(rad) * 6 - Math.sin(rad) * 4, py - Math.sin(rad) * 6 + Math.cos(rad) * 4);
  ctx.lineTo(px - Math.cos(rad) * 6 + Math.sin(rad) * 4, py - Math.sin(rad) * 6 - Math.cos(rad) * 4);
  ctx.closePath();
  ctx.fill();
};

const drawPlaneSymbol = (
  ctx: CanvasRenderingContext2D,
  layout: Placed,
  flashOn: boolean,
) => {
  const { px, py, color, highlighted, emergency, flight } = layout;
  ctx.fillStyle = color.stroke;
  ctx.strokeStyle = color.stroke;
  ctx.shadowColor = color.stroke;
  ctx.shadowBlur = emergency ? (flashOn ? 22 : 8) : highlighted ? 14 : 6;

  if (emergency) {
    ctx.save();
    ctx.strokeStyle = flashOn ? "#ef4444" : "rgba(239, 68, 68, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, flashOn ? 16 : 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.fillRect(px - 4, py - 4, 8, 8);
  } else {
    ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
  }
  ctx.shadowBlur = 0;

  const speedScale = Math.max(8, Math.min(24, flight.speedKts / 14));
  const hdgRad = (flight.headingDeg - 90) * RAD;
  ctx.lineWidth = highlighted ? 1.6 : 1.1;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + Math.cos(hdgRad) * speedScale, py + Math.sin(hdgRad) * speedScale);
  ctx.stroke();
};

const drawDatablock = (
  ctx: CanvasRenderingContext2D,
  layout: Placed,
  flashOn: boolean,
) => {
  const { px, py, blockX, blockY, blockW, blockH, color, highlighted, emergency, line1, line2, flight } = layout;

  const blockMidY = blockY + blockH / 2;
  const blockMidX = blockX + blockW / 2;
  const isRight = blockMidX > px;
  const isAbove = blockMidY < py;
  const leaderStartX = px + (isRight ? 3 : -3);
  const leaderEndX = isRight ? blockX : blockX + blockW;
  const leaderEndY = isAbove ? blockY + blockH : blockY;

  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = highlighted ? 1.2 : 0.6;
  ctx.beginPath();
  ctx.moveTo(leaderStartX, py);
  ctx.lineTo(leaderEndX, leaderEndY);
  ctx.stroke();

  ctx.fillStyle = color.fill;
  ctx.fillRect(blockX, blockY, blockW, blockH);
  ctx.strokeRect(blockX, blockY, blockW, blockH);

  ctx.fillStyle = color.text;
  ctx.font = "bold 12px 'JetBrains Mono', monospace";
  ctx.fillText(line1, blockX + 4, blockY + 12);
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillStyle = color.stroke;
  ctx.fillText(line2, blockX + 4, blockY + 25);

  if (emergency) {
    const label = emergencyLabel(flight.squawk);
    ctx.font = "bold 11px 'JetBrains Mono', monospace";
    ctx.fillStyle = flashOn ? "#ef4444" : "rgba(239, 68, 68, 0.55)";
    ctx.fillText(`⚠ ${label} ${flight.squawk}`, blockX + 4, blockY - 4);
  }
};

const conditionColor: Record<Weather["condition"], string> = {
  VFR: "#4ade80",
  MVFR: "#38bdf8",
  IFR: "#fbbf24",
  LIFR: "#ef4444",
};

const drawWeatherLayer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  pxPerNm: number,
  rangeNm: number,
  weather: Weather,
) => {
  const radius = rangeNm * pxPerNm;
  const fromRad = ((weather.windDirDeg - 90) * RAD) - Math.PI;
  const lineLen = Math.max(36, Math.min(radius * 0.45, 110));
  const headLen = 9;
  const tailX = cx + Math.cos(fromRad) * lineLen;
  const tailY = cy + Math.sin(fromRad) * lineLen;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
  ctx.shadowColor = "rgba(56, 189, 248, 0.6)";
  ctx.shadowBlur = 6;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tailX, tailY);
  ctx.stroke();

  const arrowRad = fromRad + Math.PI;
  const headBaseX = cx + Math.cos(arrowRad) * (lineLen * 0.18);
  const headBaseY = cy + Math.sin(arrowRad) * (lineLen * 0.18);
  ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    headBaseX + Math.cos(arrowRad + Math.PI / 2) * (headLen * 0.6),
    headBaseY + Math.sin(arrowRad + Math.PI / 2) * (headLen * 0.6),
  );
  ctx.lineTo(
    headBaseX - Math.cos(arrowRad + Math.PI / 2) * (headLen * 0.6),
    headBaseY - Math.sin(arrowRad + Math.PI / 2) * (headLen * 0.6),
  );
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.font = "bold 10px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(186, 230, 253, 0.95)";
  const labelX = tailX + Math.cos(fromRad) * 12;
  const labelY = tailY + Math.sin(fromRad) * 12 + 3;
  // Marked T because it is true-referenced and sits beside magnetic runway
  // identifiers. METAR reports wind against true north; a tower or ATIS
  // reports it against magnetic, which is what a reader seeing a bare "350°"
  // next to runway 28 would assume. The two differ by the local variation, 14
  // degrees at KLAX. Converting it to magnetic instead would need a variation
  // this repository does not carry as a field, and deriving one from the
  // registry headings would inherit the contradictions five airports are
  // already pinned for, so the honest fix is to say which reference it is.
  const windLabel = weather.gustsKts > weather.windKts
    ? `${String(weather.windDirDeg).padStart(3, "0")}°T/${weather.windKts}G${weather.gustsKts}`
    : `${String(weather.windDirDeg).padStart(3, "0")}°T/${weather.windKts}`;
  ctx.fillText(windLabel, labelX - 30, labelY);

  const boxX = 14;
  const boxY = 14;
  const boxW = 168;
  const boxH = 78;
  ctx.fillStyle = "rgba(6, 32, 40, 0.86)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
  ctx.lineWidth = 1;
  ctx.fillRect(boxX, boxY, boxW, boxH);
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(155, 199, 175, 0.6)";
  ctx.fillText("WEATHER OVERLAY", boxX + 8, boxY + 14);

  ctx.font = "bold 14px 'JetBrains Mono', monospace";
  ctx.fillStyle = conditionColor[weather.condition];
  // A METAR without a flight category is recorded as VFR, and drawing that the
  // same as a reported VFR is the defect this project keeps finding: an
  // invented value rendered like a measured one. The marker is the whole cost.
  ctx.fillText(
    weather.conditionObserved === false
      ? `${weather.condition} (assumed)`
      : weather.condition,
    boxX + 8,
    boxY + 32,
  );

  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = "rgba(200, 224, 220, 0.85)";
  ctx.fillText(`WIND ${windLabel}`, boxX + 8, boxY + 48);
  ctx.fillText(`VIS  ${weather.visibilityNm}NM`, boxX + 8, boxY + 60);
  ctx.fillText(
    `CEIL ${weather.ceilingFt >= 12000 ? "—" : weather.ceilingFt + "ft"}`,
    boxX + 8,
    boxY + 72,
  );
};

export function RadarMap({ state, highlightedIds }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const hitboxesRef = useRef<FlightHitbox[]>([]);
  const [rangeNm, setRangeNm] = useState(DEFAULT_RANGE_NM);
  const [weatherOn, setWeatherOn] = useState(false);
  const [selected, setSelected] = useState<{ flight: Flight; pos: { x: number; y: number } } | null>(null);
  const [flashOn, setFlashOn] = useState(false);

  const hasEmergency = state.flights.some((f) => isEmergency(f.squawk));

  useEffect(() => {
    if (!hasEmergency) return;
    const id = setInterval(() => setFlashOn((v) => !v), 500);
    return () => clearInterval(id);
  }, [hasEmergency]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 16;
    const pxPerNm = radius / rangeNm;

    drawBackground(ctx, w, h);
    drawRangeRings(ctx, cx, cy, pxPerNm, rangeNm);
    drawCompassRose(ctx, cx, cy, w, h);

    state.runways.forEach((rwy, i) => {
      drawRunway(ctx, cx, cy, pxPerNm, rwy, i, state.runways.length, paletteByIndex(i));
    });

    ctx.fillStyle = "rgba(74, 222, 128, 0.85)";
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "8px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(155, 199, 175, 0.65)";
    ctx.fillText("ARP", cx + 6, cy - 6);

    const arrivals = state.flights.filter((f) => f.type === "arrival");
    const departures = state.flights.filter((f) => f.type === "departure");
    const all = [...departures, ...arrivals];

    for (const f of all) {
      const trail = state.trails[f.id];
      if (trail && trail.length > 1) {
        const baseColor = colorFor(f, false, state.runways).stroke;
        drawTrail(ctx, cx, cy, pxPerNm, trail, baseColor);
      }
    }

    const visibleLayouts: PlaneLayout[] = [];
    for (const f of all) {
      const layout = computeLayout(
        ctx,
        cx,
        cy,
        pxPerNm,
        rangeNm,
        f,
        highlightedIds.includes(f.id),
        state.runways,
      );
      if (!layout) continue;
      if (layout.clamped) {
        drawClampedIndicator(ctx, cx, cy, layout.px, layout.py);
      } else {
        visibleLayouts.push(layout);
      }
    }

    const placed = placeBlocks(visibleLayouts, w, h);
    const hits: FlightHitbox[] = [];
    for (const p of placed) {
      drawPlaneSymbol(ctx, p, flashOn);
    }
    for (const p of placed) {
      drawDatablock(ctx, p, flashOn);
      hits.push({
        id: p.flight.id,
        px: p.px,
        py: p.py,
        blockX: p.blockX,
        blockY: p.blockY,
        blockW: p.blockW,
        blockH: p.blockH,
      });
    }
    hitboxesRef.current = hits;

    if (weatherOn) {
      // Not drawn on a live picture until an observation exists for the
      // airport on screen. The weather block is seeded with a calm westerly
      // before the first METAR and carried over from the previous field across
      // an airport switch, so the arrow would otherwise point somewhere on the
      // strength of a value nobody measured. The panel says the same thing in
      // words; this is the same gate on the canvas.
      const weatherObserved =
        !state.live || state.weatherObservedFor === state.sectorId.split(" ")[0];
      if (weatherObserved) {
        drawWeatherLayer(ctx, cx, cy, pxPerNm, rangeNm, state.weather);
      }
    }

    ctx.strokeStyle = "rgba(74, 222, 128, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [state, highlightedIds, rangeNm, weatherOn, flashOn]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setRangeNm((r) => {
        const next = r * factor;
        return Math.max(MIN_RANGE, Math.min(MAX_RANGE, Math.round(next * 10) / 10));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const findHit = (x: number, y: number): FlightHitbox | null => {
    let closest: FlightHitbox | null = null;
    let closestDist = Number.POSITIVE_INFINITY;
    for (const h of hitboxesRef.current) {
      if (
        x >= h.blockX &&
        x <= h.blockX + h.blockW &&
        y >= h.blockY &&
        y <= h.blockY + h.blockH
      ) {
        return h;
      }
      const d = Math.hypot(h.px - x, h.py - y);
      if (d < closestDist) {
        closestDist = d;
        closest = h;
      }
    }
    return closest && closestDist <= 28 ? closest : null;
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = findHit(x, y);
    if (hit) {
      const flight = state.flights.find((f) => f.id === hit.id);
      if (flight) {
        setSelected({ flight, pos: { x: e.clientX, y: e.clientY } });
        return;
      }
    }
    setSelected(null);
  };

  const onCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    canvas.style.cursor = findHit(x, y) ? "pointer" : "crosshair";
  };

  useEffect(() => {
    if (!selected) return;
    const fresh = state.flights.find((f) => f.id === selected.flight.id);
    if (!fresh) {
      setSelected(null);
      return;
    }
    if (fresh !== selected.flight) {
      setSelected({ flight: fresh, pos: selected.pos });
    }
  }, [state.flights, selected]);

  const PrecipIcon =
    state.weather.precipitation === "thunderstorm"
      ? Zap
      : state.weather.precipitation === "snow"
        ? CloudSnow
        : state.weather.precipitation === "rain"
          ? CloudRain
          : Cloud;

  return (
    <div className="panel flex-1 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between">
        <span>Radar — {state.sectorId}</span>
        <div className="flex items-center gap-2 normal-case tracking-normal">
          <button
            type="button"
            onClick={() => setWeatherOn((v) => !v)}
            className={`flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 border rounded ${
              weatherOn
                ? "border-[var(--color-cyan)] text-[var(--color-cyan)] bg-[var(--color-cyan)]/10"
                : "border-[var(--color-line)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
            }`}
            title="Toggle weather overlay"
          >
            <PrecipIcon size={11} />
            WX
          </button>
          <span className="font-mono text-[10px] text-[var(--color-text-dim)] ml-2">
            RANGE {rangeNm.toFixed(rangeNm < 10 ? 1 : 0)} NM
          </span>
          {[10, 25, 40].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRangeNm(r)}
              className={`font-mono text-[10px] px-1.5 py-0.5 border rounded ${
                Math.abs(rangeNm - r) < 0.01
                  ? "border-[var(--color-phosphor)] text-[var(--color-phosphor)]"
                  : "border-[var(--color-line)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
              }`}
            >
              {r}
            </button>
          ))}
          <span className="font-mono text-[9px] text-[var(--color-text-dim)] ml-2">
            scroll to zoom
          </span>
        </div>
      </div>
      <div ref={wrapRef} className="radar-canvas flex-1 relative overflow-hidden">
        <canvas
          ref={ref}
          onClick={onCanvasClick}
          onMouseMove={onCanvasMove}
          className="absolute inset-0 w-full h-full cursor-crosshair"
        />
        {selected && (
          <FlightDetailCard
            flight={selected.flight}
            pos={selected.pos}
            runways={state.runways}
            isLive={state.live}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
