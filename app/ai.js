/* The boss AI, ported from the battle AI of the engine Radical Red is built on: Complete Fire Red Upgrade
 * (CFRU, src/Battle_AI). How the engine decides:
 *   - Every usable move starts at 100 points. Moves that would fail or backfire lose points (AIScript_Negatives,
 *     mostly -10, -20 for moves the target absorbs). Good moves gain points (AIScript_Positives): +9 for an attack
 *     that knocks out before the target can move, +8 or so for a slower knockout, +2 for the strongest attack,
 *     and status, setup, healing, hazard and pivot moves gain points depending on the Pokemon's "fighting style",
 *     which the engine works out from its moveset and item (sweeper, set-up sweeper, staller, hazard setter, ...).
 *   - The highest score is used; ties are broken at random. Bosses run both scripts (AI flags 7).
 *   - The AI judges damage at the 93% roll, and assumes a critical hit only for moves that always crit.
 *   - Before choosing a move it checks whether to switch out (ShouldSwitch), and after a knockout it picks
 *     the replacement that scores best on speed, knockouts, revenge kills and resistances
 *     (CalcMostSuitableMonToSwitchInto).
 * Point values and thresholds are the engine's own. Doubles, Z-moves, Dynamax and the rarest move effects are
 * left out, and Radical Red may have private changes the public engine source doesn't show. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createAI = factory;
})(typeof self !== 'undefined' ? self : this, function createAI(H) {
  'use strict';
  const { E, meta, usable, act, other, bench, alive, speed, priorityOf, canStatus, hitChance, specNow, fieldOpts, itemName, hasType, grounded, hazardDamage, actives } = H;
  const canSwitch = H.canSwitch || (() => true);   // locked in, bound, trapped or kept in by an ability: no switching
  // doubles: bonus for the best attack by its knockout points (gDoublesDamageViabilityMapping), per doubles fighting style
  const DMAP = {
    dAllOut: [0, 9, 9, 9, 9, 10, 11, 11, 13, 14, 16, 17, 19], dSetup: [0, 4, 4, 4, 4, 9, 11, 11, 12, 13, 15, 16, 19],
    dTRattack: [0, 3, 3, 3, 3, 9, 10, 10, 11, 14, 15, 16, 18], dTRsetup: [0, 1, 1, 1, 1, 1, 2, 2, 3, 4, 5, 6, 18],
    dUtility: [0, 1, 1, 1, 1, 1, 1, 1, 2, 3, 8, 9, 18], dPhaze: [0, 4, 4, 4, 4, 4, 4, 4, 5, 6, 7, 8, 18],
    dSupport: [0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 7, 9, 16], dTotalSupport: [0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 7, 9, 16] };
  /** The engine's fighting style in doubles (PredictFightingStyle, doubles branch). */
  function fightingStyleDoubles(st, m) {
    let tr = false, phaze = false, redirect = false, support = false, pivot = false, protect = false, fakeOut = false, boosts = 0, attacks = 0;
    for (const id of m.moves) {
      const mm = meta(id), e = mm.eff, n = mm.name;
      if (n === 'Trick Room') tr = true;
      else if ([10, 12, 13, 15, 50, 52, 53, 55, 212, 211, 208, 199, 198].includes(e)) boosts++;
      else if (e === 28 || e === 25 || e === 222) phaze = true;
      else if (e === 172) redirect = true;
      else if ([65, 35, 102, 124, 46].includes(e) || (e === 239 && n !== 'Magnet Rise')) support = true;
      else if (e === 127 && n !== 'Baton Pass') pivot = true;
      else if (n === 'Fake Out') fakeOut = true;
      else if (e === 111 && !['Quick Guard', 'Wide Guard', 'Crafty Shield', 'Mat Block', 'Endure'].includes(n)) protect = true;
      if (mm.cat !== 'X' && n !== 'Nuzzle' && n !== 'Fake Out') attacks++;
    }
    const slowItem = ['Room Service', 'Iron Ball', 'Macho Brace'].includes(itemName(m));
    if (tr) return attacks <= 1 ? 'dTRsetup' : 'dTRattack';
    if (redirect || (m.ability === 'Intimidate' && fakeOut) || (fakeOut && pivot)) return 'dUtility';
    if (phaze) return attacks === 3 || (attacks === 2 && protect) ? 'dSetup' : 'dPhaze';
    if (attacks >= 4 || (attacks === 3 && protect)) return slowItem ? 'dTRattack' : 'dAllOut';
    if (attacks + boosts >= 3 || (attacks + boosts === 2 && protect)) return slowItem ? 'dTRattack' : 'dSetup';
    if (support) return attacks <= 1 ? 'dTotalSupport' : 'dSupport';
    return 'dUtility';
  }

  const BOOST_EFFECTS = new Set([10, 11, 12, 13, 14, 15, 16, 50, 51, 52, 53, 54, 55, 56, 198, 199, 200, 206, 208, 211, 212]);
  const HEAL_EFFECTS = new Set([32, 132, 162]);
  const STATUS_EFFECT = { 1: 'slp', 33: 'tox', 66: 'psn', 67: 'par', 167: 'brn' };
  const MOXIE = new Set(['Moxie', 'Beast Boost', 'Chilling Neigh', 'Grim Neigh', 'As One']);
  const TRAPPERS = new Set(['Shadow Tag', 'Arena Trap', 'Magnet Pull']);
  const ABSORBS = { 'Volt Absorb': 'Electric', 'Motor Drive': 'Electric', 'Lightning Rod': 'Electric', 'Water Absorb': 'Water', 'Dry Skin': 'Water',
    'Storm Drain': 'Water', 'Flash Fire': 'Fire', 'Well-Baked Body': 'Fire', 'Sap Sipper': 'Grass', 'Earth Eater': 'Ground', Levitate: 'Ground' };
  const MOLD = new Set(['Mold Breaker', 'Teravolt', 'Turboblaze']);
  const CURES = { slp: ['Chesto Berry', 'Lum Berry'], par: ['Cheri Berry', 'Lum Berry'], brn: ['Rawst Berry', 'Lum Berry'], psn: ['Pecha Berry', 'Lum Berry'], tox: ['Pecha Berry', 'Lum Berry'] };
  const STAT_OF = { atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };
  // switching scores (include/new/ai_switching.h)
  const SW = { KO: 31, RESIST_ALL: 17, REVENGE: 8, WALLS: 2, TWO_HKO: 2, OUTSPEEDS: 14, WEAK: 1, FAINTS: 39, FAINTS_OUTSPEEDS: 15 };
  SW.MAX = SW.KO + SW.RESIST_ALL + SW.REVENGE + SW.OUTSPEEDS;
  SW.HAZARDS = SW.MAX + 1;
  const F = { KO: 1, RESIST_ALL: 2, REVENGE: 4, WALLS: 8, TWO_HKO: 16, HAZARDS: 32, OUTSPEEDS: 64, FAINTS: 128 };

  const coin = (rng, p) => (rng.expected ? p > 0.5 : rng() < p);

  /** The engine's fighting style for a Pokemon in singles (PredictFightingStyle). */
  function fightingStyle(st, m) {
    let cls = null, attack = 0, hazards = 0, screens = 0, status = 0, boosting = false, healing = false, veil = false, phazing = false, seed = false, protect = false;
    const foeHz = st[other(m.side)].hazards;
    const it = itemName(m);
    const choiceLike = /^Choice /.test(it || '') || it === 'Assault Vest' || m.ability === 'Gorilla Tactics' || m.ability === 'Sage Power';
    for (const id of m.moves) {
      const mm = meta(id), e = mm.eff, n = mm.name;
      if (n === 'Baton Pass' && alive(st, m.side).length > 1) cls = 'baton';
      else if (e === 28) phazing = true;
      else if (e === 25 || e === 222) cls = 'phaze';
      else if (e === 179 || e === 102) cls = 'cleric';
      else if (e === 65 && n === 'Aurora Veil') { if (!st[m.side].screens.veil) veil = true; }
      else if (e === 65 || e === 35) screens++;
      else if (e === 84) seed = true;
      else if (e === 111) protect = true;
      else if (e === 42 || e === 106) cls = 'stall';
      else if (choiceLike) cls = 'kill';
      else if (HEAL_EFFECTS.has(e)) healing = true;
      if (cls) break;
      if (mm.cat !== 'X') attack++;
      if (BOOST_EFFECTS.has(e)) boosting = true;
      else if (e === 112) {
        if ((n === 'Stealth Rock' && !foeHz.sr) || (n === 'Toxic Spikes' && foeHz.tspikes < 2) || (n === 'Sticky Web' && !foeHz.web) || (n === 'Spikes' && foeHz.spikes < 3)) hazards++;
      } else if (mm.cat === 'X') status++;
    }
    void healing;
    if (cls) return cls;
    if (screens >= 2 || veil) return attack >= 2 ? 'setupScreens' : 'screens';
    if (hazards >= 1) return phazing ? 'phaze' : 'hazards';
    if (attack >= 3) return boosting ? 'setup' : (status > 0 || phazing) ? 'status' : 'kill';
    if (seed && protect) return 'stall';
    if (attack >= 2 && (boosting || status > 0 || phazing)) return boosting ? 'setup' : 'status';
    return 'stall';
  }
  const isDamager = c => c === 'kill' || c === 'setup' || c === 'status';
  const isScreener = c => c === 'screens' || c === 'setupScreens';

  /** End-of-turn damage a Pokemon takes (poison, burn, Leech Seed, sandstorm), net of Leftovers. */
  function residual(st, m) {
    if (!m || m.ability === 'Magic Guard') return 0;
    let d = 0;
    if (m.ability !== 'Poison Heal') {
      if (m.status === 'psn') d += m.maxHp / 8;
      if (m.status === 'tox') d += m.maxHp * Math.min(15, (m.toxic || 0) + 1) / 16;
    }
    if (m.status === 'brn') d += m.maxHp / 16;
    if (m.seeded) d += m.maxHp / 8;
    if (st.weather === 'Sand' && !['Rock', 'Ground', 'Steel'].some(t => hasType(m, t)) && !['Sand Veil', 'Sand Rush', 'Sand Force', 'Overcoat'].includes(m.ability) && itemName(m) !== 'Safety Goggles') d += m.maxHp / 16;
    if (itemName(m) === 'Leftovers') d -= m.maxHp / 16;
    return Math.floor(d);
  }
  const willFaintResidual = (st, m) => { const r = residual(st, m); return r > 0 && m.hp <= r; };
  const takingResidual = (st, m) => residual(st, m) > 0;

  /** Per-decision context: AI damage numbers (93% roll), predictions and knockout checks, computed once. */
  function context(st, side, rng, meIn, foeIn, opt) {
    const me = meIn || act(st, side);
    const foe = foeIn || (act(st, other(side)) && !act(st, other(side)).fainted ? act(st, other(side)) : (actives(st, other(side))[0] || act(st, other(side))));
    // doubles logic runs while it isn't one-on-one ("Doubles is now defined as being a non 1v1 Double Battle")
    const doubles = st.size > 1 && (actives(st, side).length > 1 || actives(st, other(side)).length > 1);
    // damage numbers, shared with the context the prediction runs in (same battle state, same numbers both ways)
    const cache = (opt && opt.cache) || new Map();
    const zero = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    const specs = (opt && opt.specs) || new Map();
    const specOf = m => {
      let sp = specs.get(m);
      if (!sp) { sp = Object.freeze(m === act(st, m.side) ? specNow(m) : Object.assign(specNow(m), { boosts: zero })); specs.set(m, sp); }
      return sp;
    };
    let zSet = null;   // moves the AI would turn into Z-Moves this turn
    function dmg(from, to, id) {
      const z = !!(zSet && from === me && zSet.has(id));
      const k = from.key + '>' + to.key + ':' + id + (z ? 'Z' : '');
      let v = cache.get(k);
      if (v != null) return v;
      const mm = meta(id);
      v = 0;
      if (mm.cat !== 'X' && to && !to.fainted) {
        const hits = z ? 0 : mm.multihit ? (from.ability === 'Skill Link' ? mm.multihit[1] : 3) : 0;
        const rr = E.rawRolls(specOf(from), specOf(to), id, Object.assign({ hits, crit: mm.alwaysCrit && !z, z }, fieldOpts(st, to.side)));
        if (rr && rr.rolls && rr.rolls.length && rr.eff !== 0) v = rr.rolls[Math.min(8, rr.rolls.length - 1)];
      }
      cache.set(k, v);
      return v;
    }
    // MoveKnocksOutXHits: Sturdy and Focus Sash hold at full HP, Disguise takes the first hit, a Substitute takes it instead
    function kos(from, to, id, n) {
      const d = dmg(from, to, id);
      if (!d) return false;
      const mm = meta(id);
      const mold = MOLD.has(from.ability);
      let hp = to.hp;
      if (n === 1) {
        if (to.hp === to.maxHp && !mm.multihit && ((to.ability === 'Sturdy' && !mold) || itemName(to) === 'Focus Sash')) return false;
        if (to.disguise && !mold) return false;
        if (to.sub && !mm.sound && from.ability !== 'Infiltrator') return false;
      }
      if (to.disguise && !mold) hp += 0;
      return d * n >= hp;
    }
    const moves = m => (m === me || m === foe ? usable(m, st) : m.moves);
    const attacks = m => moves(m).filter(id => meta(id).cat !== 'X');
    const canKO = (from, to) => attacks(from).some(id => kos(from, to, id, 1));
    const can2HKO = (from, to) => attacks(from).some(id => kos(from, to, id, 2));
    const acc = (from, to, id) => {
      if (zSet && from === me && zSet.has(id)) return 100;   // Z-Moves never miss
      return Math.round(100 * hitChance(st, from, to, meta(id)));
    };
    /** The engine's strongest move (CalcStrongestMove): most damage, capped at the target's HP; ties go to priority, then accuracy. */
    function strongest(from, to, ignore) {
      let best = null, bd = -1, bp = -99, ba = -1;
      for (const id of attacks(from)) {
        if (id === ignore) continue;
        const mm = meta(id);
        if (mm.eff === 38) continue;   // one-hit KO moves only if they surely hit
        const d = Math.min(dmg(from, to, id), to.hp);
        const p = priorityOf(st, from, id), a = acc(from, to, id);
        if (d > bd || (d === bd && d > 0 && (p > bp || (p === bp && a > ba) || (p === bp && a === ba && best && meta(best).recoil && !mm.recoil)))) {
          best = id; bd = d; bp = p; ba = a;
        }
      }
      return best;
    }
    const foeStrongest = strongest(foe, me);
    // the move the AI expects the player to use (PredictMovesForBanks): the AI's own scoring run on the player's moves,
    // the best one; none at all while the player can't act, and a switch when none of them reaches 100
    const pred = opt && opt.noPredict ? { move: null, sw: false } : predictMove(st, foe, me, rng, cache, specs);
    const predicted = pred.move;
    // CalcShouldAIUseZMove: a Z-Move unless the plain move already knocks out (and more foes remain), never into a
    // Substitute, a Disguise or a predicted Protect; moves with a charge or recharge turn always become Z-Moves
    for (const id of usable(me, st)) {
      const zk = H.zKind(st, me, id);
      if (!zk) continue;
      if (zk === 'evoboost') { (zSet = zSet || new Set()).add(id); continue; }
      const mm = meta(id);
      if ((foe.sub && !mm.sound) || foe.disguise || (predicted && meta(predicted).eff === 111)) continue;
      const always = [80, 155, 75, 145, 151, 246].includes(mm.eff);
      const plainKOs = kos(me, foe, id, 1) && acc(me, foe, id) >= 90 && alive(st, foe.side).length >= 2 && !mm.recoil && mm.eff !== 204 && !(H.SELF_DROP[mm.name]);
      if (always || !plainKOs) (zSet = zSet || new Set()).add(id);
    }
    const myStrongest = strongest(me, foe);
    const firstVs = (a, b, aMove, bMove) => {
      const pa = aMove ? priorityOf(st, a, aMove) : 0, pb = bMove ? priorityOf(st, b, bMove) : 0;
      if (pa !== pb) return pa > pb;
      const sa = speed(st, a), sb = speed(st, b);
      return st.trickRoom ? sa < sb : sa > sb;
    };
    const hitsFirst = id => firstVs(me, foe, id, predicted);
    const c = {
      st, side, rng, me, foe, dmg, kos, canKO, zSet, can2HKO, acc, strongest, myStrongest, foeStrongest, predicted, firstVs, hitsFirst, moves, attacks,
      cls: doubles ? fightingStyleDoubles(st, me) : fightingStyle(st, me), doubles,
      meSpe: speed(st, me), foeSpe: speed(st, foe),
      predSwitch: pred.sw,
      foeKOsMe: !!predicted && meta(predicted).cat !== 'X' && kos(foe, me, predicted, 1),
      foeCanKOMe: canKO(foe, me), foeCan2HKOMe: can2HKO(foe, me),
      iCanKO: canKO(me, foe), iCan2HKO: can2HKO(me, foe),
    };
    return c;
  }

  /** PredictMovesForBanks for one Pokemon against one foe: nothing while it recharges, loafs (Truant) or sleeps without
   *  Sleep Talk or Snore; its locked move while locked in; else the AI's own scripts run on its moves (with no guess
   *  about the other side's move yet): the best one, ties at random, or a switch when none reaches 100. */
  function predictMove(st, m, vs, rng, cache, specs) {
    const none = { move: null, sw: false };
    if (!m || m.fainted || !vs || vs.fainted) return none;
    if (m.recharge || (m.ability === 'Truant' && m.truantLoaf)) return none;
    if (m.status === 'slp' && !m.moves.some(id => ['Sleep Talk', 'Snore'].includes(meta(id).name))) return none;
    const locked = m.charging || (m.rampage && m.lock);
    if (locked && m.moves.includes(locked)) return { move: locked, sw: false };
    const scores = scoreMoves(context(st, m.side, rng, m, vs, { noPredict: true, cache, specs }), false);
    if (!scores.length) return none;
    const top = Math.max(...scores.map(x => x.score));
    if (top < 100) return { move: null, sw: true };
    const best = scores.filter(x => x.score === top);
    return { move: (best.length === 1 || rng.expected ? best[0] : best[Math.floor(rng() * best.length)]).id, sw: false };
  }

  const WISH_ID = 'wish';
  /** A Wish waiting to come true in this Pokemon's spot, a future attack coming down on it. */
  const wishPending = (st, m) => !!(st[m.side].wish && st[m.side].wish[m.slot]);
  const futurePending = (st, m) => !!(st[m.side].future && st[m.side].future[m.slot]);
  /** ShouldUseWishAromatherapy (singles): only a cleric bothers, and only with someone under 65% HP (Wish) or statused
   *  (Heal Bell); never as the last Pokemon when it would fall before the wish comes true, nor against a last foe it can
   *  knock out. */
  function wishWorthIt(c, kind) {
    const { st, me, foe } = c;
    if (kind === WISH_ID && alive(st, me.side).length <= 1) {
      if ((c.foeCan2HKOMe && !me.moves.some(id => meta(id).eff === 111)) || willFaintSecondary(st, me)) return false;
    }
    if (c.iCanKO && alive(st, foe.side).length <= 1) return false;
    if (c.doubles || c.cls !== 'cleric') return false;
    const team = st[me.side].team.filter(m => !m.fainted);
    return kind === WISH_ID ? team.some(m => m.hp * 100 / m.maxHp < 65) : team.some(m => m.status);
  }
  /** TeamFullyHealedMinusBank: every teammate still standing is at full HP. */
  const teamFull = (st, me) => st[me.side].team.every(m => m === me || m.fainted || m.hp >= m.maxHp);

  // ---------------- move scoring ----------------
  function badIdeaToStatus(c, s) {
    const { st, me, foe } = c;
    if (!canStatus(st, foe, s, '', me)) return true;
    if ((CURES[s] || []).includes(itemName(foe))) return true;
    const a = foe.ability;
    if (s === 'slp') return foe.moves.some(id => ['Sleep Talk', 'Snore'].includes(meta(id).name)) || ['Early Bird', 'Shed Skin'].includes(a) || (a === 'Natural Cure' && bench(st, foe.side).length > 0);
    if (s === 'par') return ['Quick Feet', 'Guts', 'Marvel Scale', 'Synchronize'].includes(a);
    if (s === 'brn') return ['Guts', 'Flare Boost', 'Magic Guard', 'Quick Feet', 'Heatproof'].includes(a);
    if (s === 'psn' || s === 'tox') return ['Poison Heal', 'Guts', 'Toxic Boost', 'Magic Guard', 'Quick Feet', 'Marvel Scale'].includes(a);
    return false;
  }
  // IncreaseStatusViability: how much a "status move" bonus is worth for each fighting style
  function statusBonus(c, boost) {
    switch (c.cls) {
      case 'kill': return 0;
      case 'setup': return c.foeCan2HKOMe ? 0 : 3;
      case 'status': return 4 + boost;
      case 'stall': return 3 + boost;
      case 'baton': return boost >= 3 ? 1 : 0;
      case 'cleric': return 3 + boost;
      case 'screens': case 'setupScreens': return 2 + boost;
      case 'phaze': return 4 + boost;
      case 'hazards': return 3;
      case 'dAllOut': return 0;
      case 'dSetup': case 'dTRattack': return 4 + boost;
      case 'dTRsetup': return 7 + boost;
      case 'dUtility': return 3 + boost;
      case 'dPhaze': return 8 + boost;
      case 'dSupport': case 'dTotalSupport': return 2 + boost;
      default: return 0;
    }
  }
  // ShouldTryToSetUpStat (singles)
  function shouldSetUp(c, id, stat, limit) {
    const { st, me, foe } = c;
    if (foe.ability === 'Unaware' && !me.moves.some(x => ['Stored Power', 'Power Trip'].includes(meta(x).name)) && !(stat === 'def' && me.moves.some(x => meta(x).name === 'Body Press'))) return false;
    if (willFaintResidual(st, me)) return false;
    if (stat === 'all') return true;
    if (c.hitsFirst(id)) {
      if (c.foeCanKOMe || (c.foeStrongest && c.dmg(foe, me, c.foeStrongest) + residual(st, me) >= me.hp)) return false;
      if (foe.invuln) return true;
    } else {
      if (foe.charging && meta(foe.charging).eff === 155) return true;
      if (stat === 'spe' && me.boosts.spe < limit && !c.foeKOsMe && speed(st, Object.assign({}, me, { boosts: Object.assign({}, me.boosts, { spe: me.boosts.spe + 1 }) })) > c.foeSpe) return true;
      if (c.foeCan2HKOMe) {
        if (!c.foeCanKOMe && c.foeStrongest) {
          const k = meta(c.foeStrongest).cat;
          if ((stat === 'def' && k === 'P') || (stat === 'spd' && k === 'S')) return true;
        }
        return false;
      }
    }
    if ((me.boosts[stat] || 0) >= limit) return false;
    if ((stat === 'atk' || stat === 'spa') && foe.hp === foe.maxHp && (foe.ability === 'Sturdy' || itemName(foe) === 'Focus Sash')
        && !me.moves.some(x => meta(x).multihit && meta(x).cat === (stat === 'atk' ? 'P' : 'S')) && !foe.status) return false;
    return true;
  }
  // IncreaseStatViability
  function statBonus(c, id, stat, limit, boost) {
    const ok = () => shouldSetUp(c, id, stat, limit);
    switch (c.cls) {
      case 'kill': return ok() ? 3 + boost : (meta(id).cat !== 'X' && (stat === 'atk' || stat === 'spa') ? 1 : 0);
      case 'setup': return ok() ? 3 + boost : 0;
      case 'baton': return shouldSetUp(c, id, stat, 4) ? (['atk', 'spa', 'spe'].includes(stat) ? 5 : 4) : 0;
      default: return ok() ? statusBonus(c, 1) : 0;
    }
  }
  /** GoodIdeaToRaiseAttackAgainst: the foe doesn't ignore boosts (Unaware), it isn't maxed out, and it has a real attack of that kind. */
  function goodToRaise(c, cat) {
    const { me, foe } = c, stat = cat === 'P' ? 'atk' : 'spa';
    if (foe.ability === 'Unaware' && !MOLD.has(me.ability)) return false;
    if ((me.boosts[stat] || 0) >= 6) return false;
    return me.moves.some(x => { const m = meta(x); return m.cat === cat && (m.power || 0) > 1; });
  }
  /** Which stat a boosting move is mainly for, the stage limit and the bonus (AIScript_Positives' stat cases). */
  function boostPlan(c, id) {
    const { me } = c;
    const mm = meta(id), e = mm.eff;
    const b = H.SETUP[mm.name] || H.EFFECT_BOOST[e] || {};
    const phys = me.moves.some(x => meta(x).cat === 'P'), spec = me.moves.some(x => meta(x).cat === 'S');
    const foePhys = c.foe.moves.some(x => meta(x).cat === 'P'), foeSpec = c.foe.moves.some(x => meta(x).cat === 'S');
    const slower = c.meSpe <= c.foeSpe;
    if (b.spe > 0 && (slower || !(b.atk > 0 || b.spa > 0))) return { stat: 'spe', limit: 2, boost: 3, good: slower };
    if (b.atk > 0 && phys) return { stat: 'atk', limit: 2, boost: 2, good: true };
    if (b.spa > 0 && spec) return { stat: 'spa', limit: 2, boost: 2, good: true };
    if (b.def > 0 && (foePhys || me.moves.some(x => meta(x).name === 'Body Press'))) return foePhys ? { stat: 'atk', limit: 4, boost: 2, good: true } : { stat: 'def', limit: 2, boost: 1, good: true };
    if (b.spd > 0 && foeSpec) return { stat: 'spd', limit: 4, boost: 1, good: true };
    if (b.eva > 0) return { stat: 'eva', limit: 6, boost: 4, good: true };
    if (b.acc > 0) return { stat: 'acc', limit: 6, boost: 2, good: true };
    return { good: false };
  }
  // ShouldRecover
  function shouldRecover(c, id, heal) {
    const { st, me, foe } = c;
    const foeD = c.foeStrongest ? c.dmg(foe, me, c.foeStrongest) : 0;
    // IsBankIncapacitated: asleep, recharging or loafing (with FROSTBITE on, frostbite doesn't count)
    const incapacitated = foe.status === 'slp' || foe.recharge || (foe.ability === 'Truant' && foe.truantLoaf);
    if (c.hitsFirst(id)) {
      if (c.foeCanKOMe && !(foeD >= Math.min(me.maxHp, me.hp + heal))) return true;
      if (c.foeCan2HKOMe && !incapacitated && heal > me.hp && coin(c.rng, 0.5)) return true;
    } else if (!c.foeCanKOMe && !incapacitated && c.foeCan2HKOMe && !(foeD >= Math.min(me.maxHp, me.hp - foeD + heal))) return true;
    void st;
    return false;
  }
  function healAmount(c, id) {
    const { st, me } = c, mm = meta(id), w = st.weather || '';
    if (mm.eff === 132) return Math.floor(me.maxHp * (/Sun/.test(w) ? 2 / 3 : w ? 1 / 4 : 1 / 2));
    if (mm.eff === 162) return Math.floor(me.maxHp * [0, 0.25, 0.5, 1][Math.min(3, me.stockpile || 0)]);
    if (mm.eff === 37) return me.maxHp - me.hp;
    return Math.floor(me.maxHp / 2);
  }
  /** AnyUsefulOffseniveStatIsRaised: a raised stat it can use (Attack with a physical move, Defense with Body Press,
   *  Sp. Atk with a special move, any Speed), an active Flash Fire with a Fire move, or Unburden going. */
  function usefulBoost(st, m) {
    const mv = usable(m, st), b = m.boosts;
    return (b.atk > 0 && realPhysical(st, m)) || (b.def > 0 && mv.some(id => meta(id).name === 'Body Press'))
      || (b.spa > 0 && special(st, m)) || b.spe > 0 || (m.flashFire && mv.some(id => meta(id).type === 'Fire' && meta(id).cat !== 'X'))
      || (m.unburden && !m.item);
  }
  /** RealPhysicalMoveInMoveset / SpecialMoveInMoveset: usable attacks of that kind (not Counter, Fake Out, Foul Play,
   *  Body Press; not Mirror Coat). */
  const realPhysical = (st, m) => usable(m, st).some(id => { const x = meta(id); return x.cat === 'P' && x.power > 0 && x.eff !== 89 && !['Fake Out', 'Foul Play', 'Body Press'].includes(x.name); });
  const special = (st, m) => usable(m, st).some(id => { const x = meta(id); return x.cat === 'S' && x.power > 0 && x.eff !== 144; });
  /** The game's check for a damager whose attacking stat has been cut to -3 or lower (OFFENSIVE_STAT_MIN_NUM). With
   *  both kinds of attack the game compares a constant instead of the Attack stage, so only Sp. Atk counts there. */
  function attackStatsBad(st, m) {
    const phys = realPhysical(st, m), spec = special(st, m);
    if (phys && !spec) return m.boosts.atk <= -3;
    if (!phys && spec) return m.boosts.spa <= -3;
    if (phys && spec) return m.boosts.spa <= -3;
    return false;
  }
  /** WillTakeSignificantDamageFromEntryHazards: Stealth Rock and Spikes would take its current HP, or 1/n of its max. */
  const bigEntryDamage = (st, m, n) => { const d = hazardDamage(st, m.side, m); return d > 0 && (d >= m.hp || d >= Math.floor(m.maxHp / n)); };
  /** WillFaintFromSecondaryDamage: its perish count is up, or end-of-turn damage (after its own healing) takes it out. */
  const willFaintSecondary = (st, m) => m.perish === 0 || willFaintResidual(st, m);
  /** IsTrapped (for switching): bound, caught by Mean Look and the like, or kept in by Shadow Tag, Arena Trap or Magnet
   *  Pull; never a Ghost type or a Shed Shell holder. */
  function trapped(st, m) {
    if (hasType(m, 'Ghost') || itemName(m) === 'Shed Shell') return false;
    if (m.bound || m.trappedBy) return true;
    return actives(st, other(m.side)).some(f => (f.ability === 'Shadow Tag' && m.ability !== 'Shadow Tag') || (f.ability === 'Arena Trap' && grounded(m)) || (f.ability === 'Magnet Pull' && hasType(m, 'Steel')));
  }
  /** IsAffectedByFocusSash / IsAffectedBySturdy / IsDamageHalvedDueToFullHP: at full HP behind a Sash, Sturdy, Multiscale
   *  (unless the attacker breaks the mold) or Shadow Shield. */
  const fullHpGuard = (c, id) => {
    const { me, foe } = c;
    if (foe.hp !== foe.maxHp) return false;
    return itemName(foe) === 'Focus Sash' || foe.ability === 'Sturdy' || (foe.ability === 'Multiscale' && !MOLD.has(me.ability)) || foe.ability === 'Shadow Shield';
  };
  /** CanKnockOutWithoutMove (ignoring Future Sight and Doom Desire, which can't knock out now). */
  const koWithout = (c, id) => c.attacks(c.me).some(x => x !== id && meta(x).eff !== 148 && c.kos(c.me, c.foe, x, 1));
  /** ShouldPivot (ai_advanced.c), line by line: 'now' (the switch check chose to pivot), 'pivot', 'try' (no change)
   *  or 'dont'. */
  function shouldPivot(c, id) {
    const { st, me, foe } = c;
    if (c.goodToPivot) return 'now';
    const boosted = (usefulBoost(st, me) && isDamager(c.cls)) || (foe.boosts.eva || 0) >= 4;
    const best = c.bestSw || (c.bestSw = pickSwitch(c.ranked || (c.ranked = switchScores(st, me.side, c)), c.rng));
    const flags = best ? best.flags : 0;
    if (bigEntryDamage(st, me, 4)) return 'dont';
    if (!bench(st, me.side).length) return 'try';
    if (c.predSwitch && !boosted) return 'pivot';   // switch to a better answer to whatever comes in
    const damaging = meta(id).cat !== 'X';
    const guard = fullHpGuard(c, id);
    const hz = st[me.side].hazards, hazardsHere = hz.sr || hz.spikes || hz.tspikes || hz.web;
    if (c.hitsFirst(id)) {
      if (!koWithout(c, id)) {
        if (c.iCanKO) return 'try';   // this is its only knockout move
        if (isDamager(c.cls) && c.iCan2HKO) {
          if (c.foeCanKOMe) return 'pivot';
          if (damaging && ((flags & F.RESIST_ALL && flags & (F.KO | F.HAZARDS)) || guard)) return 'pivot';
        } else if (!boosted) {
          if (isDamager(c.cls) && damaging && guard) return 'pivot';
          if (flags & (F.WALLS | F.RESIST_ALL)) {
            if (hazardsHere && flags & F.HAZARDS) return 'pivot';
            if (willFaintSecondary(st, me)) return 'pivot';
            if (isDamager(c.cls)) return attackStatsBad(st, me) ? 'pivot' : 'try';
          }
        }
      }
    } else if (c.foeCanKOMe) {
      return meta(id).eff === 153 ? 'dont' : 'try';   // Teleport goes last: use something else
    } else if (c.foeCan2HKOMe) {
      if (c.iCanKO) { if (!koWithout(c, id)) return 'try'; }
      else if (isDamager(c.cls) && flags & F.KO && flags & (F.OUTSPEEDS | F.WALLS | F.RESIST_ALL)) return 'pivot';
    } else if (c.iCanKO) {
      if (!koWithout(c, id) && !boosted) return 'try';
    } else if (c.iCan2HKO) {
      if (isDamager(c.cls) && damaging && ((flags & F.KO && flags & (F.OUTSPEEDS | F.WALLS | F.RESIST_ALL)) || (flags & F.RESIST_ALL && flags & F.HAZARDS) || guard)) return 'pivot';
    } else {
      if (isDamager(c.cls) && flags & F.KO && flags & F.OUTSPEEDS) return 'pivot';
      if (!boosted && flags & (F.OUTSPEEDS | F.WALLS | F.RESIST_ALL)) {
        if (hazardsHere && flags & F.HAZARDS) return 'pivot';
        if (willFaintSecondary(st, me)) return 'pivot';
        if (isDamager(c.cls) && attackStatsBad(st, me)) return 'pivot';
        return 'try';
      }
    }
    return 'dont';
  }
  // IncreasePivotViability by fighting style
  const PIVOT_BONUS = { kill: 3, setup: 9, status: 9, stall: 9, baton: 9, cleric: 7, screens: 7, setupScreens: 7, phaze: 4, hazards: 3 };

  /** AIScript_Negatives: moves that would fail, be absorbed or backfire. */
  function negatives(c, id) {
    const { st, me, foe } = c, mm = meta(id), n = mm.name, e = mm.eff;
    const mold = MOLD.has(me.ability);
    if (mm.cat !== 'X') {
      if (e === 148 && futurePending(st, foe)) return -10;   // a future attack is already coming there
      if (e === 168 && !bench(st, me.side).length) return -10;   // Final Gambit, the Memento effect: no one to come in after
      if (!mold && ABSORBS[foe.ability] === mm.type && !(foe.ability === 'Levitate')) return -20;
      if (c.dmg(me, foe, id) === 0 && !(mm.power <= 1)) return -10;   // no effect (type immunity, Levitate, Wonder Guard)
      if (mm.power <= 1 && E.typeEff(mm.type, foe.types) === 0 && me.ability !== 'Scrappy') return -10;   // fixed damage into an immunity
      if (e === 8 && foe.status !== 'slp' && foe.ability !== 'Comatose') return -10;
      // moves that would fail (the engine's own checks: EFFECT_POLTERGEIST, EFFECT_LAST_RESORT, EFFECT_RECYCLE for Belch,
      // EFFECT_DAMAGE_SET_TERRAIN for Steel Roller, EFFECT_BURN_UP, EFFECT_SNORE, EFFECT_SPIT_UP, EFFECT_COUNTER, EFFECT_ENDEAVOR)
      if (n === 'Poltergeist' && !foe.item) return -10;
      if (n === 'Last Resort') { const others = me.moves.filter(x => x !== id), used = me.usedMoves || []; if (!others.length || others.some(x => !used.includes(x))) return -10; }
      if (n === 'Belch' && !me.ateBerry) return -10;
      if (n === 'Steel Roller' && !st.terrain) return -10;
      if ((n === 'Burn Up' && !hasType(me, 'Fire')) || (n === 'Double Shock' && !hasType(me, 'Electric'))) return -10;
      if (n === 'Snore' && me.status !== 'slp' && me.ability !== 'Comatose') return -10;
      if (n === 'Spit Up' && !me.stockpile) return -10;
      if (/^(Counter|Mirror Coat|Metal Burst|Comeuppance)$/.test(n)) {
        if (!c.predicted || meta(c.predicted).cat === 'X') return -10;
        if ((n === 'Metal Burst' || n === 'Comeuppance') && c.hitsFirst(id)) return -10;   // no negative priority: it goes first and fails
      }
      if (e === 189 && me.hp > (me.hp + foe.hp) / 2) return -10;   // Endeavor
      if (e === 237 && (!c.predicted || meta(c.predicted).cat === 'X')) return -10;
      if (e === 170 && c.foeStrongest && !c.hitsFirst(id)) return -10;
      if (e === 7) return -10;   // the explosion check; the positives add some back when it's the right call
      return 0;
    }
    const foeTargeted = (!(BOOST_EFFECTS.has(e) || H.SETUP[n] || HEAL_EFFECTS.has(e) || [37, 111, 112, 35, 65, 136, 137, 115, 164, 228, 239, 98, 153, 124, 79, 142, 160, 127, 179, 114].includes(e))
      && n !== 'Healing Wish' && n !== 'Lunar Dance') || n === 'Parting Shot';
    if (foeTargeted && foe.ability === 'Magic Bounce' && !mold) return -10;
    if (foeTargeted && foe.sub && !mm.sound && me.ability !== 'Infiltrator' && e !== 28) return -10;
    if (STATUS_EFFECT[e]) return canStatus(st, foe, STATUS_EFFECT[e], n, me) ? 0 : -10;
    if (e === 187) return !foe.status && !foe.yawn && canStatus(st, foe, 'slp', n, me) ? 0 : -10;
    if (BOOST_EFFECTS.has(e) || H.SETUP[n]) {
      const b = H.SETUP[n] || H.EFFECT_BOOST[e] || {};
      const ups = Object.entries(b).filter(([, v]) => v > 0).map(([k]) => k);
      if (me.ability === 'Contrary') return -10;
      if (ups.length && ups.every(k => (me.boosts[k] || 0) >= 6)) return -10;
      if (n === 'Stockpile' && (me.stockpile || 0) >= 3) return -10;
      return 0;
    }
    if (H.EFFECT_DROP[e]) {
      const k = Object.keys(H.EFFECT_DROP[e])[0];
      if ((foe.boosts[k] || 0) <= -6 || ['Clear Body', 'White Smoke', 'Full Metal Body', 'Mirror Armor'].includes(foe.ability) || itemName(foe) === 'Clear Amulet') return -10;
      if (['Contrary', 'Defiant', 'Competitive'].includes(foe.ability)) return -10;
      return 0;
    }
    if (e === 179) return wishPending(st, me) ? -10 : 0;   // Wish: one at a time
    if (e === 114) {   // Perish Song (singles): not as the last Pokemon against more than one, not on a foe already singing along
      if (alive(st, me.side).length === 1 && me.ability !== 'Soundproof' && alive(st, foe.side).length >= 2) return -10;
      return foe.perish != null || foe.ability === 'Soundproof' ? -10 : 0;
    }
    if (e === 168) {   // the Memento effect: Healing Wish, Lunar Dance, Memento
      if (!bench(st, me.side).length) return -10;
      if (n === 'Healing Wish' || n === 'Lunar Dance') return teamFull(st, me) ? -10 : 0;
      if (foe.sub && me.ability !== 'Infiltrator') return -10;
      return foe.boosts.atk <= -6 && foe.boosts.spa <= -6 ? -10 : 0;
    }
    if (HEAL_EFFECTS.has(e) || n === 'Strength Sap') return me.hp >= me.maxHp ? -10 : 0;
    if (e === 37) return me.hp >= me.maxHp || ['Insomnia', 'Vital Spirit', 'Comatose', 'Purifying Salt'].includes(me.ability) || (st.terrain === 'Electric' && grounded(me)) ? -10 : 0;
    if (e === 112) {
      const hz = st[foe.side].hazards;
      const done = (n === 'Stealth Rock' && hz.sr) || (n === 'Spikes' && hz.spikes >= 3) || (n === 'Toxic Spikes' && hz.tspikes >= 2) || (n === 'Sticky Web' && hz.web);
      return done || alive(st, foe.side).length <= 1 ? -10 : 0;
    }
    if (e === 35) return st[me.side].screens.light ? -10 : 0;
    if (e === 65) return (n === 'Aurora Veil' ? (st[me.side].screens.veil || !/Snow|Hail/.test(st.weather || '')) : st[me.side].screens.reflect) ? -10 : 0;
    if (e === 111) return me.protectStreak > 0 ? -10 : 0;
    if (e === 84) return hasType(foe, 'Grass') || foe.seeded ? -10 : 0;
    if (e === 228 && n === 'Trick Room') return (st.trickRoom ? c.meSpe < c.foeSpe : c.meSpe > c.foeSpe) ? -10 : 0;
    if (e === 239 && n === 'Tailwind') return st[me.side].tailwind || st.trickRoom > 1 ? -10 : 0;
    if (e === 98) return me.destinyBond ? -10 : 0;
    if (e === 79) return me.sub || me.hp <= me.maxHp / 4 ? -10 : 0;
    if (e === 28) return !bench(st, foe.side).length || foe.ability === 'Suction Cups' ? -10 : 0;
    if (e === 25) return !Object.values(foe.boosts).some(v => v > 0) ? -10 : 0;
    if (e === 175) return foe.taunt ? -10 : 0;
    if (e === 90) return foe.encore || !foe.lastMove ? -10 : 0;
    if (e === 49 || e === 118 || e === 166) return foe.confused || foe.ability === 'Own Tempo' ? -10 : 0;
    if (e === 136) return /Rain/.test(st.weather || '') ? -10 : 0;
    if (e === 137) return /Sun/.test(st.weather || '') ? -10 : 0;
    if (e === 115) return st.weather === 'Sand' ? -10 : 0;
    if (e === 164) return /Snow|Hail/.test(st.weather || '') ? -10 : 0;
    if (e === 153) return !bench(st, me.side).length ? -10 : 0;
    if (e === 142 && n === 'Belly Drum') return me.hp <= me.maxHp / 2 || me.boosts.atk >= 6 ? -10 : 0;
    // the engine's checks for status moves that would do nothing (ai_negatives.c, by effect)
    switch (n) {
      case 'Charge': return me.charged ? -10 : 0;
      case 'Transform': return me.orig || foe.orig || foe.sub ? -10 : 0;
      case 'Pain Split': return me.hp > (me.hp + foe.hp) / 2 ? -10 : 0;
      case 'Heal Bell': case 'Aromatherapy': return st[me.side].team.some(x => !x.fainted && x.status) ? 0 : -10;
      case 'Swallow': return !me.stockpile || me.hp >= me.maxHp ? -10 : 0;
      case 'Trick': case 'Switcheroo': return (!me.item && !foe.item) || me.item === foe.item || foe.ability === 'Sticky Hold' ? -10 : 0;
      case 'Bestow': return !me.item || foe.item ? -10 : 0;
      case 'Assist': return st[me.side].team.some(x => x !== me) ? 0 : -10;
      case 'Ingrain': return me.ingrain ? -10 : 0;
      case 'Aqua Ring': return me.aquaRing ? -10 : 0;
      case 'Recycle': return !me.lastItem || me.item ? -10 : 0;
      case 'Refresh': return /psn|tox|brn|par|frz/.test(me.status || '') ? 0 : -10;   // (frostbite counts: CFRU's FROSTBITE)
      case 'Psycho Shift': return me.status && !foe.status ? 0 : -10;
      case 'Psych Up': return Object.values(foe.boosts).some(v => v > 0) ? 0 : -10;
      case 'Worry Seed': return foe.ability === 'Insomnia' ? -10 : 0;
      case 'Gastro Acid': return !foe.ability ? -10 : 0;
      case 'Electric Terrain': case 'Grassy Terrain': case 'Misty Terrain': case 'Psychic Terrain': return st.terrain === n.split(' ')[0] ? -10 : 0;
      case 'Magic Room': return st.magicRoom ? -10 : 0;
      case 'Wonder Room': return st.wonderRoom ? -10 : 0;
      case 'Gravity': return st.gravity ? -10 : 0;
      case 'Soak': return foe.types.length === 1 && foe.types[0] === 'Water' ? -10 : 0;
      case 'Trick-or-Treat': return hasType(foe, 'Ghost') ? -10 : 0;
      case "Forest's Curse": return hasType(foe, 'Grass') ? -10 : 0;
      case 'Lucky Chant': return st[me.side].luckyChant ? -10 : 0;
      case 'Magnet Rise': return st.gravity || me.magnetRise || me.ingrain || me.grounded || !grounded(me) || itemName(me) === 'Iron Ball' ? -10 : 0;
      case 'Mist': return st[me.side].mist ? -10 : 0;
      case 'Sleep Talk': return me.status !== 'slp' && me.ability !== 'Comatose' ? -10 : 0;
      default: return 0;
    }
  }

  /** AIScript_Positives for one move, given the score so far. Returns the new score and why. */
  function positives(c, id, v, out) {
    const { st, me, foe, cls } = c, mm = meta(id), n = mm.name, e = mm.eff;
    const add = (x, why) => { v += x; if (out && x) out.push(`${x > 0 ? '+' : ''}${x} ${why}`); };
    const ec = mm.ec || 0;
    const blockedBySub = foe.sub && !mm.sound && me.ability !== 'Infiltrator';
    let st0 = STATUS_EFFECT[e];
    if (!st0 && ec >= 75 && !blockedBySub) st0 = { 6: 'par', 4: 'brn', 2: 'psn', 209: 'tox', 5: 'frz' }[e];
    if (e === 1 || e === 187) {
      // IncreaseSleepViability
      let skip = badIdeaToStatus(c, 'slp');
      if (!skip && e === 187) {
        if (c.iCanKO) skip = true;
        else if (alive(st, me.side).length === 1 && !me.moves.some(x => meta(x).eff === 111)) skip = c.hitsFirst(id) ? (c.foeCanKOMe || (c.foeCan2HKOMe && !me.moves.some(x => HEAL_EFFECTS.has(meta(x).eff)))) : c.foeCan2HKOMe;
      }
      if (!skip) {
        const a80 = c.acc(me, foe, id) >= 80;
        const table = { setup: 9, status: 8, baton: 9, cleric: 7, screens: 8, setupScreens: 8, phaze: 9, hazards: 8 };
        if (cls === 'stall') add(statusBonus(c, 3), 'sleep (staller)');
        else if (table[cls]) add(a80 ? table[cls] : statusBonus(c, 3), 'sleep');
      }
    } else if (st0 === 'par') {
      if (!badIdeaToStatus(c, 'par')) {
        const goFirstAfter = c.foeSpe >= c.meSpe && c.foeSpe / 2 < c.meSpe;
        const flinch = me.moves.some(x => meta(x).eff === 31);
        add(statusBonus(c, goFirstAfter || flinch || foe.confused ? 2 : 1), 'paralysis');
      }
    } else if (st0 === 'brn') {
      if (!badIdeaToStatus(c, 'brn')) {
        const predPhysKO = c.predicted && meta(c.predicted).cat === 'P' && c.foeKOsMe;
        add(statusBonus(c, predPhysKO ? 3 : foe.moves.some(x => meta(x).cat === 'P') ? 2 : 1), 'burn');
      }
    } else if (st0 === 'psn' || st0 === 'tox') {
      if (!badIdeaToStatus(c, st0)) add(statusBonus(c, me.moves.some(x => ['Venoshock', 'Barb Barrage'].includes(meta(x).name)) || me.ability === 'Merciless' ? 2 : 1), 'poison');
    } else if (c.zSet && c.zSet.has(id) && n === 'Last Resort') {
      add(statBonus(c, id, 'all', 6, 3), 'Z-Last Resort (Extreme Evoboost)');
    } else if (e === 160 || n === 'Stockpile') {
      if (me.moves.some(x => meta(x).eff === 162 || meta(x).eff === 161)) add(statusBonus(c, 2), 'Stockpile (has Swallow or Spit Up)');
      else if (me.ability !== 'Contrary') {
        const foePhys = foe.moves.some(x => meta(x).cat === 'P');
        // the engine's defense branch checks the Attack stage here (AI_DEFENSE_PLUS); ported as written
        if (foePhys) add(statBonus(c, id, 'atk', 4, 2), 'Stockpile');
        else if (foe.moves.some(x => meta(x).cat === 'S')) add(statBonus(c, id, 'spd', 4, 1), 'Stockpile');
      }
    } else if (mm.cat !== 'X' && (e === 139 || e === 110 || e === 96) && (mm.ec || 100) >= 75) {
      // Attacks that raise the user's stats on hit (Power-Up Punch, Torch Song, Flame Charge): with a 75%+ chance they score
      // like setup moves, AI_ATTACK_PLUS / AI_SPEED_PLUS: INCREASE_STAT_VIABILITY(stat, +2 stages, 2 or 3)
      if (me.ability !== 'Contrary') {
        if (e === 139 && n !== 'Fell Stinger' && goodToRaise(c, 'P')) add(statBonus(c, id, 'atk', 2, 2), 'attack that raises Attack');
        else if (e === 110 && goodToRaise(c, 'S')) add(statBonus(c, id, 'spa', 2, 2), 'attack that raises Sp. Atk');
        else if (e === 96) add(statBonus(c, id, 'spe', 2, 3), 'attack that raises Speed');
      }
    } else if (BOOST_EFFECTS.has(e) || H.SETUP[n]) {
      if (me.ability !== 'Contrary') {
        const p = boostPlan(c, id);
        if (p.good) add(statBonus(c, id, p.stat, p.limit, p.boost), 'set up');
      }
    } else if (e === 142 && n === 'Belly Drum') {
      if (me.moves.some(x => meta(x).cat === 'P')) add(statBonus(c, id, 'atk', 6, 2), 'Belly Drum');
    } else if (e === 179) {
      // Wish: +8 when a cleric's team needs it, else scored like a healing move (AI_RECOVER)
      if (wishWorthIt(c, WISH_ID)) add(8, 'Wish for the team');
      else if (shouldRecover(c, id, healAmount(c, id))) add(cls === 'stall' || cls === 'phaze' ? 8 : statusBonus(c, 3), 'Wish');
    } else if (e === 114) {
      if (trapped(st, foe)) add(statusBonus(c, 3), 'Perish Song on a trapped foe');
    } else if (e === 168 && n === 'Memento') {
      add(-5, 'Memento');
    } else if (HEAL_EFFECTS.has(e) || n === 'Strength Sap' || e === 37) {
      if (shouldRecover(c, id, healAmount(c, id))) add(cls === 'stall' || cls === 'phaze' ? 8 : statusBonus(c, 3), 'heal');
    } else if (e === 3 && mm.cat !== 'X') {
      if (shouldRecover(c, id, Math.floor(c.dmg(me, foe, id) / 2))) add(cls === 'stall' ? statusBonus(c, 2) : 3, 'draining heal');
    } else if (e === 112) {
      const worth = alive(st, foe.side).length !== 2;
      const hz = { 'Sticky Web': 7, 'Stealth Rock': 6, 'Toxic Spikes': 5 };
      if (cls === 'hazards') add(hz[n] || 4, 'hazards');
      else if (cls === 'setup' || cls === 'status') { if (worth) add(statusBonus(c, 2), 'hazards'); }
      else if (cls === 'stall' || cls === 'cleric' || isScreener(cls)) add(statusBonus(c, worth ? 2 : 1), 'hazards');
      else if (cls === 'phaze') add(statusBonus(c, alive(st, foe.side).length === 2 ? 2 : 3), 'hazards');
      else if (cls === 'baton' && c.hitsFirst(id) && !c.foeCanKOMe) add(4, 'hazards');
    } else if (e === 35 || e === 65) {
      const wantPhys = e === 65 && n !== 'Aurora Veil';
      const useful = n === 'Aurora Veil' || c.foe.moves.some(x => meta(x).cat === (wantPhys ? 'P' : 'S'));
      if (useful) add(isScreener(cls) ? (n === 'Aurora Veil' ? 8 : 7) : statusBonus(c, 2), 'screen');
    } else if (e === 127 && ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot'].includes(n)) {
      const p = shouldPivot(c, id);
      if (p === 'now') add(9, 'pivot out (wants to switch)');
      else if (p === 'pivot') add(PIVOT_BONUS[cls] || 3, 'pivot');
      else if (p === 'dont') {
        if (c.myStrongest === id) c.myStrongest = c.strongest(me, foe, id);   // RecalcStrongestMoveIgnoringMove
        add(-9, 'bad time to pivot');
      } else if (wishPending(st, me) && wishWorthIt(c, WISH_ID)) add(7, 'pass on the wish');
    } else if (e === 111) {
      const useful = (takingResidual(st, foe) && !takingResidual(st, me)) || (me.ability === 'Speed Boost' && me.boosts.spe < 6 && c.meSpe <= c.foeSpe)
        || (me.firstTurn && ['Toxic Orb', 'Flame Orb'].includes(itemName(me)) && ['Poison Heal', 'Guts', 'Toxic Boost', 'Flare Boost', 'Magic Guard'].includes(me.ability));
      if (useful) add(statusBonus(c, 3), 'Protect');
    } else if (e === 158 && n === 'Fake Out') {
      if (me.firstTurn && !(foe.ability === 'Inner Focus' || foe.ability === 'Shield Dust') && !blockedBySub) add(cls === 'kill' ? 4 : statusBonus(c, 3) || 4, 'Fake Out');
    } else if (e === 28) {
      if ((Object.values(foe.boosts).some(x => x >= 2)) && bench(st, foe.side).length) add(cls === 'phaze' ? 8 : statusBonus(c, 2), 'phaze');
    } else if (e === 25) {
      if (Object.values(foe.boosts).some(x => x >= 2)) add(cls === 'phaze' ? 15 : 8, 'Haze');
    } else if (e === 84) {
      if (!hasType(foe, 'Grass') && !foe.seeded) add(statusBonus(c, 3), 'Leech Seed');
    } else if (e === 98) {
      if (!c.hitsFirst(id) && c.foeKOsMe) add(statusBonus(c, 3), 'Destiny Bond');
    } else if (e === 175) {
      if (c.predicted && meta(c.predicted).cat === 'X') add(statusBonus(c, 2), 'Taunt');
    } else if (e === 90) {
      if (foe.lastMove && meta(foe.lastMove).cat === 'X') add(statusBonus(c, 3), 'Encore a status move');
    } else if (e === 49 || e === 118 || e === 166) {
      if (!foe.confused && foe.ability !== 'Own Tempo') add(statusBonus(c, e === 49 ? 1 : 1), 'confusion');
    } else if (e === 228 && n === 'Trick Room') {
      if (!st.trickRoom && c.meSpe < c.foeSpe) add(statusBonus(c, 3), 'Trick Room');
    } else if (e === 239 && n === 'Tailwind') {
      if (!st[me.side].tailwind && c.meSpe <= c.foeSpe && c.meSpe * 2 > c.foeSpe) add(statusBonus(c, 3), 'Tailwind');
    } else if ([136, 137, 115, 164].includes(e)) {
      add(statusBonus(c, 1), 'weather');
    } else if (H.EFFECT_DROP[e]) {
      add(statusBonus(c, e === 20 || e === 60 ? 2 : 1), 'lower a stat');
    } else if (e === 7 && mm.cat !== 'X') {
      // EFFECT_EXPLOSION: worth it only when it's the only knockout left, or the AI goes down anyway
      if (c.predicted && meta(c.predicted).eff !== 111) {
        const otherKO = c.attacks(me).some(x => x !== id && c.kos(me, foe, x, 1));
        if (!otherKO && (c.foeCanKOMe || (me.hp <= me.maxHp / 4 && itemName(me) === 'Custap Berry'))) add(4, 'explode (would faint anyway)');
      }
    } else if (e === 31 && mm.cat !== 'X') {
      if (c.hitsFirst(id) && ec >= 30 && foe.ability !== 'Inner Focus' && !blockedBySub && isDamager(cls) === false) add(statusBonus(c, 3), 'flinch');
    }
    if (mm.cat !== 'X') {
      if (c.doubles) { const dk = doublesKilling(c); if (dk.id === id && dk.score > 0) add((DMAP[cls] || DMAP.dAllOut)[dk.score], `best attack here (${dk.score} knockout points)`); }
      else damageBonus(c, id, v, add);
    }
    if (c.doubles) {
      const ally = actives(st, me.side).find(m => m !== me);
      if (e === 172 && ally) add(cls === 'dUtility' ? 16 : statusBonus(c, 3), 'draw attacks away from its partner');
      else if (e === 176 && ally && ally.moves.some(x => meta(x).cat !== 'X')) add(statusBonus(c, 2), 'Helping Hand');
      else if (n === 'Wide Guard' && actives(st, foe.side).some(f => f.moves.some(x => [8, 32].includes((E.mv(x) || {}).tg) && meta(x).cat !== 'X'))) add(statusBonus(c, 3), 'Wide Guard');
      else if (e === 158 && n === 'Fake Out' && me.firstTurn && foe.ability !== 'Inner Focus') add(cls === 'dUtility' ? 17 : statusBonus(c, 3), 'Fake Out');
    }
    return v;
  }

  /** DamageMoveViabilityIncrease (singles). */
  function damageBonus(c, id, v0, add) {
    const { st, me, foe, cls, predicted } = c;
    const mm = meta(id);
    const pri = priorityOf(st, me, id);
    const predSucker = predicted && meta(predicted).eff === 237;
    const okVsSucker = !predSucker || isDamager(cls) || (pri > 0 && c.meSpe > c.foeSpe);
    const hasProtect = me.moves.some(x => meta(x).eff === 111);
    const koFirst = koBestAccuracy(c, id, true);
    if (koFirst) {
      if (okVsSucker && (!foe.destinyBond || c.foeCanKOMe)) add(9, 'knocks out first');
      return;
    }
    const foeSelfFaint = willFaintResidual(st, foe);
    const predHeal = predicted && (HEAL_EFFECTS.has(meta(predicted).eff) || meta(predicted).eff === 37);
    if (!hasProtect && !c.hitsFirst(id) && koBestAccuracy(c, id, false) && (!foeSelfFaint || predHeal || MOXIE.has(me.ability))) {
      const last = alive(st, foe.side).length === 1;
      const slow = { kill: 8, setup: last ? 8 : 6, status: 8, stall: last ? 9 : 8, phaze: last ? 9 : 8,
        baton: last ? 9 : (!c.foeCan2HKOMe ? 3 : 8), cleric: last ? 9 : (!c.foeCan2HKOMe ? 6 : 7),
        screens: last ? 9 : (!c.foeCan2HKOMe ? 6 : 9), setupScreens: last ? 9 : (!c.foeCan2HKOMe ? 6 : 9), hazards: last ? 9 : (!c.foeCan2HKOMe ? 3 : 6) };
      add(slow[cls] || 8, 'knocks out (moves second)');
      return;
    }
    // desperate: the player is about to knock it out, so use the strongest move that goes first
    const desperateAllowed = !me.aiDesperate || coin(c.rng, foe.lastMove && meta(foe.lastMove).cat === 'X' ? 0.25 : 0.75);
    const normallySlower = pri > 0 && c.meSpe < c.foeSpe;
    const hazardsLeft = me.moves.some(x => negatives(c, x) === 0 && meta(x).eff === 112);
    const fakeOutUseful = me.firstTurn && me.moves.some(x => meta(x).name === 'Fake Out') && foe.ability !== 'Inner Focus';   // Fake Out itself, if it would flinch
    if (desperateAllowed && !hasProtect && c.foeKOsMe && strongestFirst(c, id)
        && (cls !== 'hazards' || coin(c.rng, 0.5) || !hazardsLeft) && (cls !== 'phaze' || normallySlower) && (cls !== 'stall' || normallySlower)
        && !c.goodToPivot && !fakeOutUseful) {
      if (okVsSucker) { add(9, 'last chance: strongest move that goes first'); c.desperate = c.desperate || new Set(); c.desperate.add(id); return; }
      if (id !== c.myStrongest) return;
    } else if (id !== c.myStrongest) return;
    // IsStrongestMove
    const first = c.hitsFirst(id);
    if (first || !willFaintResidual(st, foe) || predHeal || MOXIE.has(me.ability)) {
      if (!foe.destinyBond || c.foeCanKOMe || !first) {
        const untouched = v0 === 100;
        if (untouched && c.kos(me, foe, id, 1) && !predHeal && !(predicted && meta(predicted).drain)) {
          const bonus = { cleric: 5, screens: 6, setupScreens: 6, baton: 6, phaze: 8, stall: 8, hazards: 4 };
          add(bonus[cls] || 2, 'strongest move, knocks out');
        } else add(2, 'strongest move');
      }
    }
    void mm;
  }
  /** Doubles: the attack with the most knockout points against this target and whoever else it hits. */
  function doublesKilling(c) {
    if (c.dk) return c.dk;
    const { st, me, foe } = c;
    const foes = [foe].concat(actives(st, other(me.side)).filter(f => f !== foe));
    const ally = actives(st, me.side).find(m => m !== me);
    const wideGuard = foes.some(f => f.moves.some(x => meta(x).name === 'Wide Guard') && f.status !== 'slp') && coin(c.rng, 0.75);
    let best = null, bestScore = -99, bestTg = -1;
    for (const id of c.attacks(me)) {
      const tg = (E.mv(id) || {}).tg || 0;
      const spread = tg === 8 || tg === 32;
      if (wideGuard && spread) continue;
      let score = 0;
      foes.forEach((f, j) => {
        if (j > 0 && !spread) return;
        if (c.handled && c.handled.has(f.key)) return;
        const d = c.dmg(me, f, id) * (spread && foes.length > 1 ? 0.75 : 1);
        if (d <= 0) return;
        score += 4;
        const ko = d >= f.hp && !(f.hp === f.maxHp && (f.ability === 'Sturdy' || itemName(f) === 'Focus Sash') && !meta(id).multihit);
        if (ko) score += f.destinyBond ? 0 : 2;
        else if (c.strongest(me, f) === id) score += 1;
      });
      if (tg === 32 && ally) { const d = c.dmg(me, ally, id) * 0.75; if (d > 0) { score -= 3; if (d >= ally.hp) score -= 2; } }
      if (score > bestScore || (score === bestScore && tg === 8 && bestTg === 32)) { best = id; bestScore = score; bestTg = tg; }
    }
    c.dk = { id: best, score: Math.max(0, Math.min(12, bestScore)) };
    return c.dk;
  }
  // MoveKnocksOutPossiblyGoesFirstWithBestAccuracy
  function koBestAccuracy(c, id, checkFirst) {
    const { me, foe } = c;
    const cands = c.attacks(me).filter(x => c.kos(me, foe, x, 1) && (!checkFirst || (c.hitsFirst(x) && meta(x).eff !== 148)));
    if (!cands.includes(id)) return false;
    const best = Math.max(...cands.map(x => c.acc(me, foe, x)));
    return c.acc(me, foe, id) >= best;
  }
  // StrongestMoveGoesFirst
  function strongestFirst(c, id) {
    const { me, foe } = c;
    const firsts = c.attacks(me).filter(x => c.hitsFirst(x));
    if (!firsts.includes(id)) return false;
    let best = null, bd = -1;
    for (const x of firsts) { const d = Math.min(c.dmg(me, foe, x), foe.hp); if (d > bd) { bd = d; best = x; } }
    return best === id || Math.min(c.dmg(me, foe, id), foe.hp) >= bd;
  }

  function scoreMoves(c, explain) {
    const { me, st } = c;
    const list = usable(me, st);
    return list.map(id => {
      const why = explain ? [] : null;
      let v = 100 + negatives(c, id);
      if (why && v !== 100) why.push(`${v - 100} ${v <= 80 ? 'absorbed or immune' : 'would fail or backfire'}`);
      v = positives(c, id, v, why);
      return { id, score: v, why };
    });
  }

  // ---------------- switching ----------------
  /** CalcMostSuitableMonToSwitchInto: score every Pokemon that could come in against the current foe. */
  function switchScores(st, side, c, foeIn) {
    const foe = foeIn || (c && c.foe) || actives(st, other(side))[0] || act(st, other(side));
    const out = [];
    if (!foe || foe.fainted) return out;
    const ctx = c || context(st, side, H.expectedDice(), null, null, { noPredict: true });   // damage numbers only
    st[side].team.forEach((m, i) => {
      if (m.fainted || st[side].slots.includes(i)) return;
      const entry = hazardDamage(st, side, m);
      if (entry >= m.hp) return;   // would faint on entry
      let score = 0, flags = 0;
      const mSpe = speed(st, m), fSpe = speed(st, foe);
      if (st.trickRoom ? mSpe <= fSpe : mSpe >= fSpe) { score += SW.OUTSPEEDS; flags |= F.OUTSPEEDS; }
      const myAtk = m.moves.filter(id => meta(id).cat !== 'X');
      const koMoves = myAtk.filter(id => ctx.dmg(m, foe, id) >= foe.hp && !(foe.hp === foe.maxHp && (foe.ability === 'Sturdy' || itemName(foe) === 'Focus Sash') && !meta(id).multihit));
      if (koMoves.length) {
        score += SW.KO; flags |= F.KO;
        if (MOXIE.has(m.ability) || TRAPPERS.has(m.ability)) { score += SW.REVENGE; flags |= F.REVENGE; }
        else if (koMoves.some(id => priorityOf(st, m, id) > 0)) {
          score += SW.REVENGE; flags |= F.REVENGE;
          if (!(flags & F.OUTSPEEDS)) { score += SW.OUTSPEEDS; flags |= F.OUTSPEEDS; }
        } else if (koMoves.some(id => ['Fell Stinger', 'Pursuit'].includes(meta(id).name))) { score += SW.REVENGE; flags |= F.REVENGE; }
      } else {
        if (!myAtk.length && !m.moves.length) { out.push({ i, m, score: -1, flags }); return; }
        const hz = st[side].hazards;
        if (m.moves.some(id => meta(id).eff === 129 || meta(id).name === 'Defog') && (hz.sr || hz.spikes || hz.tspikes || hz.web) && alive(st, side).length >= 2) { score += SW.HAZARDS; flags |= F.HAZARDS; }
        if (myAtk.some(id => ctx.dmg(m, foe, id) >= foe.hp / 2)) { score += SW.TWO_HKO; flags |= F.TWO_HKO; }
      }
      // defensive check against each of the foe's attacks (priority moves first)
      const hpIn = Math.max(0, m.hp - entry);
      const foeAtk = usable(foe, st).filter(id => meta(id).cat !== 'X').sort((a, b) => priorityOf(st, foe, b) - priorityOf(st, foe, a));
      let faints = false, weak = false, normal = 0;
      for (const id of foeAtk) {
        let first = ctx.dmg(foe, m, id), others = first;
        if (m.disguise) first = 0;
        else if (first >= hpIn) {
          faints = true;
          if (flags & F.OUTSPEEDS && priorityOf(st, foe, id) > 0 && !(st.terrain === 'Psychic' && grounded(m))) flags &= ~F.OUTSPEEDS;
          break;
        }
        if (m.hp === m.maxHp && (m.ability === 'Multiscale' || m.ability === 'Shadow Shield')) others *= 2;
        if (hpIn <= first + others) weak = true;
        else if (hpIn <= first + others * 2) normal++;
      }
      if (faints) {
        if (!(flags & F.OUTSPEEDS)) { flags |= F.FAINTS; score = Math.max(0, score - SW.FAINTS); }
        else if (!(flags & F.KO)) score = Math.max(0, score - SW.FAINTS_OUTSPEEDS);
        else score = Math.max(0, score - SW.WEAK);
      } else if (weak) score = Math.max(0, score - SW.WEAK);
      else if (!normal) { score += SW.RESIST_ALL; flags |= F.RESIST_ALL; }
      else {
        const fs = E.rawStats(foe.spec), ms = E.rawStats(m.spec);
        const stage = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
        const atk = fs.atk * stage(foe.boosts.atk), spa = fs.spa * stage(foe.boosts.spa);
        const phys = foeAtk.some(id => meta(id).cat === 'P'), spec = foeAtk.some(id => meta(id).cat === 'S');
        const cantWall = (phys && ms.def <= atk) || (spec && ms.spd <= spa);
        if (!cantWall) { score += SW.WALLS; flags |= F.WALLS; }
      }
      out.push({ i, m, score, flags });
    });
    return out.sort((a, b) => b.score - a.score || a.i - b.i);
  }
  /** The engine's pick among switch-ins (CalcMostSuitableMonToSwitchInto), in party order: a higher score wins; on a tie,
   *  one that won't be knocked out wins over one that would, and if neither would, it's a coin flip. */
  function pickSwitch(list, rng) {
    let best = null;
    for (const r of list.slice().sort((a, b) => a.i - b.i)) {
      if (!best || r.score > best.score) best = r;
      else if (r.score === best.score) {
        const bf = best.flags & F.FAINTS, rf = r.flags & F.FAINTS;
        if (bf && !rf) best = r;
        else if (!bf && !rf && rng && !rng.expected && coin(rng, 0.5)) best = r;
      }
    }
    return best;
  }
  /** Switch-ins the AI could pick (several when it would flip a coin between equal scores). */
  function switchChoices(st, side) {
    const list = switchScores(st, side);
    const best = pickSwitch(list, H.expectedDice());
    if (!best) return [];
    const tied = list.filter(r => r.score === best.score && !(r.flags & F.FAINTS) && !(best.flags & F.FAINTS));
    return tied.length > 1 ? tied.sort((a, b) => a.i - b.i).map(r => r.i) : [best.i];
  }
  function bestSwitch(st, side, c, rng) { return pickSwitch(switchScores(st, side, c), rng) || null; }
  function wontDoTooMuch(c, cand) {
    // PredictedMoveWontDoTooMuchToMon
    const { st, foe } = c;
    if (cand.flags & F.FAINTS) return false;
    const p = c.predicted;
    if (!p || meta(p).cat === 'X' || meta(p).name === 'Pursuit') return true;
    if (cand.flags & F.RESIST_ALL) return true;
    if (meta(p).eff === 237) return true;
    const m = cand.m;
    const d = (m.disguise ? Math.floor(m.maxHp / 8) : c.dmg(foe, m, p)) + hazardDamage(st, m.side, m);
    if (d >= m.hp) return false;
    if (d * 2 < m.hp) return true;
    return d * 2 >= m.maxHp && m.moves.some(id => HEAL_EFFECTS.has(meta(id).eff)) && speed(st, m) > speed(st, foe);
  }
  const PIVOT_NAMES = new Set(['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot']);
  /** How much the target heals each turn on its own (GetAmountToRecoverBy with no move): items and abilities. */
  function recoveryPerTurn(st, m) {
    const it = itemName(m), w = st.weather || '', a = m.ability;
    let r = 0;
    if (it === 'Leftovers' || (it === 'Black Sludge' && hasType(m, 'Poison'))) r += Math.floor(m.maxHp / 16);
    if ((a === 'Rain Dish' && /Rain/.test(w)) || (a === 'Ice Body' && /Snow|Hail/.test(w))) r += Math.floor(m.maxHp / 16);
    if (a === 'Dry Skin' && /Rain/.test(w)) r += Math.floor(m.maxHp / 8);
    if (a === 'Poison Heal' && (m.status === 'psn' || m.status === 'tox')) r += Math.floor(m.maxHp / 8);
    return r;
  }
  /** CalcOnlyBadMovesLeftInMoveset (singles). No status move that still works (or Knock Off on an item), no Protect, and
   *  its strongest attack does under a third of the target's HP (counting the target's healing), while the best switch-in
   *  has an edge the current Pokemon doesn't (a knockout, a 2HKO, resisting everything, walling the foe, or speed). */
  function onlyBadMovesLeft(c, ranked) {
    const { st, me, foe } = c;
    let damaging = 0;
    for (const id of usable(me, st)) {
      if (negatives(c, id) < 0) continue;                           // AIScript_Negatives would cut it below 100
      const mm = meta(id);
      if (mm.cat === 'X') return false;                              // has a status move that still works
      if (mm.name === 'Knock Off' && foe.item) return false;
      damaging++;
    }
    if (me.moves.some(id => meta(id).eff === 111)) return false;     // singles: a Pokemon with Protect stalls instead
    if (!damaging) return true;                                      // no usable move at all
    if (me.sub && !foe.moves.some(id => meta(id).cat !== 'X' && meta(id).sound)) return false;   // hiding behind a Substitute
    if (me.moves.some(id => PIVOT_NAMES.has(meta(id).name) && negatives(c, id) === 0)) return false;   // pivots switch on their own
    const s = c.myStrongest, dmg = s ? c.dmg(me, foe, s) : 0;
    if (dmg >= foe.hp) return false;                                 // can knock it out
    const rec = recoveryPerTurn(st, foe);
    if (rec || foe.moves.some(id => HEAL_EFFECTS.has(meta(id).eff))) { if (dmg * 3 >= foe.hp + rec * 2) return false; }
    else if (dmg * 3 >= foe.hp) return false;                        // can 3HKO: keep attacking
    const best = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
    const flags = best ? best.flags : 0;
    if (!flags) return false;                                        // the switch-in has no edge either
    if (flags & (F.KO | F.TWO_HKO)) return true;
    if (flags & F.RESIST_ALL) return !foe.moves.every(id => meta(id).cat === 'X' || c.dmg(foe, me, id) < me.hp / 3);   // unless it resists everything too
    if (flags & F.WALLS) {                                           // unless it walls the foe too (WallsFoe)
      const fs = E.rawStats(foe.spec), ms = E.rawStats(me.spec);
      const stage = x => (x >= 0 ? (2 + x) / 2 : 2 / (2 - x));
      const cantWall = (foe.moves.some(id => meta(id).cat === 'P') && ms.def * stage(me.boosts.def) <= fs.atk * stage(foe.boosts.atk))
        || (foe.moves.some(id => meta(id).cat === 'S') && ms.spd * stage(me.boosts.spd) <= fs.spa * stage(foe.boosts.spa));
      return cantWall;
    }
    return true;
  }
  /** PredictedMoveWontKOMon: the move the AI expects (no move, a status move, Sucker Punch: nothing) plus entry hazards
   *  won't knock this switch-in out. */
  function wontKO(c, cand) {
    const p = c.predicted;
    if (!p || meta(p).cat === 'X' || meta(p).eff === 237) return true;
    const m = cand.m;
    const d = (m.disguise ? Math.floor(m.maxHp / 8) : c.dmg(c.foe, m, p)) + hazardDamage(c.st, m.side, m);
    return d < m.hp;
  }
  /** PredictedMoveKOsSelfDueToContact: the expected move makes contact and the switch-in's Rough Skin, Iron Barbs or
   *  Rocky Helmet would knock the attacker out. */
  function contactKOs(c, cand) {
    const p = c.predicted, foe = c.foe;
    if (!p || !meta(p).contact || foe.ability === 'Magic Guard' || foe.ability === 'Long Reach' || itemName(foe) === 'Protective Pads') return false;
    let d = 0;
    if (['Rough Skin', 'Iron Barbs'].includes(cand.m.ability)) d += Math.floor(foe.maxHp / 8);
    if (itemName(cand.m) === 'Rocky Helmet') d += Math.floor(foe.maxHp / 6);
    return d > 0 && d >= foe.hp;
  }
  /** FastPivotingMoveInMovesetThatAffects: U-turn, Volt Switch, Flip Turn or Parting Shot that works on the foe and goes
   *  first. With one, the switch checks below pivot out with it instead of switching (ConfirmAISwitch). */
  function fastPivot(c) {
    const { st, me, foe } = c;
    return usable(me, st).some(id => {
      const mm = meta(id);
      if (mm.eff !== 127 || mm.name === 'Baton Pass' || mm.name === 'Shed Tail') return false;
      if (mm.cat !== 'X' && c.dmg(me, foe, id) === 0) return false;   // Volt Switch into a Ground type
      return c.hitsFirst(id);
    });
  }
  /** The best and second-best switch-ins (GetMostSuitableMonToSwitchInto and the second), then the rest in party order. */
  function switchOrder(c, ranked) {
    const best = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
    const second = pickSwitch(ranked.filter(r => r !== best), H.expectedDice());
    return { best, second, rest: ranked.filter(r => r !== best && r !== second).sort((a, b) => a.i - b.i) };
  }
  /** SwitchToBestResistMon: a switch-in that resists everything the foe has (or whose Rough Skin, Iron Barbs or Rocky
   *  Helmet would knock out the attacker it takes a contact hit from). */
  function bestResist(c, ranked, willPivot, useFoe, why) {
    const { best, second, rest } = switchOrder(c, ranked);
    for (const r of [best, second].concat(rest)) {
      if (r && (r.flags & F.RESIST_ALL || (useFoe && contactKOs(c, r) && wontKO(c, r)))) return { to: r.i, why, pivot: willPivot };
    }
    return null;
  }
  /** The AI's own expected move this turn (its prediction for itself: its best-scoring move). */
  function ownPrediction(c) {
    if (!c.scores) c.scores = scoreMoves(c, true);
    const top = Math.max(...c.scores.map(x => x.score));
    const t = c.scores.find(x => x.score === top);
    return t ? t.id : null;
  }
  /** ShouldSwitch (singles), in the engine's order (ai_switching.c). The rarer checks are left out: stopping a locked
   *  move, Wonder Guard and the semi-invulnerable "troll" switch. A switch the engine makes with ConfirmAISwitch while
   *  holding a fast pivot comes back as { pivot: true }: it uses the pivot move instead of switching. */
  function shouldSwitch(c) {
    const { st, me, foe } = c;
    const side = me.side;
    if (!bench(st, side).length) return null;
    if (me.charging || me.rampage || me.recharge) return null;
    if (!canSwitch(st, me)) return null;
    if (['Shadow Tag', 'Arena Trap'].includes(foe.ability) && !hasType(me, 'Ghost') && (foe.ability !== 'Arena Trap' || grounded(me))) return null;
    if (foe.ability === 'Magnet Pull' && hasType(me, 'Steel')) return null;
    const cooldown = (me.swCooldown || 0) > 0;   // just switched in (the engine's switchingCooldown, kept by the simulator)
    const ranked = c.ranked || (c.ranked = switchScores(st, side, c));
    if (!ranked.length) return null;
    const p = c.predicted;
    // a teammate absorbs the move the player is about to use (FindMonThatAbsorbsOpponentsMove)
    if (p && meta(p).cat !== 'X' && !me.absorbCooldown && me.boosts.eva < 3) {
      const t = meta(p).type;
      const damagerFoe = isDamager(fightingStyle(st, foe));
      if (!(damagerFoe ? false : (cooldown || !coin(c.rng, 0.5)))) {
        const aiFirst = !c.firstVs(foe, me, p, c.myStrongest);
        if (!(aiFirst && c.iCanKO)) {
          const big = c.dmg(foe, me, p) >= me.hp / 3;
          const absorber = ranked.find(r => ABSORBS[r.m.ability] === t && !(r.m.ability === 'Levitate' && t !== 'Ground') && hazardDamage(st, side, r.m) < r.m.hp / 4);
          if (big && absorber) return { to: absorber.i, why: `${absorber.m.name}'s ${absorber.m.ability} absorbs ${meta(p).name}` };
        }
      }
    }
    // a Wish is about to come true here: let a teammate under half HP take it (PassOnWish)
    if (wishPending(st, me) && !(me.hp < me.maxHp / 2 && (!c.foeCanKOMe || me.moves.some(id => meta(id).eff === 111)))) {
      const { best, second, rest } = switchOrder(c, ranked);
      for (const r of [best, second].concat(rest)) if (r && r.m.hp < r.m.maxHp / 2 && hazardDamage(st, side, r.m) < r.m.hp && wontKO(c, r)) return { to: r.i, why: 'pass on the wish' };
    }
    // its perish count is up (ShouldSwitchIfPerishSong)
    if (me.perish === 0) { const r = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng)); if (r) return { to: r.i, why: 'its perish count is up' }; }
    // only bad moves left (ShouldSwitchIfOnlyBadMovesLeft): to the best switch-in, else the second best, if it has an
    //    edge (outspeeds, walls the foe or resists all its attacks) and the predicted attack won't do too much to it
    if (!cooldown && !(me.destinyBond && c.foeKOsMe && !c.firstVs(me, foe, c.myStrongest, p)) && onlyBadMovesLeft(c, ranked)) {
      const best = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
      const second = pickSwitch(ranked.filter(r => r !== best), H.expectedDice());
      for (const r of [best, second]) if (r && r.flags & (F.OUTSPEEDS | F.WALLS | F.RESIST_ALL) && wontDoTooMuch(c, r)) return { to: r.i, why: 'only bad moves left' };
      if (me.lock && /^Choice /.test(itemName(me) || ''))   // choice-locked: any switch-in that won't be knocked out
        for (const r of [best, second]) if (r && !(r.flags & F.FAINTS) && wontDoTooMuch(c, r)) return { to: r.i, why: 'only bad moves left (choice-locked)' };
    }
    // Natural Cure or Regenerator (ShouldSwitchIfNaturalCureOrRegenerator)
    let heals = false;
    if (me.ability === 'Natural Cure' && !bigEntryDamage(st, me, 4)) {
      const hz = st[side].hazards;
      const repoison = hz.tspikes && (me.status === 'psn' || me.status === 'tox') && grounded(me) && !hasType(me, 'Poison');
      const b = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
      if (!(repoison && !(b && hasType(b.m, 'Poison') && grounded(b.m)))) heals = me.status === 'slp' || (!!me.status && me.hp >= me.maxHp / 2);
    } else if (me.ability === 'Regenerator' && me.hp <= me.maxHp / 2 && !bigEntryDamage(st, me, 3)) {
      if (p && meta(p).cat !== 'X' && c.kos(foe, me, p, 1)) {
        const own = ownPrediction(c);
        heals = !(own && meta(own).cat !== 'X' && c.firstVs(me, foe, own, p) && c.kos(me, foe, own, 1));
      }
    }
    if (heals) {
      const why = me.ability === 'Natural Cure' ? 'Natural Cure' : 'Regenerator';
      const res = bestResist(c, ranked, false, false, why);
      if (res) return res;
      const b = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
      if (b && (wontDoTooMuch(c, b) || (wontKO(c, b) && !coin(c.rng, 0.5)))) return { to: b.i, why };
    }
    // about to fall asleep from Yawn
    if (me.yawn === 1 && !me.status && !cooldown) {
      for (const r of ranked.slice(0, 2)) if (wontDoTooMuch(c, r) && r.flags & (F.WALLS | F.RESIST_ALL | F.KO)) return { to: r.i, why: 'avoid falling asleep' };
    }
    // asleep: half the time it switches out (ShouldSwitchWhileAsleep)
    if (!cooldown && me.status === 'slp' && coin(c.rng, 0.5)) {
      const b = me.boosts, boosted = b.atk >= 2 || b.spa >= 2 || b.spe >= 2 || b.eva >= 3;
      const sleeper = ['Shed Skin', 'Early Bird'].includes(me.ability) || (me.ability === 'Hydration' && st.weather === 'Rain' && st.weatherTurns !== 1)
        || me.moves.some(id => ['Sleep Talk', 'Snore'].includes(meta(id).name) || meta(id).eff === 37) || (c.cls === 'stall' && trapped(st, foe));
      if (!(boosted && coin(c.rng, 0.5)) && !sleeper) {
        const r = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
        if (r && !(r.m.status === 'slp' && (r.m.sleep || 0) > 1) && wontDoTooMuch(c, r)) return { to: r.i, why: 'asleep' };
      }
    }
    // taking heavy end-of-turn damage (bad poison, Leech Seed)
    if (!cooldown && ((me.status === 'tox' && (me.toxic || 0) >= 2) || me.seeded) && me.hp > me.maxHp / 3) {
      for (const r of ranked.slice(0, 2)) if (r.flags & (F.WALLS | F.RESIST_ALL) && wontDoTooMuch(c, r)) return { to: r.i, why: 'shake off end-of-turn damage' };
    }
    // would be knocked out before moving
    if (!cooldown && !me.destinyBond && p && meta(p).cat !== 'X' && !(me.status === 'par' && me.hp < me.maxHp / 3 && !['Quick Feet', 'Natural Cure'].includes(me.ability))) {
      const aiFirst = c.myStrongest && c.firstVs(me, foe, c.myStrongest, p);
      if (!aiFirst && c.foeKOsMe && hazardDamage(st, side, me) < me.maxHp / 3 && (me.hp > me.maxHp / 5 || ranked[0].score >= SW.MAX)) {
        for (const r of ranked) {
          const immune = c.dmg(foe, r.m, p) === 0;
          if ((r.flags & (F.OUTSPEEDS | F.WALLS | F.RESIST_ALL) && immune)
            || ((r.flags & (F.WALLS | F.RESIST_ALL) || (r.flags & F.KO && r.flags & F.OUTSPEEDS)) && wontDoTooMuch(c, r)))
            return { to: r.i, why: 'avoid being knocked out' };
        }
      }
    }
    // an attacking stat cut to -3 or lower (ShouldSwitchWhenOffensiveStatsAreLow)
    if (!cooldown && isDamager(c.cls) && (me.boosts.atk <= -3 || me.boosts.spa <= -3 || me.boosts.acc <= -3)) {
      const mv = usable(me, st).filter(id => meta(id).power > 0);
      const phys = mv.some(id => meta(id).cat === 'P' && meta(id).eff !== 89 && !['Body Press', 'Foul Play'].includes(meta(id).name));
      const spec = mv.some(id => meta(id).cat === 'S' && meta(id).eff !== 144);
      const b = me.boosts;
      const cleared = (b.atk <= -3 && phys && !spec) || (b.spa <= -3 && spec && !phys) || (b.atk <= -3 && b.spa <= -3 && phys && spec)
        || (b.acc <= -3 && usable(me, st).every(id => c.acc(me, foe, id) < 70) && c.cls !== 'stall');
      if (cleared && (!c.foeCanKOMe || b.acc <= -3)) {
        const r = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
        if (r && (r.flags & (F.WALLS | F.RESIST_ALL) || (r.flags & F.OUTSPEEDS && wontDoTooMuch(c, r)))) return { to: r.i, why: 'its attack has been lowered', pivot: fastPivot(c) };
      }
    }
    // a damager that can't knock the foe out now: save it for later and bring in something better (ShouldSaveSweeperForLater)
    const save = saveSweeper(c, ranked, cooldown);
    if (save) return save;
    return null;
  }
  /** ShouldSaveSweeperForLater: a damager that can't knock the foe out (and isn't paralyzed, set up, keeping a trapped
   *  foe taking damage, or about to lose a quarter of its HP to hazards coming back) leaves when the foe would knock it
   *  out first, or (no useful boosts or setup move) when the best switch-in can knock the foe out, or otherwise half the
   *  time, a quarter if it could 2HKO, unless it already resists everything or drains with its best move. It goes to a
   *  switch-in that outspeeds and knocks out (when the foe threatens it), else one that resists everything, by U-turn
   *  or Volt Switch when it has one that goes first. This is the swap that keeps a boss pivoting between attackers. */
  function saveSweeper(c, ranked, cooldown) {
    const { st, me, foe } = c;
    if (cooldown || c.doubles) return null;
    if (me.status === 'par' && !['Quick Feet', 'Guts'].includes(me.ability)) return null;
    if (!isDamager(c.cls)) return null;
    const p = c.predicted;
    const fakeOutHurts = p && meta(p).name === 'Fake Out' && me.ability !== 'Inner Focus' && !me.sub && c.dmg(foe, me, p) >= me.maxHp / 2;
    if (c.iCanKO && !fakeOutHurts) return null;
    if (me.sub && !foe.moves.some(id => meta(id).cat !== 'X' && (meta(id).sound || foe.ability === 'Infiltrator'))) return null;
    if (bigEntryDamage(st, me, 4)) return null;
    const foeStuck = trapped(st, foe) && takingResidual(st, foe);
    if (foeStuck) return null;
    let go = false;
    if (c.foeCanKOMe && !canHealFirst(c)) go = true;
    else if (!usefulBoost(st, me) && (me.boosts.eva || 0) < 3 && !offensiveSetup(c)) {
      const b = c.bestSw || (c.bestSw = pickSwitch(ranked, c.rng));
      if (b && b.flags & F.KO) go = true;
      else {
        const r = c.rng.expected ? 0 : Math.floor(c.rng() * 4);   // AIRandom: bit 1 for half the time, bit 2 when it could 2HKO
        go = (r & 1) && (!c.iCan2HKO || (r & 2)) && !resistsAll(c) && !strongestDrains(c);
      }
    }
    if (!go) return null;
    const own = ownPrediction(c);
    if (own && ((meta(own).name === 'Fake Out' && foe.ability !== 'Inner Focus') || meta(own).eff === 111)) return null;   // use it, then switch
    const willPivot = fastPivot(c);
    if (c.foeCanKOMe) {
      if (own && meta(own).eff === 98 && c.firstVs(me, foe, own, p)) return null;   // Destiny Bond
      if (me.destinyBond && !c.firstVs(me, foe, own, p)) return null;
      const { best, second } = switchOrder(c, ranked);
      for (const r of [best, second]) {
        if (!r) continue;
        if ((r.flags & F.OUTSPEEDS && r.flags & F.KO && wontDoTooMuch(c, r)) || (contactKOs(c, r) && wontKO(c, r))) return { to: r.i, why: 'save it for later', pivot: willPivot };
      }
    }
    return bestResist(c, ranked, willPivot, true, 'save it for later');
  }
  /** CanHealFirstToPreventKnockOut: a healing move (or Protect against the expected move) that goes first and keeps it
   *  out of knockout range. */
  function canHealFirst(c) {
    const { st, me, foe } = c;
    for (const id of usable(me, st)) {
      const mm = meta(id);
      if (!(HEAL_EFFECTS.has(mm.eff) || mm.eff === 3 || mm.eff === 8 || mm.eff === 111)) continue;
      if (!c.hitsFirst(id)) continue;
      if (mm.eff === 111) { if (c.predicted && meta(c.predicted).cat !== 'X') return true; continue; }
      const heal = mm.cat !== 'X' ? Math.floor(c.dmg(me, foe, id) / 2) : healAmount(c, id);
      const after = Math.min(me.maxHp, me.hp + heal);
      if (!c.attacks(foe).some(x => c.dmg(foe, me, x) >= after)) return true;
    }
    return false;
  }
  /** OffensiveSetupMoveInMoveset: a move that raises its attacking stats (or evasion). */
  const offensiveSetup = c => usable(c.me, c.st).some(id => {
    const mm = meta(id), b = H.SETUP[mm.name] || H.EFFECT_BOOST[mm.eff];
    return mm.cat === 'X' && b && (b.atk > 0 || b.spa > 0 || b.eva > 0 || b.spe > 1);
  }) || usable(c.me, c.st).some(id => meta(id).name === 'Belly Drum');
  /** ResistsAllMoves: none of the foe's moves does a third of its HP. */
  const resistsAll = c => usable(c.foe, c.st).every(id => meta(id).cat === 'X' || c.dmg(c.foe, c.me, id) < c.me.hp / 3);
  /** IsStrongestMoveHPDrainingMove */
  const strongestDrains = c => { const s = c.myStrongest; return !!s && (meta(s).eff === 3 || meta(s).eff === 8); };

  /** One battler's action in doubles: the best move against each target (ChooseMoveOrAction_Doubles), then the best target
   *  (ChooseTarget_Doubles: highest score, then more knockouts, then more damage). Partners never target each other here. */
  function chooseDoubles(st, side, rng, slot, handled, explain, peek) {
    const me = act(st, side, slot);
    const forced = usable(me, st);
    const ct = me.chargeTarget && !me.chargeTarget.fainted ? { side: me.chargeTarget.side, slot: me.chargeTarget.slot } : undefined;
    if (me.charging || (me.rampage && me.lock) || me.recharge) return { type: 'move', id: forced[0], target: ct };
    const foes = actives(st, other(side));
    if (!foes.length) return { type: 'move', id: forced[0] };
    const options = foes.map(foe => {
      const c = context(st, side, rng, me, foe);
      c.handled = handled;
      const scores = scoreMoves(c, explain);
      const top = Math.max(...scores.map(x => x.score));
      const ties = scores.filter(x => x.score === top);
      const pick = ties.length === 1 || rng.expected ? ties[0] : ties[Math.floor(rng() * ties.length)];
      const mm = meta(pick.id);
      const tg = (E.mv(pick.id) || {}).tg || 0;
      const hit = mm.cat === 'X' ? [] : (tg === 8 || tg === 32 ? foes : [foe]);
      const kos = hit.filter(f => c.dmg(me, f, pick.id) * (hit.length > 1 ? 0.75 : 1) >= f.hp).length;
      const dmg = hit.reduce((sum, f) => sum + Math.min(f.hp, c.dmg(me, f, pick.id)), 0);
      return { foe, c, top, pick, scores, kos, dmg, tg };
    });
    options.sort((x, y) => (y.top - x.top) || (y.kos - x.kos) || (y.dmg - x.dmg));
    const best = options[0];
    // with nothing useful against anyone, switch out like the singles check does
    if (best.top < 95 && bench(st, side).length && !((me.swCooldown || 0) > 0) && canSwitch(st, me)) {
      const total = new Map();
      for (const f of foes) for (const r of switchScores(st, side, null, f)) total.set(r.i, (total.get(r.i) || 0) + r.score);
      const ranked = [...total.entries()].filter(([i]) => !st[side].slots.includes(i)).sort((x, y) => y[1] - x[1]);
      if (ranked.length && ranked[0][1] > 0) return { type: 'switch', to: ranked[0][0], why: 'only bad moves left' };
    }
    if (!peek) me.absorbCooldown = false;
    const single = best.pick && meta(best.pick.id).cat !== 'X' && !(best.tg === 8 || best.tg === 32);
    const res = { type: 'move', id: best.pick.id, target: { side: best.foe.side, slot: best.foe.slot }, z: !!(best.c.zSet && best.c.zSet.has(best.pick.id)),
      knocksOut: single && best.kos ? best.foe.key : null };
    if (explain) { res.scores = best.scores; res.style = best.c.cls; res.targetName = best.foe.name; res.byTarget = options.map(x => ({ target: x.foe.name, score: x.top, move: x.pick.id })); }
    return res;
  }

  function policy(opts) {
    const o = opts || {};
    return {
      kind: 'cfru',
      /** Returns { type: 'move', id } or { type: 'switch', to }, plus the scores when explain is set. */
      choose(st, side, rng, explain, peek, slot) {
        if (st.size > 1) return chooseDoubles(st, side, rng, slot || 0, new Set(), explain || o.explain, peek);
        const me = act(st, side);
        const forced = usable(me, st);
        if (me.charging || (me.rampage && me.lock) || me.recharge) return { type: 'move', id: forced[0] };
        const c = context(st, side, rng);
        const sw = o.noSwitch ? null : shouldSwitch(c);      // noSwitch: trainers that never switch by choice (the puzzle battles)
        if (sw) {
          // ConfirmAISwitch with a fast pivot: it U-turns (or Volt Switches...) to that Pokemon instead (PIVOT_IMMEDIATELY)
          if (sw.pivot) { c.goodToPivot = true; c.pivotTarget = sw.to; if (!peek) st[side].pivotTo = { to: sw.to, turn: st.turn, foe: c.foe.key }; }
          else {
            if (!peek && /absorbs/.test(sw.why)) st[side].team[sw.to].absorbCooldown = true;
            return { type: 'switch', to: sw.to, why: sw.why };
          }
        }
        // scores computed during the switch check are reused unless the pivot decision changed them
        const scores = (!c.goodToPivot && c.scores) || scoreMoves(c, true);
        if (c.goodToPivot) c.scores = scores;
        const top = Math.max(...scores.map(s => s.score));
        const best = scores.filter(s => s.score === top);
        const pick = best.length === 1 || rng.expected ? best[0] : best[Math.floor(rng() * best.length)];
        if (!peek) { me.aiDesperate = !!(c.desperate && c.desperate.has(pick.id)); me.absorbCooldown = false; }
        const res = { type: 'move', id: pick.id, z: !!(c.zSet && c.zSet.has(pick.id)) };
        if (c.goodToPivot && meta(pick.id).eff === 127) res.pivotTo = c.pivotTarget;   // who it means to bring in
        if (explain || o.explain) { res.scores = scores; res.style = c.cls; res.ties = best.length; }
        return res;
      },
      /** Doubles: both slots, the first slot first so the second knows which foe its partner is knocking out. */
      chooseAll(st, side, rng, peek, explain) {
        const out = [];
        const handled = new Set();
        st[side].slots.forEach((idx, slot) => {
          const m = st[side].team[idx];
          if (!m || m.fainted) return;
          const a = chooseDoubles(st, side, rng, slot, handled, explain || o.explain, peek);
          out.push(a);
          if (a.type === 'move' && a.knocksOut) handled.add(a.knocksOut);
        });
        return out;
      },
      replace(st, side, rng, why, slot) {
        // a pivot goes to the Pokemon the switch check picked, unless it's gone or the foe it was picked against has changed
        const pt = st[side].pivotTo;
        if (why === 'pivot' && pt && pt.turn === st.turn) {
          st[side].pivotTo = null;
          const m = st[side].team[pt.to], foe = act(st, other(side));
          if (m && !m.fainted && !st[side].slots.includes(pt.to) && foe && foe.key === pt.foe) return pt.to;
        }
        if (st.size > 1) {
          // the best switch-in against everything on the other side of the field
          const total = new Map();
          for (const f of actives(st, other(side))) for (const r of switchScores(st, side, null, f)) total.set(r.i, (total.get(r.i) || 0) + r.score);
          const ranked = [...total.entries()].filter(([i]) => !st[side].slots.includes(i)).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
          if (ranked.length) return ranked[0][0];
        }
        const r = bestSwitch(st, side, null, rng);
        if (r) return r.i;
        const i = st[side].team.findIndex((m, k) => !m.fainted && !st[side].slots.includes(k));
        return i >= 0 ? i : null;
      },
    };
  }

  return { policy, fightingStyle, fightingStyleDoubles, switchScores, switchChoices, residual, STYLE_NAMES: {
    dAllOut: 'all-out attacker (doubles)', dSetup: 'set-up attacker (doubles)', dTRattack: 'Trick Room attacker', dTRsetup: 'Trick Room setter',
    dUtility: 'support and utility (doubles)', dPhaze: 'phazer (doubles)', dSupport: 'team support (doubles)', dTotalSupport: 'full support (doubles)',
    kill: 'attacker', setup: 'set-up sweeper', status: 'status sweeper', stall: 'staller', baton: 'Baton Passer', cleric: 'cleric',
    screens: 'screen setter', setupScreens: 'screens + attacks', phaze: 'phazer', hazards: 'hazard setter' } };
});
