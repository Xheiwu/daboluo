// ========== home-system.js - 地上家园系统 ==========
// 地上是家园，地下去探险：击杀怪物有概率带回装饰物、宠物、种子和被困伙伴。
// 依赖：player、HomeArt；可选依赖：isInTown、getCurrentCombatFloor、updateStats、showNotification、
//       createDamageNumber、addGold、panelManager、togglePanel、SaveSystem。
// 所有数据保存在 player.home（随 SaveSystem 的 ...player 一起写入存档），
// 时间相关玩法（种田、派遣）只记录时间戳，离线期间同样会推进。

const HOME_CONFIG = {
  STATE_VERSION: 1,
  YARD_SLOTS: 12,
  FARM_PLOTS_BASE: 2,
  FARM_PLOTS_MAX: 6,
  FARM_PLOT_COST: [0, 0, 2000, 6000, 18000, 54000],   // 第 N 块田的解锁价格（下标=已拥有数量）
  PET_MAX_LEVEL: 10,
  PET_DUPLICATE_EXP: 200,
  PET_KILL_EXP: { normal: 1, elite: 5, boss: 25 },
  // 每次击杀的掉落概率。pity = 连续多少次击杀未掉落后，下一次符合条件的击杀必定掉落。
  DROP: {
    seed:       { normal: 0.02,   elite: 0.10,  boss: 0.60, pity: 120,  minFloor: 1 },
    decoration: { normal: 0.006,  elite: 0.05,  boss: 0.35, pity: 250,  minFloor: 1 },
    pet:        { normal: 0.0005, elite: 0.008, boss: 0.08, pity: 1500, minFloor: 2 },
    companion:  { normal: 0,      elite: 0.004, boss: 0.06, pity: 2000, minFloor: 3 }
  },
  // 越深越容易出高品质：权重 = base × (1 + depth × growth)
  RARITY_WEIGHT: { 1: { base: 100, growth: 0 }, 2: { base: 40, growth: 0.04 }, 3: { base: 12, growth: 0.08 }, 4: { base: 3, growth: 0.12 } },
  EXPEDITIONS: [
    { id: 'short', name: '近郊巡游', minutes: 30 },
    { id: 'mid', name: '地宫探索', minutes: 120 },
    { id: 'long', name: '深渊远征', minutes: 480 }
  ],
  COMFORT_TIERS: [
    { min: 0, name: '简陋小院' },
    { min: 15, name: '清雅小院' },
    { min: 30, name: '江湖名宅' },
    { min: 60, name: '世外桃源' }
  ]
};

const HOME_RARITY = {
  1: { name: '普通', color: '#d8d8d8' },
  2: { name: '精良', color: '#5fa8ff' },
  3: { name: '稀有', color: '#ffd24d' },
  4: { name: '传说', color: '#ff8a3d' }
};

const HOME_STAT_NAMES = {
  goldPct: '金币掉落', dropRatePct: '装备掉落', maxHpPct: '最大生命', dmgPct: '伤害',
  critChance: '暴击率', def: '防御', hpRegenPct: '生命回复', mpRegenPct: '法力回复'
};

const HOME_DECORATIONS = {
  stone_lantern:   { name: '石灯笼',     rarity: 1, comfort: 2,  minFloor: 1,  desc: '地宫入口捡来的旧石灯，夜里会亮。' },
  bamboo_fence:    { name: '竹篱笆',     rarity: 1, comfort: 2,  minFloor: 1,  desc: '圈出一方小院。' },
  wine_jar:        { name: '女儿红酒坛', rarity: 1, comfort: 2,  minFloor: 1,  desc: '封泥未开，香气已出。' },
  red_lantern:     { name: '红灯笼',     rarity: 2, comfort: 3,  minFloor: 2,  desc: '挂在门口，回家的人远远就能看见。' },
  bonsai:          { name: '青松盆景',   rarity: 2, comfort: 3,  minFloor: 2,  desc: '从石缝里救出来的小松树。' },
  wooden_dummy:    { name: '练功木人桩', rarity: 2, comfort: 4,  minFloor: 3,  desc: '上面还留着前人的掌印。' },
  treasure_chest:  { name: '旧宝箱',     rarity: 2, comfort: 4,  minFloor: 3,  desc: '空了，但很好看。' },
  glow_mushrooms:  { name: '荧光蘑菇丛', rarity: 3, comfort: 5,  minFloor: 4,  desc: '地下深处的特产，会发出淡淡蓝光。' },
  koi_pond:        { name: '锦鲤池',     rarity: 3, comfort: 6,  minFloor: 5,  desc: '两尾锦鲤，据说能带来好运。' },
  plum_tree:       { name: '红梅树',     rarity: 3, comfort: 6,  minFloor: 5,  desc: '冬天开花，香飘满院。' },
  crystal_cluster: { name: '地脉水晶',   rarity: 4, comfort: 9,  minFloor: 8,  desc: '从地脉深处挖出的水晶，蕴含灵气。' },
  sword_stone:     { name: '古剑冢',     rarity: 4, comfort: 10, minFloor: 10, desc: '一柄拔不出的古剑。' }
};

const HOME_PETS = {
  dango_cat:   { name: '团子猫',   rarity: 1, minFloor: 2, stat: 'goldPct',     base: 3, perLevel: 0.7, desc: '圆滚滚的，看见金币会扑过去。' },
  firefly:     { name: '萤火灵',   rarity: 1, minFloor: 2, stat: 'mpRegenPct',  base: 4, perLevel: 1,   desc: '在黑暗地宫里为你照路。' },
  white_fox:   { name: '小白狐',   rarity: 2, minFloor: 3, stat: 'dropRatePct', base: 2, perLevel: 0.5, desc: '鼻子很灵，总能嗅到宝物。' },
  rock_golem:  { name: '石头精',   rarity: 2, minFloor: 3, stat: 'def',         base: 10, perLevel: 5,  desc: '沉默寡言，挡在你前面。' },
  panda:       { name: '胖胖熊猫', rarity: 2, minFloor: 4, stat: 'maxHpPct',    base: 3, perLevel: 0.7, desc: '抱起来很暖和。' },
  mushroom:    { name: '蘑菇精',   rarity: 3, minFloor: 5, stat: 'hpRegenPct',  base: 1, perLevel: 0.3, desc: '身上的孢子能疗伤。' },
  jade_rabbit: { name: '玉兔',     rarity: 3, minFloor: 6, stat: 'critChance',  base: 1, perLevel: 0.3, desc: '据说是从月亮上掉下来的。' },
  baby_dragon: { name: '小火龙',   rarity: 4, minFloor: 8, stat: 'dmgPct',      base: 4, perLevel: 1,   desc: '还不会喷火，只会打嗝冒烟。' }
};

const HOME_COMPANIONS = {
  aniu:    { name: '阿牛',     title: '铁匠学徒', rarity: 1, minFloor: 3, role: 'comfort',     value: 5,  roleDesc: '驻守：修缮家园，舒适度 +5' },
  aqing:   { name: '阿青',     title: '猎户',     rarity: 2, minFloor: 3, role: 'expedition',  value: 30, roleDesc: '派遣：探险金币收益 +30%' },
  xiaoliu: { name: '小柳',     title: '药师',     rarity: 2, minFloor: 4, role: 'cook',        value: 50, roleDesc: '驻守：料理效果持续时间 +50%' },
  laoshu:  { name: '老鼠',     title: '盗墓贼',   rarity: 3, minFloor: 5, role: 'treasure',    value: 2,  roleDesc: '派遣：带回装饰物的概率翻倍' },
  monk:    { name: '小和尚',   title: '扫地僧徒', rarity: 3, minFloor: 6, role: 'farm',        value: 30, roleDesc: '驻守：作物生长速度 +30%' },
  jianke:  { name: '无名剑客', title: '浪迹天涯', rarity: 4, minFloor: 9, role: 'guard',       value: 5,  roleDesc: '驻守：传授剑意，伤害 +5%' }
};

const HOME_CROPS = {
  radish:     { name: '白萝卜', rarity: 1, minFloor: 1, growMinutes: 10,  sell: 30,   food: { name: '萝卜汤',   stat: 'maxHpPct',    value: 5,  minutes: 30 } },
  rice:       { name: '稻谷',   rarity: 1, minFloor: 1, growMinutes: 20,  sell: 60,   food: { name: '白米饭',   stat: 'goldPct',     value: 10, minutes: 30 } },
  herb:       { name: '止血草', rarity: 2, minFloor: 2, growMinutes: 30,  sell: 120,  food: { name: '草药膏',   stat: 'hpRegenPct',  value: 2,  minutes: 30 } },
  chili:      { name: '火椒',   rarity: 2, minFloor: 3, growMinutes: 45,  sell: 180,  food: { name: '麻辣烤串', stat: 'dmgPct',      value: 8,  minutes: 30 } },
  moonflower: { name: '月光花', rarity: 3, minFloor: 5, growMinutes: 90,  sell: 400,  food: { name: '月光茶',   stat: 'dropRatePct', value: 10, minutes: 30 } },
  lingzhi:    { name: '灵芝',   rarity: 4, minFloor: 8, growMinutes: 240, sell: 1200, food: { name: '灵芝汤',   stat: 'dmgPct',      value: 15, minutes: 60 } }
};

const HomeSystem = {
  rng: Math.random,              // 测试时可替换
  now: () => Date.now(),         // 测试时可替换
  tab: 'yard',
  selectedYardSlot: -1,
  petPos: null,
  lastPetDraw: 0,
  tickTimer: null,

  // ---------- 状态 ----------
  createDefaultState() {
    return {
      version: HOME_CONFIG.STATE_VERSION,
      decorations: {},                         // id -> 拥有数量
      yard: new Array(HOME_CONFIG.YARD_SLOTS).fill(null),
      pets: {},                                // id -> { level, exp }
      activePet: null,
      companions: {},                          // id -> { mode: 'home' | 'expedition', expedition }
      seeds: {},                               // id -> 数量
      produce: {},                             // id -> 数量
      farm: { plots: new Array(HOME_CONFIG.FARM_PLOTS_BASE).fill(null) },
      food: null,                              // { cropId, stat, value, expiresAt }
      pity: { seed: 0, decoration: 0, pet: 0, companion: 0 },
      stats: { totalFinds: 0, harvests: 0, expeditions: 0 },
      unseen: false
    };
  },

  // 修补旧存档/缺失字段，原地修改，保证引用不变
  normalize(state) {
    const d = this.createDefaultState();
    for (const key of Object.keys(d)) {
      if (state[key] === undefined || state[key] === null && d[key] !== null) state[key] = d[key];
    }
    if (!Array.isArray(state.yard)) state.yard = d.yard;
    while (state.yard.length < HOME_CONFIG.YARD_SLOTS) state.yard.push(null);
    state.yard = state.yard.map(id => (id && HOME_DECORATIONS[id] ? id : null));
    if (!state.farm || !Array.isArray(state.farm.plots)) state.farm = d.farm;
    state.farm.plots = state.farm.plots.slice(0, HOME_CONFIG.FARM_PLOTS_MAX)
      .map(p => (p && HOME_CROPS[p.cropId] ? p : null));
    for (const k of Object.keys(d.pity)) if (typeof state.pity[k] !== 'number') state.pity[k] = 0;
    for (const k of Object.keys(d.stats)) if (typeof state.stats[k] !== 'number') state.stats[k] = 0;
    if (state.activePet && !state.pets[state.activePet]) state.activePet = null;
    // 摆放数量不能超过拥有数量
    const placed = {};
    state.yard = state.yard.map(id => {
      if (!id) return null;
      placed[id] = (placed[id] || 0) + 1;
      return placed[id] <= (state.decorations[id] || 0) ? id : null;
    });
    state.version = HOME_CONFIG.STATE_VERSION;
    return state;
  },

  state() {
    if (typeof player === 'undefined') return null;
    if (!player.home || typeof player.home !== 'object') player.home = this.createDefaultState();
    if (player.home.version !== HOME_CONFIG.STATE_VERSION || !player.home._ok) {
      this.normalize(player.home);
      Object.defineProperty(player.home, '_ok', { value: true, enumerable: false, configurable: true });
    }
    return player.home;
  },

  // 读档/新游戏时调用：不同槽位之间不能串数据
  onSaveLoaded(data) {
    player.home = data && data.home && typeof data.home === 'object' ? data.home : null;
    this.petPos = null;
    this.state();
  },

  // ---------- 工具 ----------
  inTown() {
    return typeof isInTown === 'function' ? isInTown() : true;
  },

  depth() {
    if (typeof player === 'undefined') return 1;
    const floor = typeof getCurrentCombatFloor === 'function' ? getCurrentCombatFloor() : (player.floor || 1);
    return Math.max(1, (floor || 1) + (player.isInHell ? 10 : 0));
  },

  bestDepth() {
    const pb = player.personalBest || {};
    return Math.max(1, pb.maxFloor || 0, player.floor || 0) + ((player.hellFloor || 0) > 0 ? 10 : 0);
  },

  notify(msg) {
    if (typeof showNotification === 'function') showNotification(msg);
  },

  // 按深度加权抽取一个条目；depth 不足 minFloor 的不进入池子
  pickWeighted(table, depth) {
    const pool = Object.entries(table).filter(([, v]) => (v.minFloor || 1) <= depth);
    if (!pool.length) return null;
    const weights = pool.map(([, v]) => {
      const w = HOME_CONFIG.RARITY_WEIGHT[v.rarity] || HOME_CONFIG.RARITY_WEIGHT[1];
      return w.base * (1 + depth * w.growth);
    });
    let roll = this.rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return pool[i][0];
    }
    return pool[pool.length - 1][0];
  },

  rollDrop(kind, tier, depth) {
    const s = this.state();
    const cfg = HOME_CONFIG.DROP[kind];
    if (depth < cfg.minFloor) return false;
    const chance = cfg[tier] || 0;
    s.pity[kind]++;
    const pityReady = s.pity[kind] >= cfg.pity && chance > 0;
    if (pityReady || this.rng() < chance) {
      s.pity[kind] = 0;
      return true;
    }
    return false;
  },

  // ---------- 获得 ----------
  addDecoration(id, n = 1) {
    const s = this.state();
    s.decorations[id] = (s.decorations[id] || 0) + n;
    s.unseen = true;
  },

  addSeed(id, n = 1) {
    const s = this.state();
    s.seeds[id] = (s.seeds[id] || 0) + n;
    s.unseen = true;
  },

  petExpToNext(level) {
    return Math.round(60 * Math.pow(level, 1.6));
  },

  addPetExp(id, exp) {
    const pet = this.state().pets[id];
    if (!pet) return false;
    let leveled = false;
    pet.exp += exp;
    while (pet.level < HOME_CONFIG.PET_MAX_LEVEL && pet.exp >= this.petExpToNext(pet.level)) {
      pet.exp -= this.petExpToNext(pet.level);
      pet.level++;
      leveled = true;
    }
    if (pet.level >= HOME_CONFIG.PET_MAX_LEVEL) pet.exp = 0;
    if (leveled) {
      this.notify(`🐾 ${HOME_PETS[id].name} 升到了 ${pet.level} 级！`);
      this.refreshStats();
    }
    return leveled;
  },

  addPet(id) {
    const s = this.state();
    if (s.pets[id]) {
      this.addPetExp(id, HOME_CONFIG.PET_DUPLICATE_EXP);
      return 'duplicate';
    }
    s.pets[id] = { level: 1, exp: 0 };
    if (!s.activePet) {
      s.activePet = id;
      this.refreshStats();
    }
    s.unseen = true;
    return 'new';
  },

  addCompanion(id) {
    const s = this.state();
    if (s.companions[id]) {
      // 重复遇到：送一份谢礼
      const gold = 300 * HOME_COMPANIONS[id].rarity * this.depth();
      if (typeof addGold === 'function') addGold(gold); else player.gold = (player.gold || 0) + gold;
      return 'duplicate';
    }
    s.companions[id] = { mode: 'home', expedition: null };
    s.unseen = true;
    this.refreshStats();
    return 'new';
  },

  // 击杀钩子：由 game.js 的 finalizeEnemyDeath 调用；地宫挂机传入 { depth, idle: true }，离线结算再加 silent
  onEnemyKilled(enemy, opts = {}) {
    if (typeof player === 'undefined' || !enemy) return [];
    if (!opts.idle && this.inTown()) return [];
    const s = this.state();
    const depth = Math.max(1, opts.depth || this.depth());
    const tier = (enemy.isBoss || enemy.isQuestTarget || enemy.tier === 'boss') ? 'boss'
      : ((enemy.isElite || enemy.rarity > 0 || enemy.tier === 'elite') ? 'elite' : 'normal');
    const found = [];

    if (s.activePet) this.addPetExp(s.activePet, HOME_CONFIG.PET_KILL_EXP[tier]);

    if (this.rollDrop('seed', tier, depth)) {
      const id = this.pickWeighted(HOME_CROPS, depth);
      if (id) {
        const n = tier === 'boss' ? 3 : 1;
        this.addSeed(id, n);
        found.push({ kind: 'seed', id, text: `🌱 ${HOME_CROPS[id].name}种子 ×${n}` });
      }
    }
    if (this.rollDrop('decoration', tier, depth)) {
      const id = this.pickWeighted(HOME_DECORATIONS, depth);
      if (id) {
        this.addDecoration(id);
        found.push({ kind: 'decoration', id, text: `🏮 装饰「${HOME_DECORATIONS[id].name}」` });
      }
    }
    if (this.rollDrop('pet', tier, depth)) {
      const id = this.pickWeighted(HOME_PETS, depth);
      if (id) {
        const r = this.addPet(id);
        found.push({ kind: 'pet', id, text: r === 'new' ? `🐾 新伙伴宠物「${HOME_PETS[id].name}」！` : `🐾 ${HOME_PETS[id].name}的气息（宠物经验 +${HOME_CONFIG.PET_DUPLICATE_EXP}）` });
      }
    }
    if (tier !== 'normal' && this.rollDrop('companion', tier, depth)) {
      const id = this.pickWeighted(HOME_COMPANIONS, depth);
      if (id) {
        const c = HOME_COMPANIONS[id];
        const r = this.addCompanion(id);
        found.push({ kind: 'companion', id, text: r === 'new' ? `🤝 救出了${c.title}「${c.name}」，TA 会去你的家园！` : `🤝 ${c.name}再次相遇，送来谢礼金币` });
      }
    }

    if (found.length && opts.silent) {
      s.stats.totalFinds += found.length;
      this.updateBadge();
    } else if (found.length) {
      s.stats.totalFinds += found.length;
      const best = found[found.length - 1];
      this.notify(`家园收获：${found.map(f => f.text).join('，')}`);
      if (typeof createDamageNumber === 'function' && typeof enemy.x === 'number') {
        createDamageNumber(enemy.x, enemy.y - 46, best.text, best.kind === 'seed' ? '#a7f070' : '#ffcd75');
      }
      this.updateBadge();
    }
    return found;
  },

  // ---------- 加成 ----------
  comfort() {
    const s = this.state();
    let total = s.yard.reduce((sum, id) => sum + (id ? HOME_DECORATIONS[id].comfort : 0), 0);
    for (const [id, c] of Object.entries(s.companions)) {
      const def = HOME_COMPANIONS[id];
      if (def && def.role === 'comfort' && c.mode === 'home') total += def.value;
    }
    return total;
  },

  comfortTier(comfort = this.comfort()) {
    let tier = HOME_CONFIG.COMFORT_TIERS[0];
    for (const t of HOME_CONFIG.COMFORT_TIERS) if (comfort >= t.min) tier = t;
    return tier;
  },

  companionRoleValue(role, mode = 'home') {
    const s = this.state();
    let v = 0;
    for (const [id, c] of Object.entries(s.companions)) {
      const def = HOME_COMPANIONS[id];
      if (def && def.role === role && c.mode === mode) v += def.value;
    }
    return v;
  },

  petBonusValue(id) {
    const def = HOME_PETS[id];
    const pet = this.state().pets[id];
    if (!def || !pet) return 0;
    return Math.round((def.base + def.perLevel * (pet.level - 1)) * 10) / 10;
  },

  foodActive() {
    const f = this.state().food;
    return f && f.expiresAt > this.now() ? f : null;
  },

  // 汇总所有家园加成
  getBonuses() {
    const s = this.state();
    const b = { goldPct: 0, dropRatePct: 0, maxHpPct: 0, dmgPct: 0, critChance: 0, def: 0, hpRegenPct: 0, mpRegenPct: 0 };
    const comfort = this.comfort();
    b.goldPct += Math.min(25, comfort * 0.5);
    if (comfort >= 30) b.dropRatePct += 5;
    if (comfort >= 60) b.maxHpPct += 5;
    if (s.activePet) {
      const def = HOME_PETS[s.activePet];
      if (def) b[def.stat] += this.petBonusValue(s.activePet);
    }
    b.dmgPct += this.companionRoleValue('guard');
    const food = this.foodActive();
    if (food) b[food.stat] += food.value;
    for (const k of Object.keys(b)) b[k] = Math.round(b[k] * 10) / 10;
    return b;
  },

  // 由 game.js 的 updateStats 末尾调用
  applyStatBonuses(p) {
    if (!p) return;
    const b = this.getBonuses();
    p.goldPct = (p.goldPct || 0) + b.goldPct;
    p.dropRatePct = (p.dropRatePct || 0) + b.dropRatePct;
    p.hpRegenPct = (p.hpRegenPct || 0) + b.hpRegenPct;
    p.mpRegenPct = (p.mpRegenPct || 0) + b.mpRegenPct;
    if (b.critChance) p.critChance = Math.min(100, (p.critChance || 0) + b.critChance);
    if (b.def) p.armor = (p.armor || 0) + b.def;
    if (b.maxHpPct && p.maxHp) {
      p.maxHp = Math.floor(p.maxHp * (1 + b.maxHpPct / 100));
      if (p.hp > p.maxHp) p.hp = p.maxHp;
    }
    if (b.dmgPct && Array.isArray(p.damage)) {
      p.damage[0] = Math.floor(p.damage[0] * (1 + b.dmgPct / 100));
      p.damage[1] = Math.floor(p.damage[1] * (1 + b.dmgPct / 100));
    }
    p.homeBonuses = b;
  },

  refreshStats() {
    if (typeof updateStats === 'function') {
      try { updateStats(); } catch (e) { console.warn('[家园] 刷新属性失败', e); }
    }
  },

  // ---------- 庭院 ----------
  availableDecoration(id) {
    const s = this.state();
    const placed = s.yard.filter(x => x === id).length;
    return (s.decorations[id] || 0) - placed;
  },

  placeDecoration(slot, id) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能布置家园' };
    if (slot < 0 || slot >= s.yard.length) return { ok: false, msg: '无效位置' };
    if (!HOME_DECORATIONS[id] || this.availableDecoration(id) <= 0) return { ok: false, msg: '没有可摆放的该装饰' };
    s.yard[slot] = id;
    this.refreshStats();
    return { ok: true };
  },

  removeDecoration(slot) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能布置家园' };
    if (!s.yard[slot]) return { ok: false, msg: '这里是空的' };
    s.yard[slot] = null;
    this.refreshStats();
    return { ok: true };
  },

  // ---------- 宠物 ----------
  setActivePet(id) {
    const s = this.state();
    if (id && !s.pets[id]) return { ok: false, msg: '还没有这只宠物' };
    s.activePet = id || null;
    this.petPos = null;
    this.refreshStats();
    return { ok: true };
  },

  // ---------- 农田 ----------
  growMultiplier() {
    return 1 + this.companionRoleValue('farm') / 100;
  },

  plotProgress(plot) {
    if (!plot) return 0;
    const crop = HOME_CROPS[plot.cropId];
    const elapsed = (this.now() - plot.plantedAt) * this.growMultiplier();
    return Math.max(0, Math.min(1, elapsed / (crop.growMinutes * 60000)));
  },

  plotRemainingMs(plot) {
    if (!plot) return 0;
    const crop = HOME_CROPS[plot.cropId];
    const total = crop.growMinutes * 60000;
    return Math.max(0, (total - (this.now() - plot.plantedAt) * this.growMultiplier()) / this.growMultiplier());
  },

  plant(plotIndex, cropId) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能种田' };
    if (plotIndex < 0 || plotIndex >= s.farm.plots.length) return { ok: false, msg: '无效田地' };
    if (s.farm.plots[plotIndex]) return { ok: false, msg: '这块田已经种上了' };
    if (!HOME_CROPS[cropId] || !(s.seeds[cropId] > 0)) return { ok: false, msg: '没有这种种子' };
    s.seeds[cropId]--;
    if (s.seeds[cropId] <= 0) delete s.seeds[cropId];
    s.farm.plots[plotIndex] = { cropId, plantedAt: this.now() };
    return { ok: true };
  },

  harvest(plotIndex) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能收获' };
    const plot = s.farm.plots[plotIndex];
    if (!plot) return { ok: false, msg: '这块田是空的' };
    if (this.plotProgress(plot) < 1) return { ok: false, msg: '还没成熟' };
    const n = 2 + (this.rng() < 0.3 ? 1 : 0);
    s.produce[plot.cropId] = (s.produce[plot.cropId] || 0) + n;
    // 20% 概率额外收回一颗种子，让种田可以自给自足
    if (this.rng() < 0.2) s.seeds[plot.cropId] = (s.seeds[plot.cropId] || 0) + 1;
    s.farm.plots[plotIndex] = null;
    s.stats.harvests++;
    return { ok: true, cropId: plot.cropId, amount: n };
  },

  unlockPlot() {
    const s = this.state();
    const count = s.farm.plots.length;
    if (count >= HOME_CONFIG.FARM_PLOTS_MAX) return { ok: false, msg: '田地已经全部开垦' };
    const cost = HOME_CONFIG.FARM_PLOT_COST[count];
    if ((player.gold || 0) < cost) return { ok: false, msg: `需要 ${cost} 金币` };
    player.gold -= cost;
    s.farm.plots.push(null);
    return { ok: true, cost };
  },

  cook(cropId) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能做饭' };
    const crop = HOME_CROPS[cropId];
    if (!crop || !(s.produce[cropId] > 0)) return { ok: false, msg: '没有这种食材' };
    s.produce[cropId]--;
    if (s.produce[cropId] <= 0) delete s.produce[cropId];
    const minutes = crop.food.minutes * (1 + this.companionRoleValue('cook') / 100);
    s.food = { cropId, stat: crop.food.stat, value: crop.food.value, expiresAt: this.now() + minutes * 60000 };
    this.refreshStats();
    return { ok: true, minutes };
  },

  sell(cropId) {
    const s = this.state();
    const crop = HOME_CROPS[cropId];
    if (!crop || !(s.produce[cropId] > 0)) return { ok: false, msg: '没有这种农产品' };
    s.produce[cropId]--;
    if (s.produce[cropId] <= 0) delete s.produce[cropId];
    if (typeof addGold === 'function') addGold(crop.sell); else player.gold = (player.gold || 0) + crop.sell;
    return { ok: true, gold: crop.sell };
  },

  // ---------- 伙伴派遣 ----------
  startExpedition(companionId, expeditionId) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能派遣伙伴' };
    const c = s.companions[companionId];
    const exp = HOME_CONFIG.EXPEDITIONS.find(e => e.id === expeditionId);
    if (!c || !exp) return { ok: false, msg: '无效派遣' };
    if (c.mode === 'expedition') return { ok: false, msg: '这位伙伴已经出发了' };
    c.mode = 'expedition';
    c.expedition = { id: exp.id, startedAt: this.now(), endsAt: this.now() + exp.minutes * 60000, depth: this.bestDepth() };
    this.refreshStats();
    return { ok: true };
  },

  expeditionReady(companionId) {
    const c = this.state().companions[companionId];
    return !!(c && c.mode === 'expedition' && c.expedition && this.now() >= c.expedition.endsAt);
  },

  // 结算派遣：金币、种子、装饰、少量宠物机会
  claimExpedition(companionId) {
    const s = this.state();
    if (!this.inTown()) return { ok: false, msg: '回到营地后才能迎接伙伴' };
    const c = s.companions[companionId];
    if (!this.expeditionReady(companionId)) return { ok: false, msg: '伙伴还在路上' };
    const def = HOME_COMPANIONS[companionId];
    const exp = HOME_CONFIG.EXPEDITIONS.find(e => e.id === c.expedition.id) || HOME_CONFIG.EXPEDITIONS[0];
    const depth = c.expedition.depth || 1;
    const hours = exp.minutes / 60;
    const rewards = [];
    const goldMult = 1 + (def.role === 'expedition' ? def.value / 100 : 0);
    const gold = Math.round((40 + depth * 25) * hours * 6 * goldMult);
    if (typeof addGold === 'function') addGold(gold); else player.gold = (player.gold || 0) + gold;
    rewards.push(`💰 ${gold} 金币`);
    const seedCount = Math.max(1, Math.round(hours));
    for (let i = 0; i < seedCount; i++) {
      const id = this.pickWeighted(HOME_CROPS, depth);
      if (id) this.addSeed(id);
    }
    rewards.push(`🌱 种子 ×${seedCount}`);
    const decoChance = Math.min(1, ({ short: 0.15, mid: 0.45, long: 1 }[exp.id] || 0) * (def.role === 'treasure' ? def.value : 1));
    if (this.rng() < decoChance) {
      const id = this.pickWeighted(HOME_DECORATIONS, depth);
      if (id) { this.addDecoration(id); rewards.push(`🏮 ${HOME_DECORATIONS[id].name}`); }
    }
    const petChance = { short: 0, mid: 0.03, long: 0.1 }[exp.id] || 0;
    if (depth >= HOME_CONFIG.DROP.pet.minFloor && this.rng() < petChance) {
      const id = this.pickWeighted(HOME_PETS, depth);
      if (id) { this.addPet(id); rewards.push(`🐾 ${HOME_PETS[id].name}`); }
    }
    c.mode = 'home';
    c.expedition = null;
    s.stats.expeditions++;
    this.refreshStats();
    return { ok: true, rewards };
  },

  // ---------- 提醒 ----------
  hasPendingWork() {
    const s = this.state();
    if (s.unseen) return true;
    if (s.farm.plots.some(p => p && this.plotProgress(p) >= 1)) return true;
    return Object.keys(s.companions).some(id => this.expeditionReady(id));
  },

  updateBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('badge-home');
    if (badge) badge.style.display = this.hasPendingWork() ? 'block' : 'none';
  },

  tick() {
    if (typeof player === 'undefined' || !player.home) return;
    const s = this.state();
    if (s.food && s.food.expiresAt <= this.now()) {
      s.food = null;
      this.refreshStats();
      this.notify('🍲 料理效果结束了，回家再吃一顿吧');
    }
    this.updateBadge();
    if (this.isOpen()) this.updateTimers();
  },

  // ---------- 渲染：宠物跟随 ----------
  drawPetFollower(ctx, px, py) {
    if (typeof player === 'undefined' || !player.home || player.dead || typeof HomeArt === 'undefined') return;
    const id = player.home.activePet;
    if (!id) return;
    const sprite = HomeArt.canvas('pet_' + id, 2);
    if (!sprite) return;
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = Math.min(0.1, Math.max(0, (t - (this.lastPetDraw || t)) / 1000));
    this.lastPetDraw = t;
    const side = String(player.direction || '').includes('left') ? 1 : -1;
    const tx = px + side * 30, ty = py + 4;
    if (!this.petPos || Math.hypot(this.petPos.x - tx, this.petPos.y - ty) > 400) this.petPos = { x: tx, y: ty };
    const k = 1 - Math.pow(0.02, dt);
    this.petPos.x += (tx - this.petPos.x) * k;
    this.petPos.y += (ty - this.petPos.y) * k;
    const moving = Math.hypot(tx - this.petPos.x, ty - this.petPos.y) > 3;
    const bob = Math.round(Math.sin(t / (moving ? 90 : 260)) * (moving ? 3 : 1.5));
    const x = Math.round(this.petPos.x), y = Math.round(this.petPos.y);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, 11, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(sprite, x - sprite.width / 2, y - sprite.height + 2 + bob);
    ctx.restore();
  },

  // ---------- UI ----------
  isOpen() {
    const el = typeof document !== 'undefined' && document.getElementById('home-panel');
    return !!(el && el.style.display === 'block');
  },

  ensurePanel() {
    if (typeof document === 'undefined') return null;
    let panel = document.getElementById('home-panel');
    if (panel) return panel;
    const anchor = document.getElementById('achievements-panel');
    panel = document.createElement('div');
    panel.id = 'home-panel';
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="panel-close" data-home-action="close"></div>
      <div class="panel-header">🏡 家园</div>
      <div class="home-summary" id="home-summary"></div>
      <div class="home-tabs" id="home-tabs">
        <div class="home-tab" data-home-tab="yard">庭院</div>
        <div class="home-tab" data-home-tab="pets">宠物</div>
        <div class="home-tab" data-home-tab="companions">伙伴</div>
        <div class="home-tab" data-home-tab="farm">农田</div>
        <div class="home-tab" data-home-tab="storage">仓库</div>
      </div>
      <div class="home-body" id="home-body"></div>`;
    (anchor && anchor.parentNode ? anchor.parentNode : document.body).appendChild(panel);
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click', e => this.handleClick(e));
    if (typeof panelManager !== 'undefined' && panelManager.panels && !panelManager.panels.home) {
      panelManager.panels.home = { id: 'home-panel', group: 'center', top: 8, baseTop: 8, opened: false, zIndex: 0 };
    }
    return panel;
  },

  toggle() {
    this.ensurePanel();
    if (typeof togglePanel === 'function') togglePanel('home');
    else {
      const el = document.getElementById('home-panel');
      el.style.display = el.style.display === 'block' ? 'none' : 'block';
    }
    if (this.isOpen()) {
      this.state().unseen = false;
      this.render();
      this.updateBadge();
    }
  },

  handleClick(e) {
    const tabEl = e.target.closest('[data-home-tab]');
    if (tabEl) {
      this.tab = tabEl.dataset.homeTab;
      this.selectedYardSlot = -1;
      this.render();
      return;
    }
    const el = e.target.closest('[data-home-action]');
    if (!el) return;
    const a = el.dataset.homeAction;
    const arg = el.dataset.arg;
    const arg2 = el.dataset.arg2;
    let r = null;
    switch (a) {
      case 'close': this.toggle(); return;
      case 'yard-slot': {
        const slot = Number(arg);
        if (this.state().yard[slot]) r = this.removeDecoration(slot);
        else this.selectedYardSlot = this.selectedYardSlot === slot ? -1 : slot;
        break;
      }
      case 'place': r = this.placeDecoration(this.selectedYardSlot, arg); if (r.ok) this.selectedYardSlot = -1; break;
      case 'pet': r = this.setActivePet(this.state().activePet === arg ? null : arg); break;
      case 'plant': r = this.plant(Number(arg), arg2); break;
      case 'harvest': r = this.harvest(Number(arg)); if (r.ok) r.msg = `收获 ${HOME_CROPS[r.cropId].name} ×${r.amount}`; break;
      case 'unlock-plot': r = this.unlockPlot(); if (r.ok) r.msg = `开垦了一块新田（-${r.cost} 金币）`; break;
      case 'cook': r = this.cook(arg); if (r.ok) r.msg = `吃下 ${HOME_CROPS[arg].food.name}，效果持续 ${Math.round(r.minutes)} 分钟`; break;
      case 'sell': r = this.sell(arg); if (r.ok) r.msg = `卖出获得 ${r.gold} 金币`; break;
      case 'expedition': r = this.startExpedition(arg, arg2); if (r.ok) r.msg = `${HOME_COMPANIONS[arg].name} 出发了`; break;
      case 'claim': r = this.claimExpedition(arg); if (r.ok) r.msg = `${HOME_COMPANIONS[arg].name} 回来了：${r.rewards.join('，')}`; break;
    }
    if (r && r.msg) this.notify(r.msg);
    if (r && r.ok && typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save(true);
    this.render();
    this.updateBadge();
  },

  fmtTime(ms) {
    const sec = Math.ceil(ms / 1000);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${h}小时${m}分`;
    if (m > 0) return `${m}分${s}秒`;
    return `${s}秒`;
  },

  bonusText(b) {
    const parts = Object.entries(b).filter(([, v]) => v).map(([k, v]) => `${HOME_STAT_NAMES[k]} +${v}${k === 'def' ? '' : '%'}`);
    return parts.length ? parts.join(' · ') : '暂无加成';
  },

  rarityStyle(r) {
    return `style="color:${(HOME_RARITY[r] || HOME_RARITY[1]).color}"`;
  },

  render() {
    const panel = this.ensurePanel();
    if (!panel) return;
    const s = this.state();
    const comfort = this.comfort();
    const tier = this.comfortTier(comfort);
    const food = this.foodActive();
    panel.querySelector('#home-summary').innerHTML = `
      <div><b>${tier.name}</b> · 舒适度 ${comfort}${this.inTown() ? '' : ' · <span class="home-warn">身在地下，回营地才能打理家园</span>'}</div>
      <div class="home-bonus">${this.bonusText(this.getBonuses())}</div>
      ${food ? `<div class="home-food">🍲 ${HOME_CROPS[food.cropId].food.name}：剩余 <span data-home-timer="${food.expiresAt}"></span></div>` : ''}`;
    panel.querySelectorAll('.home-tab').forEach(t => t.classList.toggle('active', t.dataset.homeTab === this.tab));
    const body = panel.querySelector('#home-body');
    body.innerHTML = this['render_' + this.tab] ? this['render_' + this.tab](s) : '';
    this.updateTimers();
  },

  updateTimers() {
    const panel = typeof document !== 'undefined' && document.getElementById('home-panel');
    if (!panel) return;
    let needRender = false;
    panel.querySelectorAll('[data-home-timer]').forEach(el => {
      const left = Number(el.dataset.homeTimer) - this.now();
      if (left <= 0 && el.dataset.homeDone !== '1') { el.dataset.homeDone = '1'; needRender = true; }
      el.textContent = this.fmtTime(Math.max(0, left));
    });
    if (needRender) setTimeout(() => this.render(), 0);
  },

  render_yard(s) {
    const slots = s.yard.map((id, i) => {
      const sel = i === this.selectedYardSlot ? ' selected' : '';
      if (id) return `<div class="home-yard-slot filled" data-home-action="yard-slot" data-arg="${i}" title="${HOME_DECORATIONS[id].name}（点击收回）">${HomeArt.img('deco_' + id, 3)}</div>`;
      return `<div class="home-yard-slot${sel}" data-home-action="yard-slot" data-arg="${i}" title="空地（点击选择后摆放）"></div>`;
    }).join('');
    let picker = '<div class="home-hint">在地下击杀怪物有概率带回装饰物。点击空地，再选择要摆放的装饰；点击已摆放的装饰可收回。</div>';
    if (this.selectedYardSlot >= 0) {
      const owned = Object.keys(HOME_DECORATIONS).filter(id => this.availableDecoration(id) > 0);
      picker = owned.length
        ? `<div class="home-hint">选择要摆放在这里的装饰：</div><div class="home-grid">${owned.map(id => `
          <div class="home-card" data-home-action="place" data-arg="${id}">
            ${HomeArt.img('deco_' + id, 3)}<div ${this.rarityStyle(HOME_DECORATIONS[id].rarity)}>${HOME_DECORATIONS[id].name}</div>
            <small>舒适 +${HOME_DECORATIONS[id].comfort} · 剩 ${this.availableDecoration(id)}</small></div>`).join('')}</div>`
        : '<div class="home-hint">仓库里没有可摆放的装饰，去地下探险吧！</div>';
    }
    return `<div class="home-yard">${slots}</div>${picker}`;
  },

  render_pets(s) {
    const ids = Object.keys(HOME_PETS);
    return `<div class="home-hint">出战宠物会跟着你下地宫，并提供加成；击杀怪物能让它成长。</div><div class="home-grid">${ids.map(id => {
      const def = HOME_PETS[id];
      const pet = s.pets[id];
      if (!pet) return `<div class="home-card locked">${HomeArt.img('pet_' + id, 3, 'silhouette')}<div>？？？</div><small>${def.minFloor} 层以下可能遇到</small></div>`;
      const active = s.activePet === id;
      const unit = def.stat === 'def' ? '' : '%';
      const expText = pet.level >= HOME_CONFIG.PET_MAX_LEVEL ? '满级' : `${pet.exp}/${this.petExpToNext(pet.level)}`;
      return `<div class="home-card${active ? ' active' : ''}" data-home-action="pet" data-arg="${id}" title="${def.desc}">
        ${HomeArt.img('pet_' + id, 3)}<div ${this.rarityStyle(def.rarity)}>${def.name} Lv${pet.level}</div>
        <small>${HOME_STAT_NAMES[def.stat]} +${this.petBonusValue(id)}${unit}</small>
        <small>经验 ${expText}</small>
        <small>${active ? '✅ 出战中（点击休息）' : '点击出战'}</small></div>`;
    }).join('')}</div>`;
  },

  render_companions(s) {
    const ids = Object.keys(HOME_COMPANIONS);
    const town = this.inTown();
    return `<div class="home-hint">在地下击败精英或首领时，可能救出被困的伙伴。伙伴可以驻守家园，或者派去探险（离线也会计时）。</div>${ids.map(id => {
      const def = HOME_COMPANIONS[id];
      const c = s.companions[id];
      if (!c) return `<div class="home-row locked">${HomeArt.img('comp_' + id, 3, 'silhouette')}<div class="home-row-main"><div>？？？</div><small>${def.minFloor} 层以下的精英/首领身边</small></div></div>`;
      let action;
      if (c.mode === 'expedition') {
        action = this.expeditionReady(id)
          ? `<button class="home-btn" data-home-action="claim" data-arg="${id}" ${town ? '' : 'disabled'}>迎接归来</button>`
          : `<small>探险中，剩余 <span data-home-timer="${c.expedition.endsAt}"></span></small>`;
      } else {
        action = HOME_CONFIG.EXPEDITIONS.map(e => `<button class="home-btn" data-home-action="expedition" data-arg="${id}" data-arg2="${e.id}" ${town ? '' : 'disabled'}>${e.name}·${e.minutes >= 60 ? e.minutes / 60 + '小时' : e.minutes + '分'}</button>`).join('');
      }
      return `<div class="home-row">${HomeArt.img('comp_' + id, 3)}<div class="home-row-main">
        <div ${this.rarityStyle(def.rarity)}>${def.title}·${def.name}</div><small>${def.roleDesc}${c.mode === 'home' ? '（驻守中）' : ''}</small>
        <div class="home-actions">${action}</div></div></div>`;
    }).join('')}`;
  },

  render_farm(s) {
    const town = this.inTown();
    const seeds = Object.entries(s.seeds).filter(([, n]) => n > 0);
    const plots = s.farm.plots.map((plot, i) => {
      if (!plot) {
        const buttons = seeds.length
          ? seeds.map(([id, n]) => `<button class="home-btn" data-home-action="plant" data-arg="${i}" data-arg2="${id}" ${town ? '' : 'disabled'}>种${HOME_CROPS[id].name}(${n})</button>`).join('')
          : '<small>没有种子</small>';
        return `<div class="home-plot"><div class="home-plot-soil"></div><div class="home-actions">${buttons}</div></div>`;
      }
      const crop = HOME_CROPS[plot.cropId];
      const p = this.plotProgress(plot);
      const art = p >= 1 ? 'crop_' + plot.cropId : (p >= 0.5 ? 'crop_growing' : 'crop_sprout');
      const end = this.now() + this.plotRemainingMs(plot);
      return `<div class="home-plot">${HomeArt.img(art, 3)}<div>${crop.name}</div>
        ${p >= 1 ? `<button class="home-btn" data-home-action="harvest" data-arg="${i}" ${town ? '' : 'disabled'}>收获</button>` : `<small>成熟还需 <span data-home-timer="${end}"></span></small>`}</div>`;
    }).join('');
    const count = s.farm.plots.length;
    const unlock = count < HOME_CONFIG.FARM_PLOTS_MAX
      ? `<button class="home-btn" data-home-action="unlock-plot">开垦新田（${HOME_CONFIG.FARM_PLOT_COST[count]} 金币）</button>` : '';
    const speed = this.growMultiplier() > 1 ? `（伙伴帮忙，生长速度 ×${this.growMultiplier()}）` : '';
    return `<div class="home-hint">种子来自地下探险。作物按真实时间生长，离线也会长大${speed}。</div><div class="home-farm">${plots}</div>${unlock}`;
  },

  render_storage(s) {
    const produce = Object.entries(s.produce).filter(([, n]) => n > 0);
    const town = this.inTown();
    const produceHtml = produce.length ? produce.map(([id, n]) => {
      const c = HOME_CROPS[id];
      const unit = c.food.stat === 'def' ? '' : '%';
      return `<div class="home-row">${HomeArt.img('crop_' + id, 3)}<div class="home-row-main"><div>${c.name} ×${n}</div>
        <small>做成「${c.food.name}」：${HOME_STAT_NAMES[c.food.stat]} +${c.food.value}${unit}，${c.food.minutes} 分钟</small>
        <div class="home-actions"><button class="home-btn" data-home-action="cook" data-arg="${id}" ${town ? '' : 'disabled'}>做饭吃</button>
        <button class="home-btn" data-home-action="sell" data-arg="${id}">卖出 ${c.sell} 金</button></div></div></div>`;
    }).join('') : '<div class="home-hint">还没有农产品。</div>';
    const decos = Object.entries(s.decorations).filter(([, n]) => n > 0)
      .map(([id, n]) => `<div class="home-card">${HomeArt.img('deco_' + id, 3)}<div ${this.rarityStyle(HOME_DECORATIONS[id].rarity)}>${HOME_DECORATIONS[id].name}</div><small>拥有 ${n} · 已摆 ${n - this.availableDecoration(id)}</small></div>`).join('');
    const seeds = Object.entries(s.seeds).filter(([, n]) => n > 0)
      .map(([id, n]) => `<span class="home-chip" ${this.rarityStyle(HOME_CROPS[id].rarity)}>🌱${HOME_CROPS[id].name} ×${n}</span>`).join('');
    return `<h4 class="home-h">农产品</h4>${produceHtml}
      <h4 class="home-h">种子</h4><div>${seeds || '<span class="home-hint">暂无</span>'}</div>
      <h4 class="home-h">装饰收藏</h4><div class="home-grid">${decos || '<span class="home-hint">暂无</span>'}</div>
      <div class="home-hint">累计地下收获 ${s.stats.totalFinds} 次 · 收获作物 ${s.stats.harvests} 次 · 完成派遣 ${s.stats.expeditions} 次</div>`;
  },

  init() {
    if (this.tickTimer || typeof setInterval === 'undefined') return;
    this.tickTimer = setInterval(() => this.tick(), 2000);
  }
};

if (typeof window !== 'undefined') {
  window.HomeSystem = HomeSystem;
  window.addEventListener('load', () => HomeSystem.init());
}
if (typeof module !== 'undefined') module.exports = { HomeSystem, HOME_CONFIG, HOME_DECORATIONS, HOME_PETS, HOME_COMPANIONS, HOME_CROPS };
