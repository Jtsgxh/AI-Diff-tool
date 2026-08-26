export interface GraphLabelRect { x: number; y: number; width: number; height: number }
export interface LearnGraphLabel {
  text: string;
  font: string;
  color: string;
  alpha: number;
  priority: number;
  width: number;
  height: number;
  positions: { x: number; y: number }[];
}

/** Place higher-priority graph labels first, without overlapping or leaving the viewport. */
export function placeLearnGraphLabels(labels: LearnGraphLabel[], viewport: GraphLabelRect, obstacles: GraphLabelRect[] = []) {
  const cells = new Map<string, GraphLabelRect[]>();
  const keys = (rect: GraphLabelRect) => {
    const result: string[] = [];
    for (let x = Math.floor(rect.x / 64); x <= Math.floor((rect.x + rect.width) / 64); x++) {
      for (let y = Math.floor(rect.y / 64); y <= Math.floor((rect.y + rect.height) / 64); y++) result.push(`${x},${y}`);
    }
    return result;
  };
  const occupy = (rect: GraphLabelRect) => {
    for (const key of keys(rect)) {
      const entries = cells.get(key);
      if (entries) entries.push(rect);
      else cells.set(key, [rect]);
    }
  };
  obstacles.forEach(occupy);
  const placed: (LearnGraphLabel & { x: number; y: number })[] = [];
  for (const label of [...labels].sort((a, b) => b.priority - a.priority)) {
    for (const position of label.positions) {
      const rect = { ...position, width: label.width, height: label.height };
      if (rect.x < viewport.x || rect.y < viewport.y ||
        rect.x + rect.width > viewport.x + viewport.width ||
        rect.y + rect.height > viewport.y + viewport.height) continue;
      const padded = { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4 };
      const overlaps = keys(padded).some((key) => (cells.get(key) || []).some((other) =>
        padded.x < other.x + other.width && padded.x + padded.width > other.x &&
        padded.y < other.y + other.height && padded.y + padded.height > other.y));
      if (overlaps) continue;
      occupy(rect);
      placed.push({ ...label, ...position });
      break;
    }
  }
  return placed;
}
