// ========== idle-core.js - 镇妖塔挂机纯逻辑核心 ==========
// 不依赖 Canvas / DOM / 全局 player：输入角色快照，按固定步长模拟战斗，输出事件。
// 浏览器中挂在 window.IdleCore，Node 中通过 require 使用（tools/test-idle-core.js）。
(function (root) {
  'use strict';

  const IDLE_CONFIG = {
    DT: 0.05,                    // 固定步长（秒）
    MAP: {
      TILE: 32,                  // 渲染用：每格像素
      GRID_COLS: 3, GRID_ROWS: 4, CELL_W: 7, CELL_H: 7,   // 3×4 间石室 -> 22×29 格地图
      ROOM_MIN: 4, ROOM_MAX: 6, SKIP_MIN: 1, SKIP_MAX: 3, EXTRA_LINK: 0.18,
      CHEST_CHANCE: 0.7,         // 死胡同石室出现秘藏宝箱的概率
      HERO_SPEED: 5,             // 每秒移动格数
      ENGAGE_DIST: 2.1           // 走到怪群多近会被缠上
    },
    WALK_HEAL_PER_SEC: 0.035,    // 行进时每秒恢复的生命比例
    MATS: { normalOwn: 0.22, eliteOwn: 1.6, eliteScene: 0.12, bossMat: 1, bossScene: 1.2, chestScene: 0.6, chestCommon: 3 },  // 场景材料稀缺，法器靠它卡进度
    ENEMY_HP_MULT: 1.5,           // 挂机怪物更耐打，控制节奏（约 10 击杀/分钟）
    WALK_HEAL_PCT: 0.08,         // 行进时恢复的生命比例
    REVIVE_TIME: 3,              // 阵亡后调息时间
    ELITE_RATE: 0.1,             // 与主游戏一致
    ENEMY_ATTACK_INTERVAL: 1.7,  // 怪物出手间隔（秒）
    FRONTLINE: 2,                // 同时贴身攻击的近战怪数量，其余近战排队，远程不受限
    BOSS_COOLDOWN: 300,          // 与主游戏一致：同一层镇守 5 分钟刷新一次
    RANGED_DMG_MULT: 0.8,
    BASE_ATTACK_INTERVAL: 0.8,   // 与主游戏一致：0.8 / (1 + 攻速%)
    MEDICINE_PER_FLOOR: 3,       // 每层疗伤药
    MEDICINE_HEAL_PCT: 0.4,
    MEDICINE_THRESHOLD: 0.35,
    MAX_CHAIN: 2,                // 触发器连锁上限：武学触发的伤害最多再触发一层
    XP_EFF: 0.6,                 // 挂机效率（相对手动游玩）
    GOLD_EFF: 0.8,
    OFFLINE_EFF: 0.6,            // 离线闭关效率（相对在线挂机）
    OFFLINE_MAX_HOURS: 8,
    OFFLINE_MIN_MINUTES: 5,
    OFFLINE_SAMPLE_SECONDS: 900, // 离线结算：模拟 15 分钟样本后按比例换算
    DROP: {
      chance: { normal: 0.05, elite: 0.25, boss: 1 },
      bossCount: 2,
      // 品质阈值：roll < unique / rare / magic，其余为普通（自动卖出）
      quality: {
        normal: { unique: 0.002, rare: 0.05, magic: 0.25 },
        elite:  { unique: 0.006, rare: 0.12, magic: 0.5 },
        boss:   { unique: 0.03,  rare: 0.35, magic: 1 }
      },
      depthQualityPerFloor: 0.03, depthQualityMax: 0.6,   // 越深黄装/暗金阈值越高（乘法，最多 ×1.6）
      rarePity: 30,              // 连续 30 件装备没有黄装及以上，下一件必为黄装
      uniquePity: 250            // 连续 250 件装备没有暗金，下一件必为暗金
    }
  };

  // 与 constants.js 的 RARITY 数值一致：1 白 / 2 蓝 / 3 黄 / 4 暗金
  const RARITY = { NORMAL: 1, MAGIC: 2, RARE: 3, UNIQUE: 4 };

  // 镇妖塔妖物：type 与数值沿用 game.js 普通怪物池，只换武侠名（像素图见 idle-art.js）
  const MONSTERS = [
    { type: 'melee',    name: '山魈',       minFloor: 1, hpMult: 1,   dmgMult: 1,   weight: 20, ranged: false },
    { type: 'zombie',   name: '跳尸',       minFloor: 1, hpMult: 1.5, dmgMult: 0.8, weight: 20, ranged: false },
    { type: 'ranged',   name: '纸人',       minFloor: 2, hpMult: 1,   dmgMult: 1,   weight: 20, ranged: true },
    { type: 'skeleton', name: '毒蛛',       minFloor: 2, hpMult: 1,   dmgMult: 1,   weight: 15, ranged: false },
    { type: 'shaman',   name: '狐妖',       minFloor: 3, hpMult: 1,   dmgMult: 1,   weight: 10, ranged: true },
    { type: 'ghost',    name: '游魂',       minFloor: 4, hpMult: 0.6, dmgMult: 1.2, weight: 12, ranged: false },
    { type: 'specter',  name: '鬼火',       minFloor: 5, hpMult: 0.8, dmgMult: 1.4, weight: 10, ranged: true },
    { type: 'mummy',    name: '机关铜人',   minFloor: 6, hpMult: 1.3, dmgMult: 0.9, weight: 10, ranged: false },
    { type: 'vampire',  name: '蛇妖',       minFloor: 7, hpMult: 1.2, dmgMult: 1.3, weight: 10, ranged: true }
  ];

  // 与 enemy-system.js BASE_BOSS_MAP 一致
  const BOSSES = {
    2: { name: '血蝠妖', hp: 400, dmg: 30, xp: 1000 },
    4: { name: '白骨夫人', hp: 1000, dmg: 50, xp: 2000 },
    5: { name: '铜甲尸王', hp: 1400, dmg: 65, xp: 2500 },
    7: { name: '千年树妖', hp: 2800, dmg: 75, xp: 3000 },
    9: { name: '九尾天狐', hp: 5000, dmg: 95, xp: 5000 },
    10: { name: '魔蛟', hp: 6000, dmg: 120, xp: 8000 }
  };

  // 武学触发器：技能从“按快捷键”改为“满足条件自动出招”
  // cond: everyN（每 N 次普攻）/ onCrit（暴击时概率）/ interval（定时）/ hpBelow（低血保命）
  const TRIGGERS = {
    fireball: {
      name: '烈焰掌', skill: 'fireball', color: '#ef7d57', cond: 'everyN',
      n: lv => (lv >= 5 ? 3 : 4),
      ratio: lv => 1.4 + 0.22 * lv, flat: lv => 8 * lv, targets: () => 1, splash: lv => (lv >= 5 ? 0.3 : 0),
      desc: lv => `每 ${lv >= 5 ? 3 : 4} 次普攻打出一掌，造成 ${Math.round((1.4 + 0.22 * lv) * 100)}% 伤害${lv >= 5 ? '，并溅射 30%' : ''}`
    },
    thunder: {
      name: '惊雷诀', skill: 'thunder', color: '#73eff7', cond: 'onCrit', chance: 0.35, icd: 1.2,
      ratio: lv => 0.9 + 0.18 * lv, flat: lv => 6 * lv, targets: lv => 2 + Math.floor(lv / 4),
      desc: lv => `暴击时 35% 引雷，连锁 ${2 + Math.floor(lv / 4)} 个目标，造成 ${Math.round((0.9 + 0.18 * lv) * 100)}% 伤害（内置冷却 1.2 秒）`
    },
    multishot: {
      name: '漫天花雨', skill: 'multishot', color: '#ffcd75', cond: 'interval',
      interval: lv => Math.max(3, 5.5 - lv * 0.2),
      ratio: lv => 0.6 + 0.12 * lv, flat: lv => 5 * lv, targets: () => 99,
      desc: lv => `每 ${Math.max(3, 5.5 - lv * 0.2).toFixed(1)} 秒射出暗器，命中全部敌人，造成 ${Math.round((0.6 + 0.12 * lv) * 100)}% 伤害`
    },
    golden_bell: {
      name: '金钟罩', skill: null, color: '#ffd24d', cond: 'hpBelow', threshold: 0.45, icd: 15,
      shield: lv => 0.2 + 0.03 * lv, duration: 6,
      desc: lv => `气血低于 45% 时护体，获得 ${Math.round((0.2 + 0.03 * lv) * 100)}% 最大生命的护盾，持续 6 秒（冷却 15 秒）`
    }
  };

  // ---------- 随机数 ----------
  function createRng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

  // ---------- 角色快照 ----------
  function buildHeroSnapshot(p) {
    p = p || {};
    const dmg = Array.isArray(p.damage) ? p.damage : [2, 4];
    const skills = p.skills || {};
    const lvl = Math.max(1, num(p.lvl, 1));
    return {
      lvl,
      maxHp: Math.max(1, num(p.maxHp, 100)),
      dmgMin: Math.max(1, num(dmg[0], 2)),
      dmgMax: Math.max(1, num(dmg[1], 4), num(dmg[0], 2)),
      attackInterval: IDLE_CONFIG.BASE_ATTACK_INTERVAL / (1 + Math.max(-50, num(p.attackSpeed)) / 100),
      critChance: Math.max(0, Math.min(100, num(p.critChance, 5))) / 100,
      critMult: 2 + num(p.critDamage) / 100,
      armor: Math.max(0, num(p.armor)),
      lifeSteal: Math.max(0, num(p.lifeSteal)) / 100,
      blockChance: Math.max(0, Math.min(75, num(p.blockChance))) / 100,
      damageReduction: Math.max(0, Math.min(80, num(p.damageReduction))) / 100,
      hpRegen: Math.max(0, num(p.hpRegen)),
      ene: Math.max(0, num(p.ene, 10)),
      goldPct: num(p.goldPct),
      dropRatePct: num(p.dropRatePct),
      skills: {
        fireball: Math.max(0, num(skills.fireball)),
        thunder: Math.max(0, num(skills.thunder)),
        multishot: Math.max(0, num(skills.multishot)),
        golden_bell: 1 + Math.floor(lvl / 10)
      }
    };
  }

  // 已解锁的武学（技能等级 ≥ 1）
  function heroTriggers(hero) {
    return Object.keys(TRIGGERS)
      .map(id => ({ id, def: TRIGGERS[id], lv: hero.skills[id] || 0 }))
      .filter(t => t.lv > 0);
  }

  // ---------- 怪物 ----------
  function baseStats(floor) {
    const f = Math.max(1, floor);
    return {
      hp: 30 + Math.floor(f * f * 5),
      dmg: 5 + f * 2,
      xp: f <= 30 ? Math.floor(25 * Math.pow(1.15, f)) : Math.floor(1656 + (f - 30) * 100)
    };
  }

  function bossFor(floor) {
    const cycle = Math.floor((floor - 1) / 10);
    const cfg = BOSSES[((floor - 1) % 10) + 1];
    if (!cfg) return null;
    let prefix = '';
    if (cycle === 1) prefix = '凶·';
    else if (cycle === 2) prefix = '厉·';
    else if (cycle >= 3) prefix = '魔' + (cycle - 2) + '·';
    return {
      name: prefix + cfg.name, baseName: cfg.name,
      hp: Math.floor(cfg.hp * (1 + cycle * 1.5)),
      dmg: Math.floor(cfg.dmg * (1 + cycle * 0.6)),
      xp: Math.floor(cfg.xp * (1 + cycle))
    };
  }

  function isBossFloor(floor) { return !!bossFor(floor); }

  // ---------- 分段场景与每层妖物 ----------
  // 每段场景有自己的妖物池；每层再固定一种「主妖」占多数——想刷哪种材料，就去对应的层。
  const SCENES = [
    { id: 'tomb',  name: '古墓',     min: 1,  max: 10,       mat: 'guyu',    pool: ['melee', 'zombie', 'ranged', 'skeleton', 'ghost'] },
    { id: 'water', name: '溶洞水牢', min: 11, max: 20,       mat: 'hantie',  pool: ['vampire', 'ghost', 'skeleton', 'shaman', 'specter'] },
    { id: 'lava',  name: '地火熔窟', min: 21, max: 30,       mat: 'huojing', pool: ['mummy', 'specter', 'melee', 'shaman', 'zombie'] },
    { id: 'abyss', name: '九幽',     min: 31, max: Infinity, mat: 'youming', pool: ['ghost', 'specter', 'vampire', 'mummy', 'shaman', 'zombie', 'ranged', 'skeleton', 'melee'] }
  ];
  const MONSTER_BY_TYPE = {};
  for (const m of MONSTERS) MONSTER_BY_TYPE[m.type] = m;

  // ---------- 材料 ----------
  // grade：1 妖物材料（对应妖物掉落）/ 2 场景材料（精英、秘藏、镇守）/ 3 镇守材料
  const MATERIALS = {
    shougu:   { name: '兽骨',     grade: 1, color: '#d8d0b8' },
    shila:    { name: '尸蜡',     grade: 1, color: '#c8c090' },
    fuzhi:    { name: '符纸',     grade: 1, color: '#ffe08a' },
    zhusi:    { name: '蛛丝',     grade: 1, color: '#e8e8f0' },
    humao:    { name: '狐毛',     grade: 1, color: '#ff9e5e' },
    hunjing:  { name: '魂晶',     grade: 1, color: '#9fe0ff' },
    linhuo:   { name: '磷火',     grade: 1, color: '#73eff7' },
    jingtong: { name: '精铜',     grade: 1, color: '#e0a050' },
    shedan:   { name: '蛇胆',     grade: 1, color: '#6fcf6f' },
    guyu:     { name: '古墓玉',   grade: 2, color: '#a7f070' },
    hantie:   { name: '寒铁',     grade: 2, color: '#94b0c2' },
    huojing:  { name: '火精',     grade: 2, color: '#ff6a3d' },
    youming:  { name: '幽冥石',   grade: 2, color: '#c8a0e0' },
    xuefuyi:  { name: '血蝠翼',   grade: 3, color: '#ef7d57' },
    baigu:    { name: '白骨簪',   grade: 3, color: '#f4f4f4' },
    jiapian:  { name: '尸王甲片', grade: 3, color: '#c7a35a' },
    shuxin:   { name: '千年树心', grade: 3, color: '#38b764' },
    huzhu:    { name: '狐火珠',   grade: 3, color: '#ff8a3d' },
    jiaolin:  { name: '蛟鳞',     grade: 3, color: '#41a6f6' }
  };
  const MONSTER_MAT = { melee: 'shougu', zombie: 'shila', ranged: 'fuzhi', skeleton: 'zhusi', shaman: 'humao', ghost: 'hunjing', specter: 'linhuo', mummy: 'jingtong', vampire: 'shedan' };
  const BOSS_MAT = { '血蝠妖': 'xuefuyi', '白骨夫人': 'baigu', '铜甲尸王': 'jiapian', '千年树妖': 'shuxin', '九尾天狐': 'huzhu', '魔蛟': 'jiaolin' };

  function sceneFor(floor) { return SCENES.find(s => floor <= s.max); }

  function floorInfo(floor) {
    floor = Math.max(1, Math.floor(floor) || 1);
    const scene = sceneFor(floor);
    let types = scene.pool.filter(t => MONSTER_BY_TYPE[t] && MONSTER_BY_TYPE[t].minFloor <= floor);
    if (!types.length) types = ['melee'];
    const main = types[(floor - 1) % types.length];
    const weights = types.map(t => ({ type: t, weight: MONSTER_BY_TYPE[t].weight * (t === main ? 4 : 1) }));
    const boss = bossFor(floor);
    return {
      floor, scene, types, main, weights, boss,
      mats: [...new Set(types.map(t => MONSTER_MAT[t]))],
      mainMat: MONSTER_MAT[main], sceneMat: scene.mat,
      bossMat: boss ? BOSS_MAT[boss.baseName] : null
    };
  }

  let enemyUid = 1;
  function makeEnemy(floor, rng, opts = {}) {
    if (opts.boss) {
      const b = bossFor(floor);
      return {
        uid: enemyUid++, type: 'boss', name: b.name, baseName: b.baseName, tier: 'boss',
        hp: b.hp, maxHp: b.hp, dmg: b.dmg, xp: b.xp, ranged: false,
        atkTimer: 0.8 + rng() * 0.6, slot: 0
      };
    }
    let m;
    if (opts.type && MONSTER_BY_TYPE[opts.type]) m = MONSTER_BY_TYPE[opts.type];
    else {
      const pool = floorInfo(floor).weights;
      let roll = rng() * pool.reduce((s, x) => s + x.weight, 0);
      m = MONSTER_BY_TYPE[pool[0].type];
      for (const x of pool) { roll -= x.weight; if (roll <= 0) { m = MONSTER_BY_TYPE[x.type]; break; } }
    }
    const base = baseStats(floor);
    const elite = opts.elite !== undefined ? opts.elite : rng() < IDLE_CONFIG.ELITE_RATE;
    const hp = Math.floor(base.hp * m.hpMult * (elite ? 2.5 : 1) * IDLE_CONFIG.ENEMY_HP_MULT);
    return {
      uid: enemyUid++, type: m.type, name: (elite ? '精英' : '') + m.name, tier: elite ? 'elite' : 'normal',
      hp, maxHp: hp,
      dmg: Math.floor(base.dmg * m.dmgMult * (elite ? 1.4 : 1) * (m.ranged ? IDLE_CONFIG.RANGED_DMG_MULT : 1)),
      xp: Math.floor(base.xp * (elite ? 3 : 1)),
      ranged: m.ranged, atkTimer: 0.6 + rng() * IDLE_CONFIG.ENEMY_ATTACK_INTERVAL, slot: 0
    };
  }

  function addMat(out, id, n) { if (id && n > 0) out[id] = (out[id] || 0) + n; }
  function rollCount(base, mult, rng) { const x = base * mult; const f = Math.floor(x); return f + (rng() < x - f ? 1 : 0); }

  // 击杀掉落材料：返回 { 材料id: 数量 }
  // sceneMult：场景材料额外倍率（等级远高于层数时递减，避免在浅层碾压刷场景材料）
  function rollMats(enemy, floor, rng, matMult = 1, sceneMult = 1) {
    const info = floorInfo(floor), cfg = IDLE_CONFIG.MATS, out = {};
    if (enemy.tier === 'boss') {
      addMat(out, BOSS_MAT[enemy.baseName] || info.bossMat, rollCount(cfg.bossMat, matMult, rng));
      addMat(out, info.sceneMat, rollCount(cfg.bossScene, matMult * sceneMult, rng));
      for (let i = 0; i < 2; i++) addMat(out, info.mats[Math.floor(rng() * info.mats.length)], rollCount(1.5, matMult, rng));
    } else {
      const own = MONSTER_MAT[enemy.type];
      if (enemy.tier === 'elite') {
        addMat(out, own, rollCount(cfg.eliteOwn, matMult, rng));
        if (rng() < cfg.eliteScene * matMult * sceneMult) addMat(out, info.sceneMat, 1);
      } else if (rng() < cfg.normalOwn * matMult) addMat(out, own, 1);
    }
    return out;
  }

  // ---------- 地图：每层一张可探索的竖版地图 ----------
  // 3×4 个格子，每格一间石室，随机去掉几格；生成树连通 + 少量回环走廊。
  // 入口在最上排，下行阶梯在最下排离入口最远的石室；镇守层的阶梯石室就是镇守殿。
  let mapUid = 1;
  function generateMap(floor, seed, opts = {}) {
    const M = IDLE_CONFIG.MAP;
    const rng = createRng(seed);
    const GC = M.GRID_COLS, GR = M.GRID_ROWS, CW = M.CELL_W, CH = M.CELL_H;
    const cols = GC * CW + 1, rows = GR * CH + 1;
    const tiles = new Uint8Array(cols * rows);
    const idx = (x, y) => y * cols + x;
    const cellNeighbors = i => {
      const gx = i % GC, gy = Math.floor(i / GC), out = [];
      if (gx > 0) out.push(i - 1);
      if (gx < GC - 1) out.push(i + 1);
      if (gy > 0) out.push(i - GC);
      if (gy < GR - 1) out.push(i + GC);
      return out;
    };
    const connected = present => {
      const start = present.indexOf(true);
      const seen = new Set([start]), q = [start];
      while (q.length) { const c = q.shift(); for (const n of cellNeighbors(c)) if (present[n] && !seen.has(n)) { seen.add(n); q.push(n); } }
      return seen.size === present.filter(Boolean).length;
    };
    let present = null;
    for (let tries = 0; tries < 30 && !present; tries++) {
      const p = new Array(GC * GR).fill(true);
      const skip = M.SKIP_MIN + Math.floor(rng() * (M.SKIP_MAX - M.SKIP_MIN + 1));
      for (let k = 0; k < skip; k++) p[Math.floor(rng() * GC * GR)] = false;
      if (!p.slice(0, GC).some(Boolean) || !p.slice((GR - 1) * GC).some(Boolean)) continue;
      if (connected(p)) present = p;
    }
    if (!present) present = new Array(GC * GR).fill(true);

    // 石室
    const rooms = new Array(GC * GR).fill(null);
    for (let i = 0; i < GC * GR; i++) {
      if (!present[i]) continue;
      const gx = i % GC, gy = Math.floor(i / GC);
      const w = M.ROOM_MIN + Math.floor(rng() * (Math.min(M.ROOM_MAX, CW - 1) - M.ROOM_MIN + 1));
      const h = M.ROOM_MIN + Math.floor(rng() * (Math.min(M.ROOM_MAX, CH - 1) - M.ROOM_MIN + 1));
      const x = gx * CW + 1 + Math.floor(rng() * (CW - 1 - w + 1));
      const y = gy * CH + 1 + Math.floor(rng() * (CH - 1 - h + 1));
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) tiles[idx(xx, yy)] = 1;
      rooms[i] = { id: i, gx, gy, x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2), links: [] };
    }
    const carve = (a, b) => {
      let x = a.cx, y = a.cy;
      const horizFirst = rng() < 0.5;
      const stepX = () => { while (x !== b.cx) { tiles[idx(x, y)] = 1; x += Math.sign(b.cx - x); } };
      const stepY = () => { while (y !== b.cy) { tiles[idx(x, y)] = 1; y += Math.sign(b.cy - y); } };
      if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
      tiles[idx(x, y)] = 1;
      a.links.push(b.id); b.links.push(a.id);
    };
    // 随机生成树
    const live = rooms.filter(Boolean);
    const visited = new Set();
    const stack = [live[Math.floor(rng() * live.length)].id];
    visited.add(stack[0]);
    while (stack.length) {
      const c = stack[stack.length - 1];
      const opts2 = cellNeighbors(c).filter(n => rooms[n] && !visited.has(n));
      if (!opts2.length) { stack.pop(); continue; }
      const n = opts2[Math.floor(rng() * opts2.length)];
      carve(rooms[c], rooms[n]);
      visited.add(n);
      stack.push(n);
    }
    // 少量回环
    for (const r of live) for (const n of cellNeighbors(r.id)) {
      if (n > r.id && rooms[n] && !r.links.includes(n) && rng() < M.EXTRA_LINK) carve(r, rooms[n]);
    }

    // 入口 / 阶梯
    const top = live.filter(r => r.gy === 0);
    const entryRoom = top[Math.floor(rng() * top.length)];
    const depth = new Map([[entryRoom.id, 0]]);
    const q = [entryRoom.id];
    while (q.length) { const c = q.shift(); for (const n of rooms[c].links) if (!depth.has(n)) { depth.set(n, depth.get(c) + 1); q.push(n); } }
    const bottom = live.filter(r => r.gy === GR - 1).sort((a, b) => depth.get(b.id) - depth.get(a.id));
    const stairsRoom = bottom[0];

    const info = floorInfo(floor);
    const packs = [];
    let pid = 1;
    const spot = (r, cx, cy) => ({
      x: Math.max(r.x + 0.8, Math.min(r.x + r.w - 0.8, cx)),
      y: Math.max(r.y + 0.8, Math.min(r.y + r.h - 0.8, cy))
    });
    const makePack = (r, kind, pos) => {
      const enemies = [];
      if (kind === 'boss') {
        enemies.push(makeEnemy(floor, rng, { boss: true }));
        enemies.push(makeEnemy(floor, rng, { elite: false }), makeEnemy(floor, rng, { elite: false }));
      } else {
        let count = 2 + (rng() < 0.5 ? 1 : 0) + (floor >= 5 && rng() < 0.3 ? 1 : 0);
        if (kind === 'elite') {
          enemies.push(makeEnemy(floor, rng, { elite: true }));
          count = Math.max(2, count);
        }
        for (let i = enemies.length; i < count + (kind === 'elite' ? 1 : 0); i++) enemies.push(makeEnemy(floor, rng));
      }
      enemies.forEach((e, i) => { e.slot = i; });
      const pack = { id: pid++, room: r.id, kind, x: pos.x, y: pos.y, enemies, cleared: false };
      packs.push(pack);
      return pack;
    };
    for (const r of live) {
      if (r === entryRoom) continue;
      if (r === stairsRoom) {
        const pos = spot(r, r.cx + 0.5, r.cy);
        if (info.boss) makePack(r, opts.bossReady === false ? 'elite' : 'boss', pos);
        else makePack(r, 'normal', pos);
        continue;
      }
      const n = (r.w * r.h >= 25 && rng() < 0.35) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const pos = n === 1 ? spot(r, r.cx + 0.5 + (rng() - 0.5), r.cy + 0.5 + (rng() - 0.5))
          : spot(r, r.x + (k === 0 ? 1.3 : r.w - 1.3), r.y + 1.3 + rng() * (r.h - 2.6));
        makePack(r, 'normal', pos);
      }
    }
    // 精英怪群：由一只精英带队
    const eliteCount = Math.round((1 + (floor >= 5 ? 1 : 0)) * Math.max(0, opts.eliteMult || 1));
    const normalPacks = packs.filter(p => p.kind === 'normal');
    for (let k = 0; k < eliteCount && normalPacks.length; k++) {
      const p = normalPacks.splice(Math.floor(rng() * normalPacks.length), 1)[0];
      p.kind = 'elite';
      p.enemies[0] = makeEnemy(floor, rng, { elite: true });
      p.enemies.push(makeEnemy(floor, rng));
      p.enemies.forEach((e, i) => { e.slot = i; });
    }
    // 秘藏宝箱：放在死胡同石室
    let chest = null;
    const dead = live.filter(r => r !== entryRoom && r !== stairsRoom && r.links.length === 1);
    if (dead.length && rng() < M.CHEST_CHANCE) {
      const r = dead[Math.floor(rng() * dead.length)];
      chest = { x: r.x + (rng() < 0.5 ? 0.5 : r.w - 0.5), y: r.y + 0.5, room: r.id, opened: false };
    }
    return {
      uid: mapUid++, floor, seed, cols, rows, tiles, tile: M.TILE,
      rooms: live, entry: { x: entryRoom.cx + 0.5, y: entryRoom.y + 0.5, room: entryRoom.id },
      stairs: { x: stairsRoom.cx + 0.5, y: stairsRoom.y + stairsRoom.h - 0.5, room: stairsRoom.id },
      packs, chest, scene: info.scene.id
    };
  }

  function walkable(map, x, y) { return x >= 0 && y >= 0 && x < map.cols && y < map.rows && map.tiles[y * map.cols + x] === 1; }

  // 从 (sx,sy) 出发的距离场（4 邻接 BFS），返回 { dist, prev }
  function distanceField(map, sx, sy) {
    const n = map.cols * map.rows;
    const dist = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
    const s = sy * map.cols + sx;
    dist[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % map.cols, y = (c - x) / map.cols;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!walkable(map, nx, ny)) continue;
        const ni = ny * map.cols + nx;
        if (dist[ni] >= 0) continue;
        dist[ni] = dist[c] + 1; prev[ni] = c; q.push(ni);
      }
    }
    return { dist, prev };
  }

  // ---------- 炼制 / 法器 / 悬赏 ----------
  const RECIPES = {
    zhenyao: { name: '镇妖符',   cost: { fuzhi: 6, shougu: 3 },               minutes: 30, buff: { dmgPct: 25 },               desc: '30 分钟内塔中伤害 +25%' },
    huichun: { name: '回春丹',   cost: { shila: 4, zhusi: 3 },                minutes: 30, buff: { medicine: 2, drPct: 5 },    desc: '30 分钟内每层疗伤药 +2，受到伤害 -5%' },
    yinyao:  { name: '引妖香',   cost: { humao: 4, hunjing: 3 },              minutes: 30, buff: { eliteMult: 2 },             desc: '30 分钟内每层精英怪群翻倍' },
    xunbao:  { name: '寻宝罗盘', cost: { jingtong: 4, shedan: 3, linhuo: 3 }, minutes: 30, buff: { dropPct: 60, matPct: 50 }, desc: '30 分钟内装备掉率 +60%，材料 +50%' }
  };
  const ARTIFACTS = {
    bell:   { name: '镇妖铃',   max: 10, common: 'shougu', per: { dmgPct: 4 },             desc: lv => `塔中伤害 +${lv * 4}%` },
    mirror: { name: '护心镜',   max: 10, common: 'zhusi',  per: { drPct: 2 },              desc: lv => `塔中受到伤害 -${lv * 2}%` },
    gourd:  { name: '聚宝葫芦', max: 10, common: 'shila',  per: { matPct: 8, dropPct: 5 }, desc: lv => `材料 +${lv * 8}%，装备掉率 +${lv * 5}%` }
  };
  const ARTIFACT_BOSS_MAT = ['xuefuyi', 'xuefuyi', 'baigu', 'baigu', 'jiapian', 'jiapian', 'shuxin', 'shuxin', 'huzhu', 'jiaolin'];
  function artifactCost(id, nextLv) {
    const a = ARTIFACTS[id];
    if (!a || nextLv < 1 || nextLv > a.max) return null;
    const scene = nextLv <= 3 ? 'guyu' : nextLv <= 6 ? 'hantie' : nextLv <= 8 ? 'huojing' : 'youming';
    const cost = {};
    addMat(cost, a.common, 4 * nextLv);
    addMat(cost, scene, 2 + nextLv * 2);
    addMat(cost, ARTIFACT_BOSS_MAT[nextLv - 1], Math.ceil(nextLv / 2));
    return cost;
  }
  function canAfford(mats, cost) { return Object.keys(cost).every(k => (mats[k] || 0) >= cost[k]); }

  // 法器等级 + 生效中的丹符 -> 塔内加成
  function computeMods(artifacts = {}, buffs = {}, now = 0) {
    const m = { dmgPct: 0, drPct: 0, dropPct: 0, matPct: 0, eliteMult: 1, medicine: 0 };
    const add = (per, k) => { for (const key of Object.keys(per)) { if (key === 'eliteMult') m.eliteMult *= per[key]; else m[key] += per[key] * k; } };
    for (const id of Object.keys(ARTIFACTS)) if (artifacts[id] > 0) add(ARTIFACTS[id].per, artifacts[id]);
    for (const id of Object.keys(RECIPES)) if ((buffs[id] || 0) > now) add(RECIPES[id].buff, 1);
    return m;
  }

  // 悬赏：目标层不超过已到达的最深层，奖励随目标层增长
  function makeBounty(maxFloor, rng, id) {
    const top = Math.max(1, maxFloor);
    const kinds = ['kill', 'kill', 'collect', 'collect', 'elite'];
    const bossFloors = [];
    for (let f = 1; f <= top; f++) if (isBossFloor(f)) bossFloors.push(f);
    if (bossFloors.length) kinds.push('boss');
    const kind = kinds[Math.floor(rng() * kinds.length)];
    let floor = Math.max(1, top - Math.floor(rng() * Math.min(top, 6)));
    let target = null, need = 1;
    if (kind === 'kill') { target = floorInfo(floor).main; need = 15 + Math.floor(rng() * 4) * 5; }
    else if (kind === 'collect') { target = floorInfo(floor).mainMat; need = 4 + Math.floor(rng() * 4) * 2; }
    else if (kind === 'elite') { need = 4 + Math.floor(rng() * 3); }
    else { floor = bossFloors[Math.floor(rng() * bossFloors.length)]; target = bossFor(floor).baseName; need = 1; }
    const base = baseStats(floor);
    const big = kind === 'boss' || kind === 'elite';
    const reward = {
      gold: Math.floor((10 + floor * 5) * (big ? 40 : 25)),
      xp: Math.floor(base.xp * (big ? 8 : 5) * IDLE_CONFIG.XP_EFF),
      mats: { [floorInfo(floor).sceneMat]: big ? 3 : 1 },
      item: big || rng() < 0.3 ? RARITY.RARE : RARITY.MAGIC
    };
    return { id, kind, target, need, have: 0, floor, reward, done: false };
  }

  // delta：{ killsByType, mats, bossKills, elites }，在线逐次击杀和离线结算共用
  function bountyProgress(b, delta) {
    if (!b || b.done) return false;
    let add = 0;
    if (b.kind === 'kill') add = (delta.killsByType || {})[b.target] || 0;
    else if (b.kind === 'collect') add = (delta.mats || {})[b.target] || 0;
    else if (b.kind === 'elite') add = delta.elites || 0;
    else if (b.kind === 'boss') add = (delta.bossKills || {})[b.target] || 0;
    if (!add) return false;
    b.have = Math.min(b.need, b.have + add);
    if (b.have >= b.need) b.done = true;
    return true;
  }

  // ---------- 奖励 ----------
  function xpLevelMultiplier(lvl, floor) {
    const diff = lvl - floor * 2;
    if (diff > 5) return Math.max(0.1, 1 - (diff - 5) * 0.15);
    if (diff < -5) return Math.min(1.3, 1 + Math.abs(diff + 5) * 0.05);
    return 1;
  }

  function killGold(floor, tier, hero, rng) {
    const base = 10 + floor * 5;
    let g = base + rng() * base;
    if (tier === 'boss') g *= 3; else if (tier === 'elite') g *= 1.5;
    return Math.floor(g * (1 + hero.goldPct / 100) * IDLE_CONFIG.GOLD_EFF);
  }

  function killXp(enemy, floor, hero) {
    return Math.floor(enemy.xp * xpLevelMultiplier(hero.lvl, floor) * IDLE_CONFIG.XP_EFF);
  }

  // 返回本次击杀掉落的装备品质列表（不生成具体装备，交给游戏侧）
  function rollDrops(tier, floor, hero, pity, rng) {
    const cfg = IDLE_CONFIG.DROP;
    const out = [];
    const count = tier === 'boss' ? cfg.bossCount : 1;
    const chance = Math.min(1, cfg.chance[tier] * (1 + hero.dropRatePct / 100));
    const qBonus = Math.min(cfg.depthQualityMax, floor * cfg.depthQualityPerFloor);
    for (let i = 0; i < count; i++) {
      if (rng() >= chance) continue;
      pity.rare = (pity.rare || 0) + 1;
      pity.unique = (pity.unique || 0) + 1;
      const q = cfg.quality[tier];
      const roll = rng();
      const qm = 1 + qBonus;
      let r = roll < q.unique * qm ? RARITY.UNIQUE : roll < q.rare * qm ? RARITY.RARE : roll < Math.min(1, q.magic * qm) ? RARITY.MAGIC : RARITY.NORMAL;
      if (r < RARITY.UNIQUE && pity.unique >= cfg.uniquePity) r = RARITY.UNIQUE;
      if (r < RARITY.RARE && pity.rare >= cfg.rarePity) r = RARITY.RARE;
      if (r >= RARITY.RARE) pity.rare = 0;
      if (r === RARITY.UNIQUE) pity.unique = 0;
      out.push(r);
    }
    return out;
  }

  // ---------- 战斗模拟 ----------
  // 一次镇妖塔挂机会话。step() 推进固定步长并返回事件，渲染层只消费事件。
  // 每层是一张地图：主角在石室与走廊间自动寻路，逐个清理怪群、开秘藏，最后走下行阶梯。
  class Run {
    constructor(heroSnapshot, opts = {}) {
      this.rng = opts.rng || createRng(opts.seed || 1);
      this.hero = heroSnapshot;
      this.floor = Math.max(1, opts.floor || 1);
      this.maxFloor = Math.max(this.floor, opts.maxFloor || 1);
      this.autoAdvance = opts.autoAdvance !== false;
      this.pity = opts.pity || { rare: 0, unique: 0 };
      this.mods = computeMods();
      if (opts.mods) this.setMods(opts.mods);
      this.time = 0;
      this.hp = heroSnapshot.maxHp;
      this.shield = 0;
      this.shieldTimer = 0;
      this.enemies = [];
      this.attackTimer = 0;
      this.attackCount = 0;
      this.cooldowns = {};       // 触发器剩余冷却
      this.intervalTimers = {};  // 定时触发器计时
      this.charges = {};         // 每 N 次普攻类触发器的蓄力
      this.stats = {
        kills: 0, deaths: 0, xp: 0, gold: 0, drops: [0, 0, 0, 0, 0], floorsCleared: 0, damage: 0, triggers: {},
        killsByTier: { normal: 0, elite: 0, boss: 0 }, killsByType: {}, bossKills: {}, mats: {}, packs: 0, chests: 0
      };
      this.events = [];
      this.bossRespawn = opts.bossRespawn || {};  // floor -> 可再次出现的模拟时间
      this.facing = 1;
      this.enterFloor(this.floor);
    }

    setHero(snapshot) {
      const ratio = this.hp / this.hero.maxHp;
      this.hero = snapshot;
      this.hp = Math.max(1, Math.min(snapshot.maxHp, Math.round(snapshot.maxHp * ratio)));
    }

    setMods(m) { this.mods = Object.assign(computeMods(), m || {}); }

    emit(e) { this.events.push(e); }

    alive() { return this.enemies.filter(e => e.hp > 0); }

    packsLeft() { return this.map.packs.filter(p => !p.cleared).length; }

    // 进入某层：生成新地图，主角站在入口
    enterFloor(floor) {
      this.floor = Math.max(1, floor);
      const bossReady = this.time >= (this.bossRespawn[this.floor] || 0);
      this.map = generateMap(this.floor, Math.floor(this.rng() * 2147483647), { bossReady, eliteMult: this.mods.eliteMult });
      this.hx = this.map.entry.x;
      this.hy = this.map.entry.y;
      this.path = null;
      this.goal = null;
      this.pack = null;
      this.enemies = [];
      this.medicine = IDLE_CONFIG.MEDICINE_PER_FLOOR + (this.mods.medicine || 0);
      this.phase = 'walk';
      this.phaseTimer = 0.6;
      this.emit({ type: 'map', floor: this.floor, map: this.map });
    }

    // 手动换层（退层 / 前往某层）
    changeFloor(floor) {
      this.enterFloor(Math.max(1, Math.min(this.maxFloor, floor)));
    }

    step(dt = IDLE_CONFIG.DT) {
      this.events = [];
      this.time += dt;
      for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
      if (this.shieldTimer > 0) {
        this.shieldTimer -= dt;
        if (this.shieldTimer <= 0) this.shield = 0;
      }
      if (this.phase === 'walk') this.stepWalk(dt);
      else if (this.phase === 'fight') this.stepFight(dt);
      else if (this.phase === 'dead') this.stepDead(dt);
      else if (this.phase === 'descend') this.stepDescend(dt);
      return this.events;
    }

    distTo(p) { return Math.hypot(p.x - this.hx, p.y - this.hy); }

    // 选下一个目标：最近的未清理怪群 / 未开启的秘藏，都没有了就去下行阶梯
    planPath() {
      const map = this.map;
      const sx = Math.floor(this.hx), sy = Math.floor(this.hy);
      const { dist, prev } = distanceField(map, sx, sy);
      const goals = map.packs.filter(p => !p.cleared).map(p => ({ kind: 'pack', ref: p, x: p.x, y: p.y }));
      if (map.chest && !map.chest.opened) goals.push({ kind: 'chest', ref: map.chest, x: map.chest.x, y: map.chest.y });
      let best = null, bestD = Infinity;
      for (const g of goals) {
        const d = dist[Math.floor(g.y) * map.cols + Math.floor(g.x)];
        if (d >= 0 && d < bestD) { bestD = d; best = g; }
      }
      if (!best) best = { kind: 'stairs', ref: map.stairs, x: map.stairs.x, y: map.stairs.y };
      const ti = Math.floor(best.y) * map.cols + Math.floor(best.x);
      const path = [];
      if (dist[ti] >= 0) {
        for (let c = ti; c !== -1 && c !== sy * map.cols + sx; c = prev[c]) path.push({ x: (c % map.cols) + 0.5, y: Math.floor(c / map.cols) + 0.5 });
        path.reverse();
      }
      if (path.length) path[path.length - 1] = { x: best.x, y: best.y };
      else path.push({ x: best.x, y: best.y });
      this.goal = best;
      this.path = path;
    }

    stepWalk(dt) {
      this.hp = Math.min(this.hero.maxHp, this.hp + this.hero.maxHp * IDLE_CONFIG.WALK_HEAL_PER_SEC * dt);
      if (this.phaseTimer > 0) { this.phaseTimer -= dt; return; }
      const M = IDLE_CONFIG.MAP;
      // 走近任何未清理的怪群都会被缠上
      for (const p of this.map.packs) {
        if (!p.cleared && this.distTo(p) < M.ENGAGE_DIST) { this.engage(p); return; }
      }
      const chest = this.map.chest;
      if (chest && !chest.opened && this.distTo(chest) < 0.6) { this.openChest(); return; }
      if (!this.path || !this.path.length) {
        if (this.goal && this.goal.kind === 'stairs' && this.distTo(this.map.stairs) < 0.6) { this.takeStairs(); return; }
        this.planPath();
      }
      let left = M.HERO_SPEED * dt;
      while (left > 0 && this.path.length) {
        const n = this.path[0];
        const dx = n.x - this.hx, dy = n.y - this.hy, d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.01) this.facing = dx > 0 ? 1 : -1;
        if (d <= left) { this.hx = n.x; this.hy = n.y; this.path.shift(); left -= d; }
        else { this.hx += dx / d * left; this.hy += dy / d * left; left = 0; }
      }
    }

    engage(pack) {
      this.pack = pack;
      this.enemies = pack.enemies;
      this.phase = 'fight';
      this.attackTimer = 0.2;
      this.path = null;
      if (Math.abs(pack.x - this.hx) > 0.1) this.facing = pack.x > this.hx ? 1 : -1;
      this.emit({ type: 'engage', floor: this.floor, pack: pack.id, kind: pack.kind, enemies: this.enemies.slice() });
    }

    openChest() {
      const chest = this.map.chest;
      chest.opened = true;
      const info = floorInfo(this.floor), mult = 1 + this.mods.matPct / 100, cfg = IDLE_CONFIG.MATS;
      const gold = killGold(this.floor, 'elite', this.hero, this.rng) * 4;
      const mats = {};
      addMat(mats, info.sceneMat, rollCount(cfg.chestScene, mult * this.sceneMult(), this.rng));
      for (let i = 0; i < 3; i++) addMat(mats, info.mats[Math.floor(this.rng() * info.mats.length)], rollCount(cfg.chestCommon / 3, mult, this.rng));
      const drops = rollDrops('elite', this.floor, this.dropHero(), this.pity, this.rng).concat(rollDrops('elite', this.floor, this.dropHero(), this.pity, this.rng));
      this.stats.chests++;
      this.stats.gold += gold;
      for (const r of drops) this.stats.drops[r]++;
      for (const k of Object.keys(mats)) addMat(this.stats.mats, k, mats[k]);
      this.path = null;
      this.phaseTimer = 0.5;
      this.emit({ type: 'chest', floor: this.floor, x: chest.x, y: chest.y, gold, drops, mats });
    }

    takeStairs() {
      this.stats.floorsCleared++;
      const cleared = this.floor;
      this.nextFloor = this.autoAdvance ? this.floor + 1 : this.floor;
      if (this.nextFloor > this.maxFloor) this.maxFloor = this.nextFloor;
      this.phase = 'descend';
      this.phaseTimer = 0.8;
      this.emit({ type: 'floorClear', floor: cleared, next: this.nextFloor, maxFloor: this.maxFloor, stay: !this.autoAdvance });
    }

    stepDescend(dt) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.enterFloor(this.nextFloor);
    }

    stepDead(dt) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.hp = this.hero.maxHp;
        this.enterFloor(this.floor);
        this.emit({ type: 'revive', floor: this.floor });
      }
    }

    stepFight(dt) {
      const h = this.hero;
      if (h.hpRegen > 0) this.hp = Math.min(h.maxHp, this.hp + h.hpRegen * dt);

      // 定时武学
      for (const t of heroTriggers(h)) {
        if (t.def.cond !== 'interval') continue;
        this.intervalTimers[t.id] = (this.intervalTimers[t.id] || 0) + dt;
        if (this.intervalTimers[t.id] >= t.def.interval(t.lv)) {
          this.intervalTimers[t.id] = 0;
          this.castDamageTrigger(t, 0);
        }
      }

      // 普攻
      this.attackTimer -= dt;
      if (this.attackTimer <= 0 && this.alive().length) {
        this.attackTimer += h.attackInterval;
        this.attackCount++;
        const target = this.alive()[0];
        const res = this.hit(target, this.rollBase(), 'basic', 0);
        this.emit({ type: 'attack', target: target.uid, dmg: res.dmg, crit: res.crit });
        for (const t of heroTriggers(h)) {
          if (t.def.cond !== 'everyN') continue;
          // 蓄力计数：目标已全灭时保留到下一次普攻，不浪费
          this.charges[t.id] = (this.charges[t.id] || 0) + 1;
          if (this.charges[t.id] >= t.def.n(t.lv) && this.alive().length) {
            this.charges[t.id] = 0;
            this.castDamageTrigger(t, 1);
          }
        }
      }

      // 怪物出手：近战只有前排能贴身，远程都能出手
      let melee = 0;
      for (const e of this.alive()) {
        if (!e.ranged && melee++ >= IDLE_CONFIG.FRONTLINE) continue;
        e.atkTimer -= dt;
        if (e.atkTimer > 0) continue;
        e.atkTimer += IDLE_CONFIG.ENEMY_ATTACK_INTERVAL * (e.tier === 'boss' ? 1.2 : 1) * (0.85 + this.rng() * 0.3);
        this.takeHit(e);
        if (this.phase !== 'fight') return;
      }

      if (!this.alive().length) this.clearPack();
    }

    rollBase() {
      const h = this.hero;
      return h.dmgMin + this.rng() * (h.dmgMax - h.dmgMin);
    }

    sceneMult() { return Math.min(1, xpLevelMultiplier(this.hero.lvl, this.floor)); }

    dropHero() {
      return this.mods.dropPct ? Object.assign({}, this.hero, { dropRatePct: this.hero.dropRatePct + this.mods.dropPct }) : this.hero;
    }

    // chain：0 = 普攻/定时武学，1+ = 由其他命中触发
    hit(target, raw, source, chain) {
      const h = this.hero;
      const crit = this.rng() < h.critChance;
      const dmg = Math.max(1, Math.round(raw * (crit ? h.critMult : 1) * (1 + this.mods.dmgPct / 100)));
      const dealt = Math.min(target.hp, dmg);
      target.hp -= dmg;
      this.stats.damage += dealt;
      if (h.lifeSteal > 0 && source === 'basic') this.hp = Math.min(h.maxHp, this.hp + dealt * h.lifeSteal);
      if (target.hp <= 0) this.onKill(target, source);
      if (crit && chain < IDLE_CONFIG.MAX_CHAIN) {
        for (const t of heroTriggers(h)) {
          if (t.def.cond !== 'onCrit' || t.id === source) continue;
          if ((this.cooldowns[t.id] || 0) > 0) continue;
          if (this.rng() < t.def.chance) {
            this.cooldowns[t.id] = t.def.icd;
            this.castDamageTrigger(t, chain + 1);
          }
        }
      }
      return { dmg, crit };
    }

    castDamageTrigger(t, chain) {
      const def = t.def, lv = t.lv;
      const targets = this.alive().slice(0, def.targets(lv));
      if (!targets.length) return;
      const avg = (this.hero.dmgMin + this.hero.dmgMax) / 2;
      const enePower = 1 + this.hero.ene * 0.01;
      const raw = (avg * def.ratio(lv) + def.flat(lv)) * enePower;
      this.stats.triggers[t.id] = (this.stats.triggers[t.id] || 0) + 1;
      const hits = [];
      for (const target of targets) {
        if (target.hp <= 0) continue;
        const r = this.hit(target, raw * (0.9 + this.rng() * 0.2), t.id, chain);
        hits.push({ target: target.uid, dmg: r.dmg, crit: r.crit });
      }
      const splash = def.splash ? def.splash(lv) : 0;
      if (splash > 0) {
        for (const other of this.alive()) {
          if (targets.includes(other)) continue;
          const r = this.hit(other, raw * splash, t.id, IDLE_CONFIG.MAX_CHAIN);
          hits.push({ target: other.uid, dmg: r.dmg, crit: r.crit, splash: true });
        }
      }
      this.emit({ type: 'trigger', id: t.id, name: def.name, color: def.color, hits });
    }

    takeHit(e) {
      const h = this.hero;
      if (this.rng() < h.blockChance) { this.emit({ type: 'block', source: e.uid }); return; }
      let dmg = e.dmg * (0.9 + this.rng() * 0.2);
      dmg *= 1 - h.armor / (h.armor + 100);
      dmg *= 1 - Math.min(0.85, h.damageReduction + this.mods.drPct / 100);
      dmg = Math.max(1, Math.round(dmg));
      if (this.shield > 0) {
        const absorbed = Math.min(this.shield, dmg);
        this.shield -= absorbed;
        dmg -= absorbed;
      }
      this.hp -= dmg;
      this.emit({ type: 'heroHit', source: e.uid, dmg, ranged: e.ranged });

      // 金钟罩
      const bell = heroTriggers(h).find(t => t.def.cond === 'hpBelow');
      if (bell && this.hp > 0 && this.hp < h.maxHp * bell.def.threshold && !(this.cooldowns[bell.id] > 0)) {
        this.cooldowns[bell.id] = bell.def.icd;
        this.shield = Math.round(h.maxHp * bell.def.shield(bell.lv));
        this.shieldTimer = bell.def.duration;
        this.stats.triggers[bell.id] = (this.stats.triggers[bell.id] || 0) + 1;
        this.emit({ type: 'trigger', id: bell.id, name: bell.def.name, color: bell.def.color, shield: this.shield, hits: [] });
      }
      // 疗伤药
      if (this.hp > 0 && this.hp < h.maxHp * IDLE_CONFIG.MEDICINE_THRESHOLD && this.medicine > 0) {
        this.medicine--;
        this.hp = Math.min(h.maxHp, this.hp + h.maxHp * IDLE_CONFIG.MEDICINE_HEAL_PCT);
        this.emit({ type: 'medicine', left: this.medicine });
      }
      if (this.hp <= 0) this.die();
    }

    onKill(enemy, source) {
      if (enemy.tier === 'boss') {
        this.bossRespawn[this.floor] = this.time + IDLE_CONFIG.BOSS_COOLDOWN;
        this.stats.bossKills[enemy.baseName] = (this.stats.bossKills[enemy.baseName] || 0) + 1;
      } else {
        this.stats.killsByType[enemy.type] = (this.stats.killsByType[enemy.type] || 0) + 1;
      }
      const xp = killXp(enemy, this.floor, this.hero);
      const gold = killGold(this.floor, enemy.tier, this.hero, this.rng);
      const drops = rollDrops(enemy.tier, this.floor, this.dropHero(), this.pity, this.rng);
      const mats = rollMats(enemy, this.floor, this.rng, 1 + this.mods.matPct / 100, this.sceneMult());
      this.stats.kills++;
      this.stats.killsByTier[enemy.tier]++;
      this.stats.xp += xp;
      this.stats.gold += gold;
      for (const r of drops) this.stats.drops[r]++;
      for (const k of Object.keys(mats)) addMat(this.stats.mats, k, mats[k]);
      this.emit({ type: 'kill', enemy: { uid: enemy.uid, name: enemy.name, baseName: enemy.baseName, tier: enemy.tier, type: enemy.type }, floor: this.floor, xp, gold, drops, mats, source });
    }

    clearPack() {
      const pack = this.pack;
      if (pack) pack.cleared = true;
      this.stats.packs++;
      this.emit({ type: 'packClear', floor: this.floor, pack: pack ? pack.id : 0, kind: pack ? pack.kind : 'normal', left: this.packsLeft() });
      this.pack = null;
      this.enemies = [];
      this.phase = 'walk';
      this.phaseTimer = 0.3;
      this.path = null;
    }

    die() {
      this.hp = 0;
      this.stats.deaths++;
      const from = this.floor;
      // 战败：退回上一层并停留刷怪，避免卡在打不过的层反复阵亡
      this.floor = Math.max(1, this.floor - 1);
      this.autoAdvance = false;
      this.enemies = [];
      this.pack = null;
      this.shield = 0;
      this.phase = 'dead';
      this.phaseTimer = IDLE_CONFIG.REVIVE_TIME;
      this.emit({ type: 'death', from, to: this.floor });
    }
  }

  // 无画面快速模拟：用于测试、数值平衡和离线结算
  function simulate(heroSnapshot, opts = {}) {
    const run = new Run(heroSnapshot, opts);
    const seconds = opts.seconds || 600;
    const steps = Math.ceil(seconds / IDLE_CONFIG.DT);
    for (let i = 0; i < steps; i++) run.step(IDLE_CONFIG.DT);
    return { stats: run.stats, floor: run.floor, maxFloor: run.maxFloor, pity: run.pity, seconds };
  }

  // 离线闭关：在当前层停留刷怪，模拟样本后按比例换算
  function offlineSettlement(heroSnapshot, opts = {}) {
    const elapsedSec = Math.max(0, opts.elapsedSec || 0);
    if (elapsedSec < IDLE_CONFIG.OFFLINE_MIN_MINUTES * 60) return null;
    const effective = Math.min(elapsedSec, IDLE_CONFIG.OFFLINE_MAX_HOURS * 3600);
    const sample = Math.min(effective, IDLE_CONFIG.OFFLINE_SAMPLE_SECONDS);
    const pity = { ...(opts.pity || { rare: 0, unique: 0 }) };
    const res = simulate(heroSnapshot, { floor: opts.floor || 1, maxFloor: opts.floor || 1, autoAdvance: false, seconds: sample, seed: opts.seed, pity, mods: opts.mods });
    const scale = (effective / sample) * IDLE_CONFIG.OFFLINE_EFF;
    const rng = createRng((opts.seed || 7) + 13);
    const scaleCount = n => { const x = n * scale; const f = Math.floor(x); return f + (rng() < x - f ? 1 : 0); };
    const scaleMap = o => { const out = {}; for (const k of Object.keys(o)) { const v = scaleCount(o[k]); if (v > 0) out[k] = v; } return out; };
    return {
      elapsedSec, effectiveSec: effective, capped: elapsedSec > effective,
      floor: res.floor,
      kills: scaleCount(res.stats.kills),
      killsByTier: { normal: scaleCount(res.stats.killsByTier.normal), elite: scaleCount(res.stats.killsByTier.elite), boss: scaleCount(res.stats.killsByTier.boss) },
      killsByType: scaleMap(res.stats.killsByType),
      bossKills: scaleMap(res.stats.bossKills),
      mats: scaleMap(res.stats.mats),
      chests: scaleCount(res.stats.chests),
      deaths: res.stats.deaths,
      xp: Math.floor(res.stats.xp * scale),
      gold: Math.floor(res.stats.gold * scale),
      drops: res.stats.drops.map(scaleCount),
      pity: res.pity
    };
  }

  const IdleCore = {
    IDLE_CONFIG, RARITY, MONSTERS, BOSSES, TRIGGERS, SCENES, MATERIALS, MONSTER_MAT, BOSS_MAT, RECIPES, ARTIFACTS,
    createRng, buildHeroSnapshot, heroTriggers, baseStats, bossFor, isBossFloor, sceneFor, floorInfo,
    makeEnemy, xpLevelMultiplier, killGold, killXp, rollDrops, rollMats,
    generateMap, walkable, distanceField, artifactCost, canAfford, computeMods, makeBounty, bountyProgress,
    Run, simulate, offlineSettlement
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = IdleCore;
  root.IdleCore = IdleCore;
})(typeof window !== 'undefined' ? window : globalThis);
