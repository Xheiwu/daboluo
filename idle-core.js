// ========== idle-core.js - 镇妖塔挂机纯逻辑核心 ==========
// 不依赖 Canvas / DOM / 全局 player：输入角色快照，按固定步长模拟战斗，输出事件。
// 浏览器中挂在 window.IdleCore，Node 中通过 require 使用（tools/test-idle-core.js）。
(function (root) {
  'use strict';

  const IDLE_CONFIG = {
    DT: 0.05,                    // 固定步长（秒）
    WAVES_PER_FLOOR: 5,          // 每层波次（Boss 层最后一波是镇守大妖）
    WALK_TIME: 2.2,              // 波次之间向下行进的时间
    ENEMY_HP_MULT: 1.5,           // 挂机波次怪物更耐打，控制节奏（约 10 击杀/分钟）
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
    const pool = MONSTERS.filter(m => m.minFloor <= floor);
    let roll = rng() * pool.reduce((s, m) => s + m.weight, 0);
    let m = pool[0];
    for (const x of pool) { roll -= x.weight; if (roll <= 0) { m = x; break; } }
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

  function makeWave(floor, waveIndex, rng, bossReady = true) {
    const last = waveIndex === IDLE_CONFIG.WAVES_PER_FLOOR - 1;
    if (last && isBossFloor(floor) && !bossReady) {
      // 镇守尚未刷新：最后一波改为精英小队
      const list = [makeEnemy(floor, rng, { elite: true }), makeEnemy(floor, rng, { elite: false })];
      list.forEach((e, i) => { e.slot = i; });
      return list;
    }
    if (last && isBossFloor(floor)) {
      const list = [makeEnemy(floor, rng, { boss: true })];
      list.push(makeEnemy(floor, rng, { elite: false }));
      list.forEach((e, i) => { e.slot = i; });
      return list;
    }
    const count = 2 + (rng() < 0.5 ? 1 : 0) + (floor >= 5 && rng() < 0.3 ? 1 : 0);
    const list = [];
    for (let i = 0; i < count; i++) list.push(makeEnemy(floor, rng));
    list.forEach((e, i) => { e.slot = i; });
    return list;
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
  class Run {
    constructor(heroSnapshot, opts = {}) {
      this.rng = opts.rng || createRng(opts.seed || 1);
      this.hero = heroSnapshot;
      this.floor = Math.max(1, opts.floor || 1);
      this.maxFloor = Math.max(this.floor, opts.maxFloor || 1);
      this.autoAdvance = opts.autoAdvance !== false;
      this.pity = opts.pity || { rare: 0, unique: 0 };
      this.wave = 0;
      this.time = 0;
      this.hp = heroSnapshot.maxHp;
      this.shield = 0;
      this.shieldTimer = 0;
      this.medicine = IDLE_CONFIG.MEDICINE_PER_FLOOR;
      this.phase = 'walk';
      this.phaseTimer = 0.6;
      this.enemies = [];
      this.attackTimer = 0;
      this.attackCount = 0;
      this.cooldowns = {};       // 触发器剩余冷却
      this.intervalTimers = {};  // 定时触发器计时
      this.charges = {};         // 每 N 次普攻类触发器的蓄力
      this.stats = { kills: 0, deaths: 0, xp: 0, gold: 0, drops: [0, 0, 0, 0, 0], floorsCleared: 0, damage: 0, triggers: {}, killsByTier: { normal: 0, elite: 0, boss: 0 } };
      this.events = [];
      this.bossRespawn = opts.bossRespawn || {};  // floor -> 可再次出现的模拟时间
    }

    setHero(snapshot) {
      const ratio = this.hp / this.hero.maxHp;
      this.hero = snapshot;
      this.hp = Math.max(1, Math.min(snapshot.maxHp, Math.round(snapshot.maxHp * ratio)));
    }

    emit(e) { this.events.push(e); }

    alive() { return this.enemies.filter(e => e.hp > 0); }

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
      return this.events;
    }

    stepWalk(dt) {
      this.hp = Math.min(this.hero.maxHp, this.hp + this.hero.maxHp * IDLE_CONFIG.WALK_HEAL_PCT * dt / IDLE_CONFIG.WALK_TIME);
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        const bossReady = this.time >= (this.bossRespawn[this.floor] || 0);
        this.enemies = makeWave(this.floor, this.wave, this.rng, bossReady);
        this.phase = 'fight';
        this.attackTimer = 0.2;
        this.emit({ type: 'wave', floor: this.floor, wave: this.wave, enemies: this.enemies.slice() });
      }
    }

    stepDead(dt) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.hp = this.hero.maxHp;
        this.medicine = IDLE_CONFIG.MEDICINE_PER_FLOOR;
        this.phase = 'walk';
        this.phaseTimer = IDLE_CONFIG.WALK_TIME;
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

      if (!this.alive().length) this.clearWave();
    }

    rollBase() {
      const h = this.hero;
      return h.dmgMin + this.rng() * (h.dmgMax - h.dmgMin);
    }

    // chain：0 = 普攻/定时武学，1+ = 由其他命中触发
    hit(target, raw, source, chain) {
      const h = this.hero;
      const crit = this.rng() < h.critChance;
      const dmg = Math.max(1, Math.round(raw * (crit ? h.critMult : 1)));
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
      dmg *= 1 - h.damageReduction;
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
      if (enemy.tier === 'boss') this.bossRespawn[this.floor] = this.time + IDLE_CONFIG.BOSS_COOLDOWN;
      const xp = killXp(enemy, this.floor, this.hero);
      const gold = killGold(this.floor, enemy.tier, this.hero, this.rng);
      const drops = rollDrops(enemy.tier, this.floor, this.hero, this.pity, this.rng);
      this.stats.kills++;
      this.stats.killsByTier[enemy.tier]++;
      this.stats.xp += xp;
      this.stats.gold += gold;
      for (const r of drops) this.stats.drops[r]++;
      this.emit({ type: 'kill', enemy: { uid: enemy.uid, name: enemy.name, tier: enemy.tier, type: enemy.type }, floor: this.floor, xp, gold, drops, source });
    }

    clearWave() {
      this.wave++;
      this.emit({ type: 'waveClear', floor: this.floor, wave: this.wave });
      if (this.wave >= IDLE_CONFIG.WAVES_PER_FLOOR) {
        this.wave = 0;
        this.stats.floorsCleared++;
        const cleared = this.floor;
        if (this.autoAdvance) this.floor++;
        if (this.floor > this.maxFloor) this.maxFloor = this.floor;
        this.medicine = IDLE_CONFIG.MEDICINE_PER_FLOOR;
        this.emit({ type: 'floorClear', floor: cleared, next: this.floor, maxFloor: this.maxFloor });
      }
      this.enemies = [];
      this.phase = 'walk';
      this.phaseTimer = IDLE_CONFIG.WALK_TIME;
    }

    die() {
      this.hp = 0;
      this.stats.deaths++;
      const from = this.floor;
      // 战败：退回上一层并停留刷怪，避免卡在打不过的层反复阵亡
      this.floor = Math.max(1, this.floor - 1);
      this.autoAdvance = false;
      this.wave = 0;
      this.enemies = [];
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
    const res = simulate(heroSnapshot, { floor: opts.floor || 1, maxFloor: opts.floor || 1, autoAdvance: false, seconds: sample, seed: opts.seed, pity });
    const scale = (effective / sample) * IDLE_CONFIG.OFFLINE_EFF;
    const rng = createRng((opts.seed || 7) + 13);
    const scaleCount = n => { const x = n * scale; const f = Math.floor(x); return f + (rng() < x - f ? 1 : 0); };
    return {
      elapsedSec, effectiveSec: effective, capped: elapsedSec > effective,
      floor: res.floor,
      kills: scaleCount(res.stats.kills),
      killsByTier: { normal: scaleCount(res.stats.killsByTier.normal), elite: scaleCount(res.stats.killsByTier.elite), boss: scaleCount(res.stats.killsByTier.boss) },
      deaths: res.stats.deaths,
      xp: Math.floor(res.stats.xp * scale),
      gold: Math.floor(res.stats.gold * scale),
      drops: res.stats.drops.map(scaleCount),
      pity: res.pity
    };
  }

  const IdleCore = {
    IDLE_CONFIG, RARITY, MONSTERS, BOSSES, TRIGGERS,
    createRng, buildHeroSnapshot, heroTriggers, baseStats, bossFor, isBossFloor,
    makeEnemy, makeWave, xpLevelMultiplier, killGold, killXp, rollDrops,
    Run, simulate, offlineSettlement
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = IdleCore;
  root.IdleCore = IdleCore;
})(typeof window !== 'undefined' ? window : globalThis);
