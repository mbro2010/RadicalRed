/* Runs the fight planner off the page's main thread, so the page stays responsive while it simulates hundreds of battles. */
// the calculator's bundles attach themselves to window.calc
self.window = self;
self.importScripts(
  'https://cdn.jsdelivr.net/npm/@smogon/calc@0.12.0/dist/data/production.min.js',
  'https://cdn.jsdelivr.net/npm/@smogon/calc@0.12.0/dist/production.min.js',
  'damage.js', 'engine.js', 'ai.js', 'sim.js', 'advice.js');
let SIM = null, E = null, ADV = null, ready = null;
function init() {
  if (!ready) ready = fetch('rrdata.json').then(r => r.json()).then(D => { E = self.createEngine(self.calc, D); SIM = self.createSim(E); ADV = self.createAdvice(E, SIM); });
  return ready;
}
self.onmessage = async ev => {
  const { id, specs, team, opts } = ev.data;
  try {
    await init();
    if (E.setMode) E.setMode(opts && opts.mode, opts && opts.cleared);   // the difficulty: Hardcore's ability changes apply only there
    self.postMessage({ id, progress: 0, text: 'Starting…' });
    // held items and natures for the six it picks, from the items you have
    const setup = opts && opts.pool ? six => ADV.planSetup(six, team, opts.pool) : null;
    const res = await SIM.planFight(specs, team, Object.assign({}, opts, { setup, onProgress: (frac, text) => self.postMessage({ id, progress: frac, text }) }));
    self.postMessage({ id, result: JSON.parse(JSON.stringify(res)) });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};
