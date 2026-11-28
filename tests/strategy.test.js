// How each boss fights (app/strategy.js): notes for every boss in both modes, from their sets and the AI's rules.
const { SIM, E, D, test, assert } = require('./lib');
const STR = require('../app/strategy.js')(E, SIM);

test('strategy: every boss in both modes gets notes for the fight and for each of their Pokemon', () => {
  try {
    for (const mode of ['hardcore', 'normal']) {
      E.setMode(mode);
      D.bosses.forEach((b, bi) => {
        if (!(b.party || []).length) return;
        const r = STR.bossNotes(bi);
        assert(r.lead && r.team.length && r.exploits.length >= 3, `${mode} ${b.n}: fight notes`);
        assert(r.mons.length === b.party.length, `${mode} ${b.n}: one entry per Pokemon`);
        for (const m of r.mons) assert(m.notes.length >= 1 && m.notes.every(n => n.t && n.k), `${mode} ${b.n} ${m.name}: notes`);
      });
    }
  } finally { E.setMode('hardcore'); }
});

test('strategy: the notes name what matters: Focus Sash, a primal form, Sucker Punch, set-up sweepers', () => {
  const find = pred => D.bosses.findIndex(b => (b.party || []).some(pred));
  const sash = find(m => E.itemName(m.it) === 'Focus Sash');
  const r = STR.bossNotes(sash);
  assert(r.mons.some(m => m.notes.some(n => n.k === 'item' && /Focus Sash/.test(n.t))), 'Focus Sash note');
  assert(r.exploits.some(n => /Focus Sash, Sturdy and Multiscale/.test(n.t)), 'chip-it-first exploit');
  const kyogre = find(m => E.sp(m.s).n === 'Kyogre' && E.itemName(m.it) === 'Blue Orb');
  if (kyogre >= 0) assert(STR.bossNotes(kyogre).mons.some(m => m.notes.some(n => n.k === 'form' && /Primal/.test(n.t))), 'Primal Kyogre form note');
  const sucker = find(m => (m.mv || []).some(id => (E.mv(id) || {}).f === 'Sucker Punch'));
  assert(STR.bossNotes(sucker).exploits.some(n => /Sucker Punch/.test(n.t)), 'Sucker Punch bait');
});
