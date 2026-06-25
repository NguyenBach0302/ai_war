/* Headless verification for the new combat/class engine.
   Loads public/game.js inside a mocked browser context and runs Game._selftest,
   which simulates hundreds of random battles + a renderer pass with a mock canvas.
   Usage: node tools/sim-test.js [runs] */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'game.js'), 'utf8')
    + '\n;globalThis.__GAME__ = Game;';

const noop = () => {};
const fakeEl = new Proxy({ style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, dataset: {}, textContent: '', innerHTML: '' }, {
    get(t, k) { return k in t ? t[k] : noop; }
});
const ctx = {
    console,
    document: { getElementById: () => fakeEl, querySelector: () => fakeEl, querySelectorAll: () => [], createElement: () => fakeEl, body: fakeEl },
    window: {},
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    setTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    location: { reload: noop },
};
ctx.globalThis = ctx;

vm.createContext(ctx);
vm.runInContext(src, ctx);

const Game = ctx.__GAME__;
const runs = parseInt(process.argv[2], 10) || 300;
const r = Game._selftest(runs);

console.log('\n=== AI WAR — combat engine self-test ===');
console.log(`battles simulated : ${r.runs}`);
console.log(`unterminated      : ${r.unterminated}`);
console.log(`wins  me / enemy  : ${r.winnersMe} / ${r.winnersEnemy}`);
console.log(`renderer pass ok  : ${r.drawOk}`);
console.log(`abilities fired   :`);
Object.entries(r.abilitiesSeen).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(16)} ${v}`));
if (r.errors.length) {
    console.log(`\n!! ERRORS (${r.errors.length}) !!`);
    r.errors.slice(0, 5).forEach(e => console.log('---\n' + e));
    process.exit(1);
}
const abilityCount = Object.keys(r.abilitiesSeen).length;
if (!r.drawOk) { console.log('\nFAIL: renderer threw'); process.exit(1); }
if (r.unterminated > 0) { console.log('\nFAIL: some battles did not terminate'); process.exit(1); }
if (abilityCount < 12) { console.log(`\nFAIL: only ${abilityCount} distinct abilities fired (expected most of 16)`); process.exit(1); }
console.log(`\nPASS — ${abilityCount} distinct abilities fired, all battles terminated, renderer ok.`);
