import { Factions } from './world.js';

// Active wars: [{a: factionId, b: factionId}]
export const Wars = [];

export function declareWar(a, b) {
  if (a === b) return;
  for (let i = 0; i < Wars.length; i++) {
    const w = Wars[i];
    if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return;
  }
  Wars.push({ a, b });
}

// Handle recruitment and simple battle resolution
export function warTick() {
  // Recruit armies
  for (let i = 0; i < Factions.length; i++) {
    const F = Factions[i];
    if (F.res.gold >= 5 && F.pop > 10) {
      const recruits = Math.min(
        Math.floor(F.res.gold / 5),
        Math.floor(F.pop / 10),
      );
      if (recruits > 0) {
        F.res.gold -= recruits * 5;
        F.pop -= recruits * 10;
        F.army = (F.army || 0) + recruits;
      }
    }
  }

  // Resolve battles
  for (let i = Wars.length - 1; i >= 0; i--) {
    const w = Wars[i];
    const A = Factions[w.a];
    const B = Factions[w.b];
    if (!A || !B) {
      Wars.splice(i, 1);
      continue;
    }
    if ((A.army || 0) <= 0 || (B.army || 0) <= 0) {
      Wars.splice(i, 1);
      continue;
    }
    const aLoss = Math.max(1, Math.floor((B.army || 0) * 0.1));
    const bLoss = Math.max(1, Math.floor((A.army || 0) * 0.1));
    A.army -= Math.min(A.army, aLoss);
    B.army -= Math.min(B.army, bLoss);
    A.pop = Math.max(0, A.pop - aLoss);
    B.pop = Math.max(0, B.pop - bLoss);
    if (A.army <= 0 || B.army <= 0) {
      Wars.splice(i, 1);
    }
  }
}
