// 地上家园系统单元测试：node tools/test-home-system.js
const assert = require('assert');
const path = require('path');

let inTown = false;
let floor = 1;
global.player = { gold: 0, floor: 1, personalBest: { maxFloor: 1 } };
global.isInTown = () => inTown;
global.getCurrentCombatFloor = () => floor;
global.addGold = n => { player.gold += n; };
global.updateStats = () => {};

const { HomeSystem: H, HOME_CONFIG, HOME_DECORATIONS, HOME_PETS } = require(path.join(__dirname, '..', 'home-system.js'));

let clock = 1_000_000;
H.now = () => clock;
const seq = vals => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const reset = () => { player.home = null; player.gold = 0; player.floor = 1; floor = 1; inTown = false; H.rng = () => 0.999; };
let passed = 0;
const test = (name, fn) => { reset(); fn(); passed++; console.log('  ✓ ' + name); };

test('城镇内击杀不产出', () => {
  inTown = true; H.rng = () => 0;
  assert.deepStrictEqual(H.onEnemyKilled({ isBoss: true }), []);
});

test('保底：装饰物最多 pity 次击杀必出', () => {
  const pity = HOME_CONFIG.DROP.decoration.pity;
  let got = -1;
  for (let i = 1; i <= pity; i++) {
    if (H.onEnemyKilled({}).some(f => f.kind === 'decoration')) { got = i; break; }
  }
  assert.strictEqual(got, pity);
  assert.strictEqual(H.state().pity.decoration, 0);
});

test('深度门槛：1 层不掉宠物，普通怪不掉伙伴', () => {
  H.rng = () => 0;
  const found = H.onEnemyKilled({});
  assert.ok(!found.some(f => f.kind === 'pet' || f.kind === 'companion'));
  floor = 3;
  assert.ok(H.onEnemyKilled({}).some(f => f.kind === 'pet'));
  assert.ok(!H.onEnemyKilled({}).some(f => f.kind === 'companion'));
  assert.ok(H.onEnemyKilled({ isBoss: true }).some(f => f.kind === 'companion'));
});

test('深度过滤：低层不会抽到高层装饰', () => {
  for (let i = 0; i < 200; i++) { H.rng = Math.random; const id = H.pickWeighted(HOME_DECORATIONS, 2); assert.ok(HOME_DECORATIONS[id].minFloor <= 2); }
});

test('摆放：仅限营地，数量不能超过拥有量', () => {
  H.addDecoration('stone_lantern', 1);
  assert.strictEqual(H.placeDecoration(0, 'stone_lantern').ok, false);
  inTown = true;
  assert.strictEqual(H.placeDecoration(0, 'stone_lantern').ok, true);
  assert.strictEqual(H.placeDecoration(1, 'stone_lantern').ok, false);
  assert.strictEqual(H.comfort() >= HOME_DECORATIONS.stone_lantern.comfort, true);
  assert.strictEqual(H.removeDecoration(0).ok, true);
  assert.strictEqual(H.availableDecoration('stone_lantern'), 1);
});

test('种田：计时成熟后才能收获，料理提供限时加成', () => {
  inTown = true;
  H.addSeed('radish', 1);
  assert.strictEqual(H.plant(0, 'radish').ok, true);
  assert.strictEqual(H.state().seeds.radish, undefined);
  assert.strictEqual(H.harvest(0).ok, false);
  clock += 10 * 60000;
  const r = H.harvest(0);
  assert.strictEqual(r.ok, true);
  assert.ok(r.amount >= 2);
  assert.strictEqual(H.cook('radish').ok, true);
  assert.strictEqual(H.getBonuses().maxHpPct >= 5, true);
  clock += 31 * 60000;
  assert.strictEqual(H.foodActive(), null);
});

test('派遣：到时间才能结算，带回金币和种子', () => {
  inTown = true;
  H.addCompanion('aqing');
  assert.strictEqual(H.startExpedition('aqing', 'short').ok, true);
  assert.strictEqual(H.claimExpedition('aqing').ok, false);
  clock += 30 * 60000;
  const r = H.claimExpedition('aqing');
  assert.strictEqual(r.ok, true);
  assert.ok(player.gold > 0);
  assert.ok(Object.values(H.state().seeds).reduce((a, b) => a + b, 0) >= 1);
  assert.strictEqual(H.state().companions.aqing.mode, 'home');
});

test('宠物：首个宠物自动出战并提供属性，重复获得转经验', () => {
  assert.strictEqual(H.addPet('dango_cat'), 'new');
  assert.strictEqual(H.state().activePet, 'dango_cat');
  assert.ok(H.getBonuses().goldPct >= HOME_PETS.dango_cat.base);
  assert.strictEqual(H.addPet('dango_cat'), 'duplicate');
  assert.ok(H.state().pets.dango_cat.level > 1);
});

test('加成应用到玩家属性', () => {
  H.addPet('baby_dragon');
  H.setActivePet('baby_dragon');
  const p = { damage: [100, 200], maxHp: 1000, hp: 1000, goldPct: 0, dropRatePct: 0 };
  H.applyStatBonuses(p);
  assert.ok(p.damage[0] > 100 && p.damage[1] > 200);
  assert.ok(p.homeBonuses);
});

test('旧存档修复：非法摆放与缺失字段', () => {
  player.home = { decorations: { koi_pond: 1 }, yard: ['koi_pond', 'koi_pond', 'not_exist'], pets: {}, activePet: 'ghost' };
  const s = H.state();
  assert.strictEqual(s.yard.length, HOME_CONFIG.YARD_SLOTS);
  assert.deepStrictEqual(s.yard.slice(0, 3), ['koi_pond', null, null]);
  assert.strictEqual(s.activePet, null);
  assert.ok(s.farm && Array.isArray(s.farm.plots));
});

test('读档：不同存档槽之间不串数据', () => {
  H.addDecoration('bonsai', 2);
  H.onSaveLoaded(null);
  assert.deepStrictEqual(H.state().decorations, {});
  H.onSaveLoaded({ home: { decorations: { bonsai: 1 } } });
  assert.strictEqual(H.state().decorations.bonsai, 1);
});

console.log(`家园系统测试全部通过（${passed} 项）`);
