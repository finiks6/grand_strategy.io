import { Biome } from './biomes.js';

export const Factions = [];

export function seedPointsFor(w, h) {
  const jit = (n) => ((Math.random() * n) | 0) - (n >> 1);
  return [
    { x: 2 + jit(2), y: 2 + jit(2) },
    { x: w - 3 + jit(2), y: 2 + jit(2) },
    { x: 2 + jit(2), y: h - 3 + jit(2) },
    { x: w - 3 + jit(2), y: h - 3 + jit(2) },
    { x: (w >> 1) + jit(6), y: 2 + jit(2) },
    { x: w - 3 + jit(2), y: (h >> 1) + jit(6) },
    { x: (w >> 1) + jit(6), y: h - 3 + jit(2) },
    { x: 2 + jit(2), y: (h >> 1) + jit(6) },
  ];
}

export function seedFactions(capPts, WORLD, idx, playerFID, BORDER_R_INIT) {
  Factions.length = 0;
  const w = WORLD.w,
    h = WORLD.h;
  const colors = [
    0x4be4e2,
    0xff6b6b,
    0xffd93d,
    0x6ee7b7,
    0xa78bfa,
    0xf9a8d4,
    0xf472b6,
    0x60a5fa,
  ];
  for (let i = 0; i < 8; i++) {
    const p = capPts[i];
    const cx = Math.max(2, Math.min(w - 3, p.x)),
      cy = Math.max(2, Math.min(h - 3, p.y));
    Factions.push({
      id: i,
      name: i === playerFID ? 'Our Country' : 'Faction ' + (i + 1),
      color: colors[i % colors.length],
      cap: { x: cx, y: cy },
      res: { gold: 100, food: 10, wood: 10, stone: 10 },
      pop: 1000,
      stability: 50,
      prestige: 0,
      score: 0,
    });
  }
  for (let f = 0; f < Factions.length; f++) {
    const F = Factions[f];
    WORLD.data[idx(F.cap.x, F.cap.y)] = Biome.GRASS;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.max(Math.abs(x - F.cap.x), Math.abs(y - F.cap.y));
        if (d > 0 && d <= BORDER_R_INIT) {
          const k = idx(x, y);
          if (WORLD.owner[k] === -1) WORLD.owner[k] = F.id;
        }
      }
    WORLD.owner[idx(F.cap.x, F.cap.y)] = F.id;
  }
}
