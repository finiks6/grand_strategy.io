import { Factions } from './world.js';
import { Biome } from './biomes.js';

// Compute resource production and population changes for each faction.
// WORLD: {w,h,data,owner}; idx: function to convert x,y to array index.
export function economyTick(WORLD, idx) {
  const yields = [];
  for (let f = 0; f < Factions.length; f++) {
    yields[f] = { gold: 0, food: 0, wood: 0, stone: 0 };
  }
  const w = WORLD.w, h = WORLD.h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = idx(x, y);
      const fid = WORLD.owner[k];
      if (fid === -1) continue;
      const b = WORLD.data[k];
      switch (b) {
        case Biome.GRASS:
          yields[fid].food += 1;
          break;
        case Biome.FOREST:
          yields[fid].wood += 1;
          break;
        case Biome.MOUNTAIN:
          yields[fid].stone += 1;
          break;
        case Biome.BERRY:
          yields[fid].food += 2;
          break;
        case Biome.RIVER:
          yields[fid].gold += 1;
          break;
      }
    }
  }
  for (let f = 0; f < Factions.length; f++) {
    const F = Factions[f];
    const Y = yields[f];
    F.res.gold += Y.gold;
    F.res.food += Y.food;
    F.res.wood += Y.wood;
    F.res.stone += Y.stone;
    const growth = Math.floor(F.res.food / 20);
    if (growth > 0) {
      F.pop += growth;
      F.res.food -= growth;
    } else if (F.res.food <= 0 && F.pop > 0) {
      F.pop -= 1;
    }
    F.score =
      F.pop + F.res.gold + F.res.food + F.res.wood + F.res.stone;
  }
}
