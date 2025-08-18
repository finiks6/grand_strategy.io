import { Factions } from './world.js';

// Active wars: [{ a: factionId, b: factionId, history: [], aScore: 0, bScore: 0, startTick }]
export const Wars = [];
let tick = 0;

const BATTLE_EVENTS = [
  { name: 'Skirmish', aMod: 1, bMod: 1 },
  { name: 'Ambush', aMod: 1.5, bMod: 0.7 },
  { name: 'Ambush', aMod: 0.7, bMod: 1.5 },
  { name: 'Charge', aMod: 1.2, bMod: 1.2 },
  { name: 'Siege', aMod: 0.6, bMod: 0.6 },
];

export function declareWar(a, b) {
  if (a === b) return;
  for (let i = 0; i < Wars.length; i++) {
    const w = Wars[i];
    if ((w.a === a && w.b === b) || (w.a === b && w.b === a)) return;
  }
  Wars.push({ a, b, history: [], aScore: 0, bScore: 0, startTick: tick });
}

// Handle recruitment and detailed battle resolution
export function warTick() {
  tick++;
  const events = [];

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
    if (!Wars.some((w) => w.a === i || w.b === i)) {
      F.morale = Math.min(100, (F.morale || 0) + 1);
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
    if (
      (A.army || 0) <= 0 ||
      (B.army || 0) <= 0 ||
      (A.morale || 0) <= 25 ||
      (B.morale || 0) <= 25
    ) {
      Wars.splice(i, 1);
      continue;
    }
    const ev = BATTLE_EVENTS[(Math.random() * BATTLE_EVENTS.length) | 0];
    const aStr =
      (A.army || 0) * (A.morale / 100) * ev.aMod * (0.8 + Math.random() * 0.4);
    const bStr =
      (B.army || 0) * (B.morale / 100) * ev.bMod * (0.8 + Math.random() * 0.4);
    const totalStr = aStr + bStr;
    const aLoss = Math.max(
      1,
      Math.floor((bStr / totalStr) * (A.army || 0) * 0.5),
    );
    const bLoss = Math.max(
      1,
      Math.floor((aStr / totalStr) * (B.army || 0) * 0.5),
    );
    A.army -= Math.min(A.army, aLoss);
    B.army -= Math.min(B.army, bLoss);
    A.pop = Math.max(0, A.pop - aLoss);
    B.pop = Math.max(0, B.pop - bLoss);
    A.morale = Math.max(0, (A.morale || 0) - Math.floor(5 + bLoss * 0.1));
    B.morale = Math.max(0, (B.morale || 0) - Math.floor(5 + aLoss * 0.1));
    w.aScore += bLoss;
    w.bScore += aLoss;
    const event = { tick, event: ev.name, aLoss, bLoss };
    w.history.push(event);
    events.push({ a: w.a, b: w.b, ...event });
    if (
      A.army <= 0 ||
      B.army <= 0 ||
      A.morale <= 25 ||
      B.morale <= 25
    ) {
      Wars.splice(i, 1);
    }
  }
  return events;
}

export function getWarReport(fid) {
  const reports = [];
  for (let i = 0; i < Wars.length; i++) {
    const w = Wars[i];
    if (w.a === fid || w.b === fid) {
      const enemy = w.a === fid ? Factions[w.b] : Factions[w.a];
      const ourScore = w.a === fid ? w.aScore : w.bScore;
      const theirScore = w.a === fid ? w.bScore : w.aScore;
      const last = w.history[w.history.length - 1] || null;
      reports.push({ enemy: enemy.name, ourScore, theirScore, last });
    }
  }
  return reports;
}

