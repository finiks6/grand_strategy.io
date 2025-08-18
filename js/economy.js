import { Factions } from './world.js';
import { Biome } from './biomes.js';

const rates = {
  fishery: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3],
  stoneMount: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3],
  stoneOther: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5],
  lumberForest: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3],
  lumberOther: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5],
  farmPlain: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3],
  farmOther: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5],
  workshop: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3],
  market: [1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3],
};

export function economyTick(WORLD, idx) {
  const fData = Factions.map(() => ({
    prod: { gold: 0, food: 0, wood: 0, stone: 0, goods: 0 },
    cons: { food: 0, goods: 0 },
    tiles: [],
    pop: 0,
  }));
  const baseGrowth = new Array(WORLD.w * WORLD.h).fill(0);

  for (let y = 0; y < WORLD.h; y++) {
    for (let x = 0; x < WORLD.w; x++) {
      const k = idx(x, y);
      const fid = WORLD.owner[k];
      if (fid === -1) continue;
      fData[fid].tiles.push(k);
      const pop = WORLD.pop[k] || 0;
      fData[fid].pop += pop;

      let avail = pop;
      const biome = WORLD.data[k];
      const B = WORLD.build;

      function employ(level, arr, key) {
        if (!level) return 0;
        const workers = Math.min(10, avail);
        avail -= workers;
        fData[fid].prod[key] += workers * (arr[level - 1] || 0);
        return workers;
      }

      if (B.fishery[k] && (biome === Biome.LAKE || biome === Biome.RIVER)) {
        employ(B.fishery[k], rates.fishery, 'food');
      }
      if (B.stoneMine[k]) {
        if (biome === Biome.MOUNTAIN)
          employ(B.stoneMine[k], rates.stoneMount, 'stone');
        else if (biome === Biome.GRASS || biome === Biome.FOREST)
          employ(B.stoneMine[k], rates.stoneOther, 'stone');
      }
      if (B.lumberCamp[k]) {
        if (biome === Biome.FOREST)
          employ(B.lumberCamp[k], rates.lumberForest, 'wood');
        else if (biome === Biome.GRASS || biome === Biome.MOUNTAIN)
          employ(B.lumberCamp[k], rates.lumberOther, 'wood');
      }
      if (B.farm[k]) {
        if (biome === Biome.GRASS)
          employ(B.farm[k], rates.farmPlain, 'food');
        else if (biome === Biome.FOREST || biome === Biome.MOUNTAIN)
          employ(B.farm[k], rates.farmOther, 'food');
      }
      if (B.workshop[k] && WORLD.settle[k]) {
        employ(B.workshop[k], rates.workshop, 'goods');
      }
      const marketBuilt = B.market[k] > 0;
      if (marketBuilt) {
        employ(B.market[k], rates.market, 'gold');
      }

      const unemployed = avail;
      fData[fid].prod.food += unemployed * 0.05;
      fData[fid].prod.goods += unemployed * 0.05;
      fData[fid].prod.wood += unemployed * 0.05;
      fData[fid].prod.stone += unemployed * 0.05;

      if (marketBuilt) {
        fData[fid].cons.food += pop * 0.1;
        fData[fid].cons.goods += pop * 0.1;
        let tax = 0.1;
        switch (WORLD.settle[k]) {
          case 'village':
            tax = 0.2;
            break;
          case 'town':
            tax = 0.3;
            break;
          case 'city':
            tax = 0.4;
            break;
        }
        fData[fid].prod.gold += pop * tax;
      }

      let t = WORLD.settle[k]
        ? WORLD.settle[k]
        : biome === Biome.GRASS
        ? 'plain'
        : biome === Biome.FOREST
        ? 'forest'
        : biome === Biome.MOUNTAIN
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
      baseGrowth[k] = rate;
    }
  }

  for (let f = 0; f < Factions.length; f++) {
    const F = Factions[f];
    const data = fData[f];
    F.res.gold += Math.floor(data.prod.gold);
    F.res.food += Math.floor(data.prod.food);
    F.res.wood += Math.floor(data.prod.wood);
    F.res.stone += Math.floor(data.prod.stone);
    F.res.goods += Math.floor(data.prod.goods);

    F.res.food -= Math.floor(data.cons.food);
    F.res.goods -= Math.floor(data.cons.goods);

    const shortageFood = F.res.food < 0;
    const shortageGoods = F.res.goods < 0;
    if (F.res.food < 0) F.res.food = 0;
    if (F.res.goods < 0) F.res.goods = 0;

    let newPop = 0;
    for (const k of data.tiles) {
      let pop = WORLD.pop[k];
      let rate = baseGrowth[k];
      if (shortageFood || shortageGoods) rate = -0.005;
      pop = Math.max(0, Math.floor(pop * (1 + rate)));
      WORLD.pop[k] = pop;
      newPop += pop;
    }
    F.pop = newPop;
    F.score =
      F.pop +
      F.res.gold +
      F.res.food +
      F.res.goods +
      F.res.wood +
      F.res.stone;
  }
}

