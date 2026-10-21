// 地宫挂机纯逻辑核心测试：node tools/test-idle-core.js
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'idle-core.js'));
const { IDLE_CONFIG } = C;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
const hero = (o = {}) => C.buildHeroSnapshot({ lvl: 10, damage: [60, 90], maxHp: 400, armor: 80, critChance: 18, ene: 20, skills: { fireball: 5, thunder: 3, multishot: 1 }, ...o });

test('同一种子结果完全一致（可复现）', () => {
  const a = C.simulate(hero(), { seed: 42, seconds: 300 });
  const b = C.simulate(hero(), { seed: 42, seconds: 300 });
  assert.deepStrictEqual(a, b);
});

test('无画面跑 1000 场战斗（阶段 1 验收）', () => {
  const run = new C.Run(hero(), { seed: 7, floor: 3, autoAdvance: false });
  let waves = 0, steps = 0;
  const t0 = Date.now();
  while (waves < 1000 && steps < 5e6) {
    for (const e of run.step()) if (e.type === 'waveClear' || e.type === 'death') waves++;
    steps++;
  }
  assert.strictEqual(waves, 1000);
  assert.ok(run.stats.kills >= 2000, 'kills ' + run.stats.kills);
  assert.ok(Date.now() - t0 < 5000, '性能');
});

test('快照容错：缺字段的旧角色也能生成', () => {
  const h = C.buildHeroSnapshot({});
  assert.ok(h.maxHp > 0 && h.dmgMax >= h.dmgMin && h.attackInterval > 0);
  assert.deepStrictEqual(C.heroTriggers(h).map(t => t.id), ['golden_bell']);
});

test('惊雷诀：内置冷却内不会重复触发', () => {
  const h = hero({ critChance: 100, skills: { thunder: 10 } });
  const run = new C.Run(h, { seed: 3, floor: 30, autoAdvance: false });
  const times = [];
  for (let i = 0; i < 20 * 60 / IDLE_CONFIG.DT; i++) {
    for (const e of run.step()) if (e.type === 'trigger' && e.id === 'thunder') times.push(run.time);
  }
  assert.ok(times.length > 5);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= C.TRIGGERS.thunder.icd - 1e-6);
});

test('烈焰掌：每 N 次普攻触发一次，清场时蓄力保留', () => {
  const h = hero({ skills: { fireball: 1 }, critChance: 0 });
  const run = new C.Run(h, { seed: 5, floor: 1 });
  let attacks = 0, fire = 0;
  for (let i = 0; i < 2000; i++) for (const e of run.step()) { if (e.type === 'attack') attacks++; if (e.type === 'trigger' && e.id === 'fireball') fire++; }
  assert.ok(fire >= Math.floor(run.attackCount / 4) - 1 && fire <= Math.floor(run.attackCount / 4), `${fire} / ${run.attackCount}`);
  assert.ok(attacks > 20);
});

test('金钟罩低血触发并提供护盾', () => {
  const h = hero({ damage: [1, 1], maxHp: 300, armor: 0, skills: {} });
  const run = new C.Run(h, { seed: 9, floor: 6, autoAdvance: false });
  let shield = null;
  for (let i = 0; i < 20000 && !shield; i++) for (const e of run.step()) if (e.type === 'trigger' && e.id === 'golden_bell') shield = e.shield;
  assert.ok(shield > 0);
});

test('战败退回上一层并停止深入', () => {
  const h = hero({ damage: [1, 2], maxHp: 50, armor: 0, skills: {} });
  const run = new C.Run(h, { seed: 2, floor: 8 });
  let death = null;
  for (let i = 0; i < 20000 && !death; i++) for (const e of run.step()) if (e.type === 'death') death = e;
  assert.ok(death);
  assert.strictEqual(death.to, 7);
  assert.strictEqual(run.autoAdvance, false);
});

test('首领 5 分钟刷新一次，刷怪不能无限打首领', () => {
  const run = new C.Run(hero({ damage: [900, 1000], maxHp: 5000 }), { seed: 4, floor: 2, autoAdvance: false });
  let bossKills = 0;
  for (let i = 0; i < 600 / IDLE_CONFIG.DT; i++) for (const e of run.step()) if (e.type === 'kill' && e.enemy.tier === 'boss') bossKills++;
  assert.ok(bossKills >= 1 && bossKills <= 2, 'bossKills ' + bossKills);
});

test('装备保底：连续掉落必出黄装', () => {
  const rng = () => 0.99; // 永远是最差的品质
  const pity = { rare: 0, unique: 0 };
  const h = hero({ dropRatePct: 10000 });
  const got = [];
  for (let i = 0; i < IDLE_CONFIG.DROP.rarePity; i++) got.push(...C.rollDrops('normal', 1, h, pity, rng));
  assert.strictEqual(got[got.length - 1], C.RARITY.RARE);
  assert.ok(got.slice(0, -1).every(r => r === C.RARITY.NORMAL));
});

test('离线闭关：少于 5 分钟不结算，超过 8 小时按 8 小时', () => {
  assert.strictEqual(C.offlineSettlement(hero(), { elapsedSec: 120, floor: 3 }), null);
  const a = C.offlineSettlement(hero(), { elapsedSec: 8 * 3600, floor: 3, seed: 1 });
  const b = C.offlineSettlement(hero(), { elapsedSec: 30 * 3600, floor: 3, seed: 1 });
  assert.strictEqual(b.capped, true);
  assert.strictEqual(a.gold, b.gold);
  assert.ok(a.kills > 0 && a.xp > 0);
  const online = C.simulate(hero(), { floor: 3, autoAdvance: false, seconds: 900, seed: 1 });
  assert.ok(a.gold < online.stats.gold * 32 * 0.7, '离线效率低于在线');
});

test('越深越难：同一角色在深层会阵亡', () => {
  const shallow = C.simulate(hero(), { floor: 2, autoAdvance: false, seconds: 600, seed: 8 });
  const deep = C.simulate(hero(), { floor: 40, autoAdvance: false, seconds: 600, seed: 8 });
  assert.strictEqual(shallow.stats.deaths, 0);
  assert.ok(deep.stats.deaths > 0);
});

console.log(`地宫挂机核心测试全部通过（${passed} 项）`);
