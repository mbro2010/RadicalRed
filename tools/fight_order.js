// The run's fights in the boss table's order, as trainer ids per fight (versions of one fight together), for the world
// solver (tools/world_logic.py). Built by the run path (app/flow.js) without the world data, so the solver's input
// doesn't depend on its own output.
//
// usage: node tools/fight_order.js app/rrdata.json hardcore > order_hardcore.json
'use strict';
const path = require('path');
const D = Object.assign({}, require(path.resolve(process.argv[2] || 'app/rrdata.json')), { world: null });
const mode = process.argv[3] || 'hardcore';
const F = require(path.resolve(__dirname, '../app/flow.js'))(D, mode);
const order = F.steps.filter(s => s.kind === 'fight').map(s => s.g.members.map(i => D.bosses[i].id));
process.stdout.write(JSON.stringify(order) + '\n');
