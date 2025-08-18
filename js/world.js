import { Biome } from './biomes.js';

export const Factions = [];

export function seedPointsFor(w, h, count = 8) {
  const jitter = (n) => ((Math.random() * n) | 0) - (n >> 1);
  const pts = [
    { x: 2 + jitter(2), y: 2 + jitter(2) },
    { x: w - 3 + jitter(2), y: 2 + jitter(2) },
    { x: 2 + jitter(2), y: h - 3 + jitter(2) },
    { x: w - 3 + jitter(2), y: h - 3 + jitter(2) },
    { x: (w >> 1) + jitter(6), y: 2 + jitter(2) },
    { x: w - 3 + jitter(2), y: (h >> 1) + jitter(6) },
    { x: (w >> 1) + jitter(6), y: h - 3 + jitter(2) },
    { x: 2 + jitter(2), y: (h >> 1) + jitter(6) },
  ];
  return pts.slice(0, count);
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
  for (let i = 0; i < capPts.length; i++) {
    const p = capPts[i];
    const cx = Math.max(2, Math.min(w - 3, p.x));
    const cy = Math.max(2, Math.min(h - 3, p.y));
    Factions.push({
      id: i,
      name: i === playerFID ? 'Our Country' : 'Faction ' + (i + 1),
      color: colors[i % colors.length],
      cap: { x: cx, y: cy },
      res: {
        gold: 10,
        food: 10,
        wood: 10,
        stone: 10,
        iron: 0,
        tools: 0,
        luxury: 0,
      },
      pop: 0,
      army: 0,
      morale: 100,
      stability: 50,
      prestige: 0,
      score: 0,
    });
  }
  for (let f = 0; f < Factions.length; f++) {
    const F = Factions[f];
    WORLD.data[idx(F.cap.x, F.cap.y)] = Biome.GRASS;
    WORLD.owner[idx(F.cap.x, F.cap.y)] = F.id;
    WORLD.pop[idx(F.cap.x, F.cap.y)] = 1000;
    WORLD.settle[idx(F.cap.x, F.cap.y)] = 'town';
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.max(Math.abs(x - F.cap.x), Math.abs(y - F.cap.y));
        if (d > 0 && d <= BORDER_R_INIT) {
          const k = idx(x, y);
          if (WORLD.owner[k] === -1) {
            WORLD.owner[k] = F.id;
            switch (WORLD.data[k]) {
              case Biome.GRASS:
                WORLD.pop[k] = 100;
                break;
              case Biome.FOREST:
                WORLD.pop[k] = 75;
                break;
              case Biome.MOUNTAIN:
                WORLD.pop[k] = 50;
                break;
              default:
                WORLD.pop[k] = 0;
            }
          }
        }
      }
  }
  for (let i = 0; i < WORLD.pop.length; i++) {
    const fid = WORLD.owner[i];
    if (fid >= 0) Factions[fid].pop += WORLD.pop[i];
  }
}
