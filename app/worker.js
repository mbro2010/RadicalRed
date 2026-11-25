/* Runs the fight planner off the page's main thread, so the page stays responsive while it simulates hundreds of battles. */
// the calculator's bundles attach themselves to window.calc
self.window = self;
self.importScripts(
  'https://cdn.jsdelivr.net/npm/@smogon/calc@0.12.0/dist/data/production.min.js',
  'https://cdn.jsdelivr.net/npm/@smogon/calc@0.12.0/dist/production.min.js',
  'engine.js', 'ai.js', 'sim.js');
let SIM = null, ready = null;
function init() {
  if (!ready) ready = fetch('rrdata.json').then(r => r.json()).then(D => { SIM = self.createSim(self.createEngine(self.calc, D)); });
  return ready;
}
self.onmessage = async ev => {
  const { id, specs, team, opts } = ev.data;
  try {
    await init();
    self.postMessage({ id, progress: 0, text: 'Starting…' });
    const res = await SIM.planFight(specs, team, Object.assign({}, opts, { onProgress: (frac, text) => self.postMessage({ id, progress: frac, text }) }));
    self.postMessage({ id, result: JSON.parse(JSON.stringify(res)) });
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  }
};
