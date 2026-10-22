// 镇妖塔挂机纯逻辑核心测试：node tools/test-idle-core.js
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
    for (const e of run.step()) if (e.type === 'packClear' || e.type === 'death') waves++;
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

test('镇守 5 分钟刷新一次，刷怪不能无限打镇守', () => {
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

test('地图：500 张随机地图都连通，怪群/秘藏/阶梯都能走到', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const floor = 1 + (seed % 40);
    const m = C.generateMap(floor, seed);
    const { dist } = C.distanceField(m, Math.floor(m.entry.x), Math.floor(m.entry.y));
    const reach = p => dist[Math.floor(p.y) * m.cols + Math.floor(p.x)] >= 0;
    assert.ok(reach(m.stairs), 'stairs ' + seed);
    assert.ok(m.packs.length >= 5, 'packs ' + m.packs.length);
    for (const p of m.packs) assert.ok(reach(p), 'pack ' + seed);
    if (m.chest) assert.ok(reach(m.chest), 'chest ' + seed);
    assert.ok(m.cols * m.tile > 240 * 2 && m.rows * m.tile > 400 * 2, '地图比屏幕大');
    assert.strictEqual(m.packs.filter(p => p.kind === 'boss').length, C.isBossFloor(floor) ? 1 : 0);
    assert.ok(m.packs.some(p => p.kind === 'elite'));
  }
});

test('每层妖物固定：只出本段场景的妖，主妖占多数', () => {
  const rng = C.createRng(11);
  for (const floor of [1, 3, 8, 13, 24, 37]) {
    const info = C.floorInfo(floor);
    const count = {};
    for (let i = 0; i < 3000; i++) { const e = C.makeEnemy(floor, rng, { elite: false }); count[e.type] = (count[e.type] || 0) + 1; }
    for (const t of Object.keys(count)) assert.ok(info.types.includes(t), floor + ' ' + t);
    const top = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    assert.strictEqual(top, info.main, '主妖 ' + floor);
  }
  assert.deepStrictEqual(C.floorInfo(1).types, ['melee', 'zombie']);
  assert.strictEqual(C.floorInfo(15).scene.name, '溶洞水牢');
});

test('材料：妖物掉自己的材料，镇守必掉镇守材料', () => {
  const rng = C.createRng(5);
  let got = {};
  for (let i = 0; i < 2000; i++) {
    const m = C.rollMats({ tier: 'normal', type: 'zombie' }, 3, rng);
    for (const k of Object.keys(m)) got[k] = (got[k] || 0) + m[k];
  }
  assert.deepStrictEqual(Object.keys(got), ['shila']);
  assert.ok(got.shila > 300 && got.shila < 600);
  const boss = C.bossFor(4);
  const bm = C.rollMats({ tier: 'boss', type: 'boss', baseName: boss.baseName }, 4, rng);
  assert.ok(bm.baigu >= 1 && bm.guyu >= 1);
});

test('悬赏：击杀/收集/镇守进度累计并完成', () => {
  const rng = C.createRng(3);
  const kinds = new Set();
  for (let i = 0; i < 200; i++) {
    const b = C.makeBounty(12, rng, i);
    kinds.add(b.kind);
    assert.ok(b.floor >= 1 && b.floor <= 12 && b.need > 0 && b.reward.gold > 0);
    const delta = { killsByType: { [b.target]: b.need }, mats: { [b.target]: b.need }, bossKills: { [b.target]: 1 }, elites: b.need };
    C.bountyProgress(b, delta);
    assert.ok(b.done, b.kind);
  }
  assert.deepStrictEqual([...kinds].sort(), ['boss', 'collect', 'elite', 'kill']);
});

test('法器与丹符：费用递增，加成叠加，过期失效', () => {
  const c1 = C.artifactCost('bell', 1), c5 = C.artifactCost('bell', 5);
  assert.ok(c1.shougu < c5.shougu && c1.xuefuyi >= 1 && c5.hantie > 0);
  assert.strictEqual(C.artifactCost('bell', 11), null);
  const m = C.computeMods({ bell: 3, mirror: 2 }, { zhenyao: 1000, yinyao: 50 }, 100);
  assert.strictEqual(m.dmgPct, 12 + 25);
  assert.strictEqual(m.drPct, 4);
  assert.strictEqual(m.eliteMult, 1);
  assert.ok(C.canAfford({ fuzhi: 6, shougu: 3 }, C.RECIPES.zhenyao.cost));
  const more = C.generateMap(6, 9, { eliteMult: 2 }).packs.filter(p => p.kind === 'elite').length;
  const base = C.generateMap(6, 9).packs.filter(p => p.kind === 'elite').length;
  assert.ok(more > base);
});

test('探索：停留本层会清完整张图、开秘藏、走阶梯后重新刷新', () => {
  const run = new C.Run(hero({ damage: [400, 500], maxHp: 3000 }), { seed: 6, floor: 3, autoAdvance: false });
  const firstMap = run.map.uid;
  let clears = 0, chests = 0, moved = 0, lastX = run.hx;
  for (let i = 0; i < 400 / IDLE_CONFIG.DT; i++) {
    for (const e of run.step()) { if (e.type === 'floorClear') { clears++; assert.strictEqual(e.next, 3); } if (e.type === 'chest') chests++; }
    if (Math.abs(run.hx - lastX) > 0.001) moved++;
    lastX = run.hx;
  }
  assert.ok(clears >= 2, 'clears ' + clears);
  assert.ok(chests >= 1);
  assert.ok(moved > 1000, '左右走动');
  assert.notStrictEqual(run.map.uid, firstMap);
  const off = C.offlineSettlement(hero(), { elapsedSec: 3600, floor: 3, seed: 2 });
  assert.ok(Object.keys(off.mats).length > 0 && Object.keys(off.killsByType).length > 0);
});

console.log(`镇妖塔挂机核心测试全部通过（${passed} 项）`);
