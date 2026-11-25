// Runs every tests/*.test.js file. Usage: npm test (or node tests/run.js [filter])
const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const filter = process.argv[2] || '';
for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) require(path.join(__dirname, f));
(async () => {
  let failed = 0, passed = 0;
  for (const t of lib.tests) {
    if (filter && !t.name.includes(filter)) continue;
    const t0 = Date.now();
    try { await t.fn(); passed++; console.log(`ok   ${t.name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`FAIL ${t.name}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
