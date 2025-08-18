import { Factions } from './world.js';
import { Biome } from './biomes.js';

// Compute resource production and population changes for each faction.
// WORLD: {w,h,data,owner}; idx: function to convert x,y to array index.
export function economyTick(WORLD, idx) {
  const yields = [];
  const bonuses = [];
  const factionPop = [];
  for (let f = 0; f < Factions.length; f++) {
    yields[f] = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0, luxury: 0 };
    bonuses[f] = 1 + Factions[f].res.tools * 0.05;
    factionPop[f] = 0;
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
          yields[fid].iron += 1;
          break;
        case Biome.BERRY:
          yields[fid].food += 2;
          yields[fid].luxury += 1;
          break;
        case Biome.RIVER:
          yields[fid].gold += 1;
          yields[fid].luxury += 1;
          break;
        case Biome.LAKE:
          yields[fid].food += 1;
          yields[fid].gold += 1;
          break;
      }
      const t = WORLD.settle[k]
        ? WORLD.settle[k]
        : b === Biome.GRASS
          ? 'plain'
          : b === Biome.FOREST
            ? 'forest'
            : b === Biome.MOUNTAIN
              ? 'mountain'
              : 'sea';
      let rate = 0;
      switch (t) {
        case 'city':
          rate = 0.012;
          break;
        case 'town':
          rate = 0.01;
          break;
        case 'village':
          rate = 0.008;
          break;
        case 'plain':
          rate = 0.006;
          break;
        case 'forest':
          rate = 0.004;
          break;
        case 'mountain':
          rate = 0.002;
          break;
      }
      WORLD.pop[k] = Math.floor(WORLD.pop[k] * (1 + rate));
      factionPop[fid] += WORLD.pop[k];
    }
  }
  for (let f = 0; f < Factions.length; f++) {
    const F = Factions[f];
    const Y = yields[f];
    const bonus = bonuses[f];
    F.res.gold += Math.floor(Y.gold * bonus);
    F.res.food += Math.floor(Y.food * bonus);
    F.res.wood += Math.floor(Y.wood * bonus);
    F.res.stone += Math.floor(Y.stone * bonus);
    F.res.iron += Math.floor(Y.iron * bonus);
    F.res.luxury += Math.floor(Y.luxury * bonus);
    // luxury goods are automatically sold for gold
    if (F.res.luxury > 0) {
      F.res.gold += F.res.luxury * 3;
      F.res.luxury = 0;
    }
    // craft tools from wood and iron to boost future production
    const craft = Math.min(
      Math.floor(F.res.wood / 2),
      Math.floor(F.res.iron / 2),
    );
    if (craft > 0) {
      F.res.wood -= craft * 2;
      F.res.iron -= craft * 2;
      F.res.tools += craft;
    }
    F.pop = factionPop[f];
    // capital generates gold based on population
    F.res.gold += F.pop * 0.001;
    F.score =
      F.pop +
      F.res.gold +
      F.res.food +
      F.res.wood +
      F.res.stone +
      F.res.iron +
      F.res.tools +
      F.army;
  }
}
