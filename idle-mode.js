// ========== idle-mode.js - 竖屏镇妖塔挂机（向下推进） ==========
// 地上是家园，地下是倒插地底的镇妖塔：越往下镇压的妖越强，角色自动一层层往下打，武学按触发器自动出招，离线也能闭关收益。
// 战斗逻辑全部在 idle-core.js（纯逻辑，可在 Node 中测试）；本文件只负责：
//   1. 把真实角色属性转成快照交给核心
//   2. 把核心事件转换成真实奖励（经验/金币/装备/家园掉落）
//   3. 竖屏像素渲染与界面
// 依赖全局：player、IdleCore、HomeArt、IDLE_MONSTER_SPRITE；可选：HomeSystem、addGold、checkLevelUp、
//          createItem、addItemToInventory、SaveSystem、showNotification、DailyQuestSystem、updateStats、updateUI

const IdleMode = {
  W: 240,
  H: 400,
  T: 32,            // 每格像素（与 IDLE_CONFIG.MAP.TILE 一致）
  active: false,
  offlineVisible: false,
  loadEpoch: 0,
  run: null,
  canvas: null,
  ctx: null,
  raf: 0,
  lastFrame: 0,
  processedAt: 0,
  acc: 0,
  persistTimer: 0,
  uiTimer: 0,
  scroll: 0,
  view: null,
  session: null,
  logLines: [],
  bgCache: {},
  panel: null,       // 当前打开的面板：floors / mats / bounty
  matFilter: null,   // 塔志：按材料筛选楼层
  panelTimer: 0,

  // ---------- 存档状态（player.idle） ----------
  state() {
    if (typeof player === 'undefined') return null;
    const d = {
      floor: 1, maxFloor: 1, autoAdvance: true, running: false, lastActive: 0, keepMin: 2, pity: { rare: 0, unique: 0 },
      totals: { kills: 0, seconds: 0, offlineClaims: 0, chests: 0, bounties: 0 },
      mats: {}, buffs: {}, artifacts: {}, bounties: [], bountySeq: 0,
      nemesis: null, treasureMaps: 0, treasurePending: false
    };
    if (!player.idle || typeof player.idle !== 'object') player.idle = d;
    const s = player.idle;
    for (const k of Object.keys(d)) if (s[k] === undefined || (s[k] === null && d[k] !== null)) s[k] = d[k];
    s.floor = Math.max(1, Math.floor(s.floor) || 1);
    s.maxFloor = Math.max(s.floor, Math.floor(s.maxFloor) || 1);
    if (![2, 3, 4].includes(s.keepMin)) s.keepMin = 2;
    if (typeof s.totals !== 'object' || Array.isArray(s.totals)) s.totals = {};
    for (const k of Object.keys(d.totals)) if (!Number.isFinite(s.totals[k]) || s.totals[k] < 0) s.totals[k] = 0;
    if (!Array.isArray(s.bounties)) s.bounties = [];
    // 曾短暂试用过的妖物新名 -> 改回原名（悬赏目标、宿敌）
    const OLD_NAME = { '血衣罗刹': '血蝠妖', '赤焰魔君': '九尾天狐', '九幽冥王': '魔蛟', '尸傀': '跳尸', '阴兵弓手': '纸人', '白骨卒': '毒蛛', '魈巫': '狐妖', '幽冥使': '鬼火', '缠尸': '机关铜人', '血魔': '蛇妖' };
    for (const b of s.bounties) if (b && OLD_NAME[b.target]) b.target = OLD_NAME[b.target];
    if (s.nemesis && OLD_NAME[s.nemesis.baseName]) s.nemesis.baseName = OLD_NAME[s.nemesis.baseName];
    return s;
  },

  // 读档时清理运行态；旧角色没有 idle 字段时必须使用独立默认值。
  onSaveLoaded(data) {
    this.loadEpoch++;
    cancelAnimationFrame(this.raf);
    this.active = false;
    this.processedAt = 0;
    this.offlineVisible = false;
    this.run = this.view = this.session = null;
    this.panel = null;
    this.persistTimer = this.uiTimer = this.panelTimer = this.acc = 0;
    this.logLines = [];
    this.bgCache = {};
    if (typeof document !== 'undefined') {
      for (const id of ['idle-mode', 'idle-offline']) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      }
    }
    player.idle = data && data.idle && typeof data.idle === 'object' ? data.idle : null;
    this.state();
  },

  blocksARPG() { return this.active || this.offlineVisible; },

  snapshot() {
    return IdleCore.buildHeroSnapshot(player);
  },

  // 法器 + 生效中的丹符 -> 塔内加成
  mods() {
    const s = this.state();
    return IdleCore.computeMods(s.artifacts, s.buffs, Date.now());
  },

  // ---------- 打开 / 关闭 ----------
  open() {
    if (typeof IdleCore === 'undefined') return;
    if (typeof isInTown === 'function' && !isInTown()) {
      this.notify('请先回到营地，再从营地下镇妖塔挂机');
      return;
    }
    if (player.isDead) return;
    this.ensureDom();
    const s = this.state();
    if (!this.run) {
      this.run = new IdleCore.Run(this.snapshot(), {
        seed: (Date.now() % 2147483647) >>> 0,
        floor: s.floor, maxFloor: s.maxFloor, autoAdvance: s.autoAdvance, pity: s.pity, mods: this.mods(),
        nemesis: s.nemesis, treasurePending: s.treasurePending
      });
      this.view = { enemies: new Map(), fx: [], texts: [], lunge: 0, cast: 0, heroDir: 'S', lastHx: null, lastHy: null, shake: 0, heroFlash: 0, banner: null, camX: null, camY: 0, mapUid: 0, fog: null };
      this.session = { kills: 0, gold: 0, xp: 0, items: 0, sold: 0, soldGold: 0, home: 0, mats: 0, chests: 0, startedAt: Date.now() };
      this.ensureBounties();
      this.logLines = [];
      this.log(`进入镇妖塔第 ${s.floor} 层 · ${this.themeFor(s.floor).name}`, '#c8b88a');
    }
    s.running = true;
    s.lastActive = Date.now();
    this.processedAt = s.lastActive;
    this.active = true;
    // 清除打开界面前尚未松开的移动/攻击输入。
    if (typeof mouse !== 'undefined') mouse.leftDown = mouse.leftClick = mouse.rightDown = false;
    player.targetX = player.targetY = player.targetItem = null;
    document.getElementById('idle-mode').classList.add('active');
    this.resize();
    this.lastFrame = performance.now();
    this.acc = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(t => this.frame(t));
    this.renderUI(true);
    if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save(true);
  },

  // 返回营地：结束挂机
  close() {
    const s = this.state();
    if (this.run) this.persist();
    s.running = false;
    this.active = false;
    cancelAnimationFrame(this.raf);
    const el = document.getElementById('idle-mode');
    if (el) el.classList.remove('active');
    if (this.session && this.session.kills > 0) {
      this.notify(`镇妖塔归来：击杀 ${this.session.kills}，金币 +${this.session.gold}，经验 +${this.session.xp}，装备 ${this.session.items} 件`);
    }
    this.run = null;
    if (typeof updateStats === 'function') updateStats();
    if (typeof updateUI === 'function') updateUI();
    if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save(true);
  },

  toggle() { this.active ? this.close() : this.open(); },

  toggleAdvance() {
    if (!this.run) return;
    this.run.autoAdvance = !this.run.autoAdvance;
    this.state().autoAdvance = this.run.autoAdvance;
    this.log(this.run.autoAdvance ? '继续向下深入' : `停留在第 ${this.run.floor} 层刷怪`, '#9fc6ff');
    this.renderUI(true);
  },

  // 主动回到上一层（打不动时）
  retreat() {
    if (!this.run || this.run.floor <= 1) return;
    this.goFloor(this.run.floor - 1, `退回第 ${this.run.floor - 1} 层`);
  },

  // 前往指定层（不超过最深层），并改为停留本层刷怪
  goFloor(floor, msg) {
    if (!this.run) return;
    floor = Math.max(1, Math.min(this.run.maxFloor, Math.floor(floor) || 1));
    this.run.autoAdvance = false;
    this.state().autoAdvance = false;
    this.run.changeFloor(floor);
    this.state().floor = floor;
    this.view.enemies.clear();
    this.log(msg || `前往第 ${floor} 层 · ${this.themeFor(floor).name}（停留本层刷怪）`, '#9fc6ff');
    this.panel = null;
    this.renderUI(true);
  },

  cycleKeep() {
    const s = this.state();
    s.keepMin = s.keepMin >= 4 ? 2 : s.keepMin + 1;
    this.renderUI(true);
  },

  persist() {
    const s = this.state();
    if (!this.run) return;
    s.floor = this.run.floor;
    s.maxFloor = Math.max(s.maxFloor, this.run.maxFloor);
    s.autoAdvance = this.run.autoAdvance;
    s.pity = this.run.pity;
    s.nemesis = this.run.nemesis ? Object.assign({}, this.run.nemesis) : null;
    s.treasurePending = this.run.treasurePending;
    // 标签页隐藏时仍可能保存，不能把未补算的后台时间抹掉。
    s.lastActive = this.processedAt || Date.now();
    this.run.setMods(this.mods());
  },

  // ---------- 主循环 ----------
  frame(t) {
    if (!this.active) return;
    let dt = (t - this.lastFrame) / 1000;
    this.lastFrame = t;
    if (dt > 5) {
      // 标签页被切到后台：按真实时间补算，不播放动画
      this.catchUp(dt);
      dt = 0;
    }
    dt = Math.min(dt, 0.25);
    const DT = IdleCore.IDLE_CONFIG.DT;
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.handleEvents(this.run.step(DT), true);
    }
    this.processedAt = Date.now();
    this.state().totals.seconds += dt;
    this.updateView(dt);
    this.draw();
    this.persistTimer += dt;
    if (this.persistTimer > 3) { this.persistTimer = 0; this.persist(); }
    this.uiTimer += dt;
    if (this.uiTimer > 0.15) { this.uiTimer = 0; this.renderUI(false); }
    this.panelTimer += dt;
    if (this.panel && this.panelTimer > 1) { this.panelTimer = 0; this.renderPanel(); }
    this.raf = requestAnimationFrame(n => this.frame(n));
  },

  catchUp(seconds) {
    const DT = IdleCore.IDLE_CONFIG.DT;
    const direct = Math.min(seconds, 600);
    const steps = Math.floor(direct / DT);
    for (let i = 0; i < steps; i++) this.handleEvents(this.run.step(DT), false);
    if (seconds > 600) {
      const res = IdleCore.offlineSettlement(this.snapshot(), { elapsedSec: seconds - 600, floor: this.run.floor, pity: this.run.pity, seed: Date.now() % 100000, mods: this.mods() });
      if (res) {
        const r = this.applySettlement(res);
        this.log(`后台闭关 ${this.fmtDuration(res.effectiveSec)}：金币 +${res.gold}，经验 +${res.xp}，装备 ${r.items} 件`, '#ffcd75');
      }
    }
    this.processedAt = Date.now();
    this.state().totals.seconds += seconds;
    this.view.enemies.clear();
    this.syncEnemies();
  },

  // ---------- 事件 -> 真实奖励 ----------
  handleEvents(events, visual) {
    for (const e of events) {
      switch (e.type) {
        case 'engage':
          this.run.setHero(this.snapshot());
          if (visual) {
            this.syncEnemies();
            if (e.kind === 'boss') this.view.banner = { text: '镇守现身！', color: '#ff8a3d', t: 0, life: 1.4 };
            else if (e.kind === 'nemesis') { this.view.banner = { text: '宿敌现身！', sub: '「又见面了……」', color: '#ff4d4d', t: 0, life: 1.8 }; this.view.shake = 0.3; }
            else if (e.kind === 'elite') this.floatText(this.heroPx().x, this.heroPx().y - 44, '精英怪群', '#9fc6ff', true);
          }
          break;
        case 'map':
          if (this.view) { this.view.enemies.clear(); this.view.mapUid = 0; }
          this.onMap(e, visual);
          break;
        case 'merchant':
          this.log('🏮 遇到塔中游商：「客官，下面凶险，带点东西防身？」点「游商」交易', '#f7a43a');
          if (visual) this.view.banner = { text: '🏮 塔中游商', sub: '点上方「游商」看看货', color: '#f7a43a', t: 0, life: 2 };
          break;
        case 'treasure':
          this.applyTreasure(e, visual);
          break;
        case 'nemesisBorn':
          this.state().nemesis = Object.assign({}, e.nemesis);
          this.log(`☠ ${e.killer} 吞了你的一缕精血，成了你的宿敌「${this.nemesisName(e.nemesis)}」！它会在塔中游荡等你`, '#ff4d4d');
          if (visual) this.view.banner = { text: `宿敌诞生：${this.nemesisName(e.nemesis)}`, sub: '再遇到它，报仇雪恨', color: '#ff4d4d', t: 0, life: 3 };
          break;
        case 'nemesisGrow':
          this.state().nemesis = Object.assign({}, e.nemesis);
          this.log(`☠ 宿敌「${this.nemesisName(e.nemesis)}」又一次击败了你，凶性大涨（${e.nemesis.level} 阶）`, '#ff4d4d');
          if (visual) this.view.banner = { text: `宿敌 ${this.nemesisName(e.nemesis)} 变强了`, sub: `${e.nemesis.level} 阶 · 已杀你 ${e.nemesis.kills} 次`, color: '#ff4d4d', t: 0, life: 3 };
          break;
        case 'chest':
          this.applyChest(e, visual);
          break;
        case 'attack':
          if (visual) {
            this.view.lunge = 1;
            const ve = this.view.enemies.get(e.target);
            if (ve) { ve.flash = 0.12; this.fxSlash(ve, e.crit); this.floatText(ve.x, ve.y - 26, e.dmg, e.crit ? '#ffcd75' : '#f4f4f4', e.crit); }
          }
          break;
        case 'trigger':
          if (visual) this.fxTrigger(e);
          break;
        case 'heroHit':
          if (visual) {
            this.view.heroFlash = 0.15;
            const hp = this.heroPx();
            this.floatText(hp.x + 14, hp.y - 30, '-' + e.dmg, '#ef7d57');
            const src = this.view.enemies.get(e.source);
            if (src && !e.ranged) src.lunge = 1;
            if (src && e.ranged) this.view.fx.push({ kind: 'bolt', x0: src.x, y0: src.y - 12, x1: hp.x, y1: hp.y - 12, t: 0, life: 0.25, color: '#c8a0e0' });
          }
          break;
        case 'block':
          if (visual) this.floatText(this.heroPx().x, this.heroPx().y - 34, '格挡', '#94b0c2');
          break;
        case 'medicine':
          if (visual) this.floatText(this.heroPx().x, this.heroPx().y - 40, '疗伤药', '#a7f070');
          break;
        case 'kill':
          this.applyKill(e, visual);
          break;
        case 'floorClear':
          this.onFloorClear(e);
          break;
        case 'death':
          this.log(`在第 ${e.from} 层力竭倒下，退回第 ${e.to} 层调息，改为停留刷怪`, '#ef7d57');
          this.state().autoAdvance = false;
          if (visual) this.view.banner = { text: '力竭…调息中', color: '#ef7d57', t: 0, life: 2.5 };
          break;
        case 'revive':
          if (visual) this.view.enemies.clear();
          break;
      }
    }
  },

  applyKill(e, visual) {
    const s = this.state();
    s.totals.kills++;
    this.session.kills++;
    if (typeof player !== 'undefined') player.kills = (player.kills || 0) + 1;
    // 经验
    if (e.xp > 0) {
      player.xp += e.xp;
      this.session.xp += e.xp;
      const lvl = player.lvl;
      if (typeof checkLevelUp === 'function') checkLevelUp();
      if (player.lvl > lvl) {
        this.log(`升级！当前等级 ${player.lvl}（记得回营地加点）`, '#ffcd75');
        if (typeof updateStats === 'function') updateStats();
        if (this.run) this.run.setHero(this.snapshot());
      }
    }
    // 金币
    if (e.gold > 0) {
      if (typeof addGold === 'function') addGold(e.gold); else player.gold += e.gold;
      this.session.gold += e.gold;
    }
    // 装备
    for (const r of e.drops) this.giveItem(r, e.floor, visual);
    // 家园：装饰/宠物/种子/伙伴
    if (typeof HomeSystem !== 'undefined') {
      const found = HomeSystem.onEnemyKilled({ tier: e.enemy.tier }, { depth: e.floor, idle: true, silent: true });
      for (const f of found) { this.session.home++; this.log(f.text, '#a7f070'); }
    }
    if (typeof DailyQuestSystem !== 'undefined' && DailyQuestSystem.updateProgress) DailyQuestSystem.updateProgress('kill', 1);
    if (e.enemy.tier === 'boss') this.log(`击败镇守大妖「${e.enemy.name}」！`, '#ff8a3d');
    if (e.enemy.nemesis) {
      s.nemesis = null;
      s.totals.nemesisKills = (s.totals.nemesisKills || 0) + 1;
      this.log(`⚔ 宿敌「${e.enemy.name}」伏诛！大仇得报，掉落翻倍并得到一张藏宝图`, '#ffe14d');
      if (visual) { this.view.banner = { text: '宿敌伏诛！', sub: '大仇得报 · 获得藏宝图', color: '#ffe14d', t: 0, life: 2.6 }; this.view.shake = 0.4; }
    }
    if (e.treasureMap) {
      s.treasureMaps = (s.treasureMaps || 0) + e.treasureMap;
      if (!e.enemy.nemesis) this.log('📜 精英妖物身上掉出一张藏宝图！去「材料」里使用', '#ffe14d');
    }
    this.addMats(e.mats);
    const delta = { mats: e.mats || {}, killsByType: {}, bossKills: {}, elites: e.enemy.tier === 'elite' ? 1 : 0 };
    if (e.enemy.tier === 'boss') delta.bossKills[e.enemy.baseName] = 1; else delta.killsByType[e.enemy.type] = 1;
    this.progressBounties(delta);
    if (visual) {
      const ve = this.view.enemies.get(e.enemy.uid);
      if (ve) {
        ve.dying = 0.001;
        this.floatText(ve.x, ve.y - 40, '+' + e.gold + '金', '#ffcd75');
        let k = 0;
        for (const id of Object.keys(e.mats || {})) {
          const m = IdleCore.MATERIALS[id];
          this.floatText(ve.x, ve.y - 52 - k++ * 11, `+${m.name}${e.mats[id] > 1 ? '×' + e.mats[id] : ''}`, m.color);
        }
      }
    }
  },

  // 新地图：异象 / 宿敌 / 藏宝洞 / 游商提示
  onMap(e, visual) {
    const map = e.map;
    if (!map) return;
    const affs = (map.affixes || []).map(id => IdleCore.AFFIXES[id]).filter(Boolean);
    if (affs.length) this.log(`塔中异象 ${affs.map(a => `「${a.name}」`).join('')}：${affs.map(a => a.desc).join('；')}`, affs[0].color);
    const nem = map.packs.find(p => p.kind === 'nemesis');
    if (nem) this.log(`一股熟悉的杀气……宿敌「${nem.enemies[0].name}」就在这一层！`, '#ff4d4d');
    if (map.treasure) this.log('📜 藏宝图指引：本层深处有一座藏宝洞，有精英把守', '#ffe14d');
    if (map.merchant) this.log('远处传来铃铛声，似乎有游商在此歇脚', '#f7a43a');
    if (this.panel === 'merchant') this.renderPanel();
    if (!visual || !this.view) return;
    const sub = [affs.map(a => a.name).join(' · '), nem ? '宿敌出没' : '', map.treasure ? '藏宝洞' : ''].filter(Boolean).join(' · ');
    if (!sub) return;
    const b = this.view.banner;
    if (b && b.t < 0.6 && !b.sub) { b.sub = sub; b.subColor = nem ? '#ff4d4d' : affs.length ? affs[0].color : '#ffe14d'; b.life = Math.max(b.life, 2.6); }
    else this.view.banner = { text: affs.length ? '塔中异象' : nem ? '宿敌出没' : '藏宝洞', sub, subColor: affs.length ? affs[0].color : '#ffe14d', color: '#ffcd75', t: 0, life: 2.4 };
  },

  nemesisName(n) { return n ? `${n.title}${n.baseName}` : ''; },

  // 藏宝洞
  applyTreasure(e, visual) {
    const s = this.state();
    s.totals.treasures = (s.totals.treasures || 0) + 1;
    if (typeof addGold === 'function') addGold(e.gold); else player.gold += e.gold;
    this.session.gold += e.gold;
    for (const r of e.drops) this.giveItem(r, e.floor, visual);
    this.addMats(e.mats);
    this.progressBounties({ mats: e.mats });
    this.log(`💰 挖开藏宝洞：金币 +${e.gold}，${this.matsText(e.mats)}，装备 ${e.drops.length} 件`, '#ffe14d');
    if (visual) {
      this.view.banner = { text: '藏宝洞！', sub: `金币 +${e.gold}`, color: '#ffe14d', t: 0, life: 2.2 };
      this.view.shake = 0.25;
      this.floatText(e.x * this.T, e.y * this.T - 24, '+' + e.gold + '金', '#ffcd75', true);
    }
  },

  useTreasureMap() {
    const s = this.state();
    if (!this.run || (s.treasureMaps || 0) <= 0 || s.treasurePending) return;
    s.treasureMaps--;
    s.treasurePending = true;
    this.run.useTreasureMap();
    this.log('📜 展开藏宝图……下一张地图里会出现藏宝洞', '#ffe14d');
    this.renderPanel();
  },

  // 游商交易
  merchant() {
    const m = this.run && this.run.map && this.run.map.merchant;
    return m && m.visited ? m : null;
  },

  canDeal(d) {
    const s = this.state();
    if (d.give.gold && (player.gold || 0) < d.give.gold) return false;
    if (d.give.mats && !IdleCore.canAfford(s.mats, d.give.mats)) return false;
    return !d.sold;
  },

  trade(i) {
    const m = this.merchant();
    const d = m && m.deals[i];
    if (!d || !this.canDeal(d)) return;
    const s = this.state();
    if (d.give.gold) { if (typeof spendGold === 'function') spendGold(d.give.gold); else player.gold -= d.give.gold; }
    if (d.give.mats) for (const id of Object.keys(d.give.mats)) s.mats[id] -= d.give.mats[id];
    if (d.get.mats) { this.addMats(d.get.mats); this.progressBounties({ mats: d.get.mats }); }
    if (d.get.treasureMaps) s.treasureMaps = (s.treasureMaps || 0) + d.get.treasureMaps;
    d.sold = true;
    this.log(`🏮 与游商成交：得到 ${d.get.treasureMaps ? '藏宝图' : this.matsText(d.get.mats)}`, '#f7a43a');
    if (typeof updateUI === 'function') updateUI();
    this.renderPanel();
  },

  // 秘藏宝箱
  applyChest(e, visual) {
    const s = this.state();
    s.totals.chests++;
    this.session.chests++;
    if (typeof addGold === 'function') addGold(e.gold); else player.gold += e.gold;
    this.session.gold += e.gold;
    for (const r of e.drops) this.giveItem(r, e.floor, visual);
    this.addMats(e.mats);
    this.progressBounties({ mats: e.mats });
    const names = Object.keys(e.mats).map(id => `${IdleCore.MATERIALS[id].name}×${e.mats[id]}`).join('、');
    this.log(`开启秘藏：金币 +${e.gold}${names ? '，' + names : ''}`, '#ffe14d');
    if (visual) {
      this.view.banner = { text: '发现秘藏！', color: '#ffe14d', t: 0, life: 1.6 };
      this.floatText(e.x * this.T, e.y * this.T - 20, '+' + e.gold + '金', '#ffcd75', true);
    }
  },

  // ---------- 材料 / 悬赏 / 炼制 ----------
  addMats(mats) {
    if (!mats) return;
    const s = this.state();
    for (const id of Object.keys(mats)) {
      const n = mats[id];
      if (!(n > 0) || !IdleCore.MATERIALS[id]) continue;
      s.mats[id] = (s.mats[id] || 0) + n;
      if (this.session) this.session.mats += n;
      if (IdleCore.MATERIALS[id].grade >= 3) this.log(`获得镇守材料「${IdleCore.MATERIALS[id].name}」×${n}`, IdleCore.MATERIALS[id].color);
    }
  },

  ensureBounties() {
    const s = this.state();
    const rng = IdleCore.createRng((Date.now() + s.bountySeq * 977) % 2147483647);
    while (s.bounties.length < 3) s.bounties.push(IdleCore.makeBounty(s.maxFloor, rng, ++s.bountySeq));
  },

  progressBounties(delta) {
    for (const b of this.state().bounties) {
      const was = b.done;
      if (IdleCore.bountyProgress(b, delta) && b.done && !was) {
        this.log(`悬赏完成：${this.bountyTitle(b)}（去悬赏榜领取）`, '#ffe14d');
        if (this.view && this.active) this.view.banner = { text: '悬赏完成！', color: '#ffe14d', t: 0, life: 1.6 };
      }
    }
  },

  claimBounty(id) {
    const s = this.state();
    const i = s.bounties.findIndex(b => b.id === id);
    if (i < 0 || !s.bounties[i].done) return;
    const b = s.bounties[i], r = b.reward;
    if (typeof addGold === 'function') addGold(r.gold); else player.gold += r.gold;
    player.xp += r.xp;
    if (typeof checkLevelUp === 'function') checkLevelUp();
    this.addMats(r.mats);
    const item = this.makeItem(b.floor, r.item);
    let itemText = '';
    if (item && typeof addItemToInventory === 'function' && addItemToInventory(item)) itemText = `，${item.displayName || item.name}`;
    else { const g = this.sellValue(r.item, b.floor); if (typeof addGold === 'function') addGold(g); else player.gold += g; }
    s.totals.bounties++;
    s.bounties.splice(i, 1);
    this.ensureBounties();
    this.log(`领取悬赏：金币 +${r.gold}，经验 +${r.xp}${itemText}`, '#ffe14d');
    if (this.run) this.run.setHero(this.snapshot());
    if (typeof updateStats === 'function') updateStats();
    this.renderPanel();
  },

  rerollCost() { return 50 + this.state().maxFloor * 20; },

  rerollBounty(id) {
    const s = this.state();
    const i = s.bounties.findIndex(b => b.id === id);
    const cost = this.rerollCost();
    if (i < 0 || s.bounties[i].done) return;
    if ((player.gold || 0) < cost) { this.notify(`金币不足（需要 ${cost}）`); return; }
    player.gold -= cost;
    s.bounties.splice(i, 1);
    this.ensureBounties();
    this.renderPanel();
  },

  pay(cost) {
    const s = this.state();
    if (!IdleCore.canAfford(s.mats, cost)) return false;
    for (const k of Object.keys(cost)) s.mats[k] -= cost[k];
    return true;
  },

  craft(id) {
    const r = IdleCore.RECIPES[id];
    if (!r || !this.pay(r.cost)) return;
    const s = this.state(), now = Date.now();
    s.buffs[id] = Math.max(now, s.buffs[id] || 0) + r.minutes * 60000;
    this.log(`炼成「${r.name}」：${r.desc}`, '#ffcd75');
    if (this.run) this.run.setMods(this.mods());
    this.renderPanel();
  },

  upgradeArtifact(id) {
    const s = this.state(), a = IdleCore.ARTIFACTS[id];
    const lv = s.artifacts[id] || 0;
    const cost = IdleCore.artifactCost(id, lv + 1);
    if (!cost || !this.pay(cost)) return;
    s.artifacts[id] = lv + 1;
    this.log(`法器「${a.name}」升至 ${lv + 1} 级：${a.desc(lv + 1)}`, '#ffcd75');
    if (this.run) this.run.setMods(this.mods());
    this.renderPanel();
  },

  rarityName(r) { return { 1: '白', 2: '蓝', 3: '黄', 4: '暗金' }[r] || ''; },
  rarityColor(r) { return { 1: '#d8d8d8', 2: '#5fa8ff', 3: '#ffe14d', 4: '#c7a35a' }[r] || '#ddd'; },
  sellValue(r, level) { return Math.floor(({ 1: 5, 2: 50, 3: 150, 4: 500 }[r] || 5) + level * ({ 1: 2, 2: 5, 3: 10, 4: 20 }[r] || 2)); },

  makeItem(level, rarity) {
    if (typeof createItem !== 'function') return null;
    let last = null;
    for (let i = 0; i < 60; i++) {
      const it = createItem(null, level);
      if (!it || it.type === 'potion' || it.type === 'scroll' || it.stackable) continue;
      last = it;
      if (it.rarity === rarity) return it;
    }
    if (last && rarity === 4 && last.rarity !== 4) {
      // 与 dropLoot 一致的暗金化
      last.rarity = 4;
      last.displayName = '暗金·' + last.name;
      last.stats.allSkills = (last.stats.allSkills || 0) + 1;
      last.stats.dmgPct = (last.stats.dmgPct || 0) + 50;
      last.stats.lifeSteal = (last.stats.lifeSteal || 0) + 5;
    }
    return last;
  },

  giveItem(rarity, level, visual) {
    const s = this.state();
    const gold = this.sellValue(rarity, level);
    if (rarity < s.keepMin) {
      // 拾取过滤：低于设定品质直接卖掉
      if (typeof addGold === 'function') addGold(gold); else player.gold += gold;
      this.session.sold++;
      this.session.soldGold += gold;
      return;
    }
    const item = this.makeItem(level, rarity);
    const ok = item && typeof addItemToInventory === 'function' && addItemToInventory(item);
    if (ok) {
      this.session.items++;
      this.log(`获得 ${item.displayName || item.name}`, this.rarityColor(item.rarity));
      if (visual && rarity >= 3) this.view.banner = { text: (rarity >= 4 ? '暗金！' : '黄装！') + (item.displayName || item.name), color: this.rarityColor(rarity), t: 0, life: 2.2 };
    } else {
      if (typeof addGold === 'function') addGold(gold); else player.gold += gold;
      this.session.sold++;
      this.session.soldGold += gold;
      if (rarity >= 3) this.log(`背包已满，${this.rarityName(rarity)}装自动卖出 +${gold} 金`, '#ef7d57');
    }
  },

  onFloorClear(e) {
    const s = this.state();
    if (e.maxFloor > s.maxFloor) {
      s.maxFloor = e.maxFloor;
      if (player.personalBest && e.floor > (player.personalBest.maxIdleFloor || 0)) player.personalBest.maxIdleFloor = e.floor;
    }
    s.floor = e.next;
    if (e.next !== e.floor) this.log(`第 ${e.floor} 层妖物已肃清，走下阶梯 → 第 ${e.next} 层`, '#c8b88a');
    else this.log(`第 ${e.floor} 层已肃清，妖气重聚，再探一遍`, '#c8b88a');
    if (this.view) this.view.banner = { text: e.next !== e.floor ? `镇妖塔 第 ${e.next} 层 · ${this.themeFor(e.next).name}` : `第 ${e.next} 层 · 妖气重聚`, color: '#ffcd75', t: 0, life: 1.8 };
    this.ensureBounties();
  },

  // 离线/后台结算结果 -> 真实奖励
  applySettlement(res) {
    if (res.xp > 0) { player.xp += res.xp; if (typeof checkLevelUp === 'function') checkLevelUp(); }
    if (res.gold > 0) { if (typeof addGold === 'function') addGold(res.gold); else player.gold += res.gold; }
    let items = 0, sold = 0, soldGold = 0;
    const s = this.state();
    const level = res.floor;
    const MAX_REAL_ITEMS = 30;
    for (let r = 4; r >= 1; r--) {
      for (let i = 0; i < (res.drops[r] || 0); i++) {
        const gold = this.sellValue(r, level);
        if (r >= s.keepMin && items < MAX_REAL_ITEMS) {
          const item = this.makeItem(level, r);
          if (item && typeof addItemToInventory === 'function' && addItemToInventory(item)) { items++; continue; }
        }
        sold++; soldGold += gold;
      }
    }
    if (soldGold > 0) { if (typeof addGold === 'function') addGold(soldGold); else player.gold += soldGold; }
    // 家园掉落：按击杀逐个判定（上限防卡顿）
    let homeFinds = [];
    if (typeof HomeSystem !== 'undefined') {
      const tiers = res.killsByTier || {};
      let budget = 6000;
      for (const tier of ['boss', 'elite', 'normal']) {
        const n = Math.min(tiers[tier] || 0, budget);
        budget -= n;
        for (let i = 0; i < n; i++) homeFinds = homeFinds.concat(HomeSystem.onEnemyKilled({ tier }, { depth: level, idle: true, silent: true }));
      }
    }
    if (res.pity) {
      s.pity = res.pity;
      // 后台补算后，下一次 persist 不能再用补算前的保底覆盖结果。
      if (this.run) this.run.pity = res.pity;
    }
    this.addMats(res.mats);
    this.progressBounties({ mats: res.mats || {}, killsByType: res.killsByType || {}, bossKills: res.bossKills || {}, elites: (res.killsByTier || {}).elite || 0 });
    s.totals.chests += res.chests || 0;
    s.treasureMaps = (s.treasureMaps || 0) + (res.treasureMaps || 0);
    s.totals.kills += res.kills;
    player.kills = (player.kills || 0) + res.kills;
    if (typeof updateStats === 'function') updateStats();
    return { items, sold, soldGold, homeFinds };
  },

  // ---------- 离线闭关（游戏启动时由 checkOfflineRewards 调用） ----------
  // 返回 true 表示由镇妖塔挂机接管离线收益，旧的离线收益不再发放，避免重复。
  handleOfflineReturn(lastOnlineTime) {
    if (typeof IdleCore === 'undefined' || typeof player === 'undefined') return false;
    const s = this.state();
    if (!s.running) return false;
    const since = Math.max(s.lastActive || 0, 0) || lastOnlineTime || Date.now();
    const elapsedSec = Math.max(0, (Date.now() - since) / 1000);
    const res = IdleCore.offlineSettlement(this.snapshot(), { elapsedSec, floor: s.floor, pity: s.pity, seed: Date.now() % 100000, mods: this.mods() });
    s.running = false;
    const epoch = this.loadEpoch;
    if (!res) {
      setTimeout(() => { if (epoch === this.loadEpoch) this.open(); }, 600);
      return true;
    }
    // 奖励与已结算标记同步落入当前角色，再延迟显示 UI，避免切槽串奖/刷新丢奖。
    const r = this.applySettlement(res);
    s.totals.offlineClaims++;
    s.lastActive = Date.now();
    this.offlineVisible = true;
    if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save(true);
    setTimeout(() => { if (epoch === this.loadEpoch) this.showOfflinePanel(res, r); }, 800);
    return true;
  },

  showOfflinePanel(res, r) {
    this.ensureDom();
    const el = document.getElementById('idle-offline');
    const homeText = r.homeFinds.length ? r.homeFinds.slice(0, 6).map(f => `<div class="idle-offline-home">${f.text}</div>`).join('') + (r.homeFinds.length > 6 ? `<div class="idle-hint">……共 ${r.homeFinds.length} 件家园收获</div>` : '') : '';
    el.querySelector('.idle-offline-body').innerHTML = `
      <div class="idle-offline-time">闭关 ${this.fmtDuration(res.elapsedSec)}${res.capped ? `<span class="idle-hint">（最多计算 ${IdleCore.IDLE_CONFIG.OFFLINE_MAX_HOURS} 小时）</span>` : ''}</div>
      <div class="idle-offline-grid">
        <div>镇妖塔</div><b>第 ${res.floor} 层</b>
        <div>击杀</div><b>${res.kills.toLocaleString()}</b>
        <div>金币</div><b style="color:#ffcd75">+${(res.gold + r.soldGold).toLocaleString()}</b>
        <div>经验</div><b style="color:#a7f070">+${res.xp.toLocaleString()}</b>
        <div>装备</div><b>${r.items} 件入包${r.sold ? `，${r.sold} 件卖出` : ''}</b>
        <div>材料</div><b>${this.matsText(res.mats) || '无'}</b>
        ${res.chests ? `<div>秘藏</div><b>${res.chests} 个</b>` : ''}
        ${res.treasureMaps ? `<div>藏宝图</div><b style="color:#ffe14d">${res.treasureMaps} 张</b>` : ''}
      </div>
      ${homeText}
      <div class="idle-hint">离线效率为在线挂机的 ${Math.round(IdleCore.IDLE_CONFIG.OFFLINE_EFF * 100)}%，离线期间停留在当前层不再深入。</div>`;
    el.classList.add('active');
    if (typeof SaveSystem !== 'undefined' && SaveSystem.save) SaveSystem.save(true);
  },

  closeOffline(resume) {
    const el = document.getElementById('idle-offline');
    if (el) el.classList.remove('active');
    this.offlineVisible = false;
    if (resume) this.open();
  },

  // ---------- 渲染 ----------
  // 世界坐标：1 格 = T 像素；镜头跟随主角，地图比屏幕大，可左右上下探索。
  heroPx() {
    const r = this.run;
    return r ? { x: r.hx * this.T, y: r.hy * this.T + 10 } : { x: 0, y: 0 };
  },

  // 怪群里第 i 只妖物相对怪群中心的站位
  packOffset(i, boss) {
    if (boss) return [[0, 0], [-34, 14], [34, 14], [0, 26]][i] || [((i % 2) ? 1 : -1) * 30, -18];
    return [[0, 0], [-22, 10], [22, 10], [-12, -14], [12, -14], [0, 20]][i] || [((i % 2) ? 1 : -1) * 26, 24];
  },

  syncEnemies() {
    if (!this.run || !this.run.pack) return;
    const pack = this.run.pack, T = this.T;
    pack.enemies.forEach((e, i) => {
      if (this.view.enemies.has(e.uid) || e.hp <= 0) return;
      const boss = e.tier === 'boss' || !!e.nemesis;
      const [ox, oy] = this.packOffset(i, pack.kind === 'boss' || pack.kind === 'nemesis');
      this.view.enemies.set(e.uid, { uid: e.uid, ref: e, x: pack.x * T + ox, y: pack.y * T + 10 + oy, flash: 0, lunge: 0, dying: 0, boss });
    });
  },

  floatText(x, y, text, color, big) {
    this.view.texts.push({ x: x + (Math.random() - 0.5) * 10, y, text: String(text), color, t: 0, life: big ? 1 : 0.8, big: !!big });
    if (this.view.texts.length > 40) this.view.texts.shift();
  },

  fxSlash(ve, crit) {
    const hp = this.heroPx();
    const ang = Math.atan2(ve.y - hp.y, ve.x - hp.x);
    this.view.fx.push({ kind: 'slash', x: ve.x, y: ve.y - 14, ang, t: 0, life: 0.18, crit });
    this.view.fx.push({ kind: 'spark', x: ve.x + (Math.random() - 0.5) * 8, y: ve.y - 16 + (Math.random() - 0.5) * 8, t: 0.03, life: 0.22 });
  },

  fxTrigger(e) {
    const hp = this.heroPx();
    const hero = { x: hp.x, y: hp.y - 12 };
    this.view.texts.push({ x: hero.x, y: hero.y - 34, text: e.name + '！', color: e.color, t: 0, life: 1.1, big: true, fixed: true });
    this.view.cast = 0.4;
    if (e.id === 'golden_bell') {
      this.view.fx.push({ kind: 'bell', t: 0, life: 0.8 });
      return;
    }
    const targets = e.hits.map(h => this.view.enemies.get(h.target)).filter(Boolean);
    for (const h of e.hits) {
      const ve = this.view.enemies.get(h.target);
      if (!ve) continue;
      ve.flash = 0.15;
      this.floatText(ve.x, ve.y - 30, h.dmg, h.crit ? '#ffcd75' : e.color, h.crit);
    }
    if (e.id === 'fireball') {
      for (const ve of targets) {
        this.view.fx.push({ kind: 'fireball', x0: hero.x, y0: hero.y, x1: ve.x, y1: ve.y - 14, t: 0, life: 0.22 });
        this.view.fx.push({ kind: 'blast', x: ve.x, y: ve.y - 14, t: -0.2, life: 0.3 });
      }
    } else if (e.id === 'thunder') {
      let px = hero.x, py = hero.y - 120;
      for (const ve of targets) {
        this.view.fx.push({ kind: 'lightning', x0: px, y0: py, x1: ve.x, y1: ve.y - 14, t: 0, life: 0.28, seed: Math.random() });
        this.view.fx.push({ kind: 'spark', x: ve.x, y: ve.y - 14, t: 0, life: 0.25 });
        px = ve.x; py = ve.y - 14;
      }
      this.view.shake = 0.15;
    } else if (e.id === 'multishot') {
      for (const ve of targets) for (let k = 0; k < 3; k++) {
        this.view.fx.push({ kind: 'dart', x0: hero.x + (k - 1) * 10, y0: hero.y, x1: ve.x + (k - 1) * 6, y1: ve.y - 14, t: -k * 0.04, life: 0.22 });
      }
    }
  },

  // 战争迷雾：走过的地方才看得见；进入石室时整间石室亮起
  revealFog() {
    const run = this.run, map = run.map, v = this.view;
    if (v.mapUid !== map.uid) {
      v.mapUid = map.uid;
      v.fog = new Uint8Array(map.cols * map.rows);
      v.camX = null;
      v.enemies.clear();
    }
    const R = 4.5, hx = run.hx, hy = run.hy;
    for (let y = Math.max(0, Math.floor(hy - R)); y <= Math.min(map.rows - 1, Math.ceil(hy + R)); y++) {
      for (let x = Math.max(0, Math.floor(hx - R)); x <= Math.min(map.cols - 1, Math.ceil(hx + R)); x++) {
        if (Math.hypot(x + 0.5 - hx, y + 0.5 - hy) <= R) v.fog[y * map.cols + x] = 1;
      }
    }
    for (const r of map.rooms) {
      if (hx >= r.x && hx <= r.x + r.w && hy >= r.y && hy <= r.y + r.h) {
        for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
          if (x >= 0 && y >= 0 && x < map.cols && y < map.rows) v.fog[y * map.cols + x] = 1;
        }
      }
    }
  },

  seen(x, y) {
    const map = this.run.map, f = this.view.fog;
    const tx = Math.floor(x), ty = Math.floor(y);
    return !!(f && tx >= 0 && ty >= 0 && tx < map.cols && ty < map.rows && f[ty * map.cols + tx]);
  },

  updateView(dt) {
    const v = this.view;
    if (!v || !this.run) return;
    this.revealFog();
    if (this.run.phase !== 'fight') {
      for (const [, ve] of v.enemies) if (!ve.dying) ve.dying = 0.001;
    }
    for (const [uid, ve] of v.enemies) {
      ve.flash = Math.max(0, ve.flash - dt);
      ve.lunge = Math.max(0, ve.lunge - dt * 5);
      if (ve.dying > 0) {
        ve.dying += dt;
        if (ve.dying > 0.5) v.enemies.delete(uid);
      }
    }
    // 镜头跟随
    const map = this.run.map, hp = this.heroPx();
    const mw = map.cols * this.T, mh = map.rows * this.T;
    const tx = Math.max(0, Math.min(mw - this.W, hp.x - this.W / 2));
    const ty = Math.max(0, Math.min(mh - this.H, hp.y - this.H * 0.45));
    if (v.camX === null) { v.camX = tx; v.camY = ty; }
    const k = Math.min(1, dt * 6);
    v.camX += (tx - v.camX) * k;
    v.camY += (ty - v.camY) * k;
    v.lunge = Math.max(0, v.lunge - dt * 6);
    v.heroFlash = Math.max(0, v.heroFlash - dt);
    v.cast = Math.max(0, (v.cast || 0) - dt);
    v.shake = Math.max(0, v.shake - dt);
    for (const f of v.fx) f.t += dt;
    v.fx = v.fx.filter(f => f.t < f.life);
    for (const t of v.texts) t.t += dt;
    v.texts = v.texts.filter(t => t.t < t.life);
    if (v.banner) { v.banner.t += dt; if (v.banner.t > v.banner.life) v.banner = null; }
  },

  themeFor(floor) {
    const themes = [
      { max: 10, name: '古墓', deco: 'tomb', floor: ['#3a3226', '#332c21'], wall: '#241f19', brick: '#4a3f30', moss: '#38b764' },
      { max: 20, name: '溶洞水牢', deco: 'water', floor: ['#26303a', '#212a33'], wall: '#171d24', brick: '#33404d', moss: '#73eff7' },
      { max: 30, name: '地火熔窟', deco: 'lava', floor: ['#3a2426', '#331f21'], wall: '#241517', brick: '#4d2a2e', moss: '#ef7d57' },
      { max: Infinity, name: '九幽', deco: 'abyss', floor: ['#2c2438', '#261f31'], wall: '#1a1524', brick: '#3b2f4d', moss: '#c8a0e0' }
    ];
    return themes.find(t => floor <= t.max);
  },

  // 预渲染整张地图（每张地图只画一次）：地砖、墙面、黄符、锁链、火把、场景点缀、出入口
  mapCanvas(map) {
    if (this.bgCache.uid === map.uid) return this.bgCache;
    const T = this.T, theme = this.themeFor(map.floor);
    const c = document.createElement('canvas');
    c.width = map.cols * T; c.height = map.rows * T;
    const g = c.getContext('2d');
    const rng = IdleCore.createRng(map.seed + 99);
    const wall = (x, y) => !IdleCore.walkable(map, x, y);
    const torches = [];
    g.fillStyle = '#0b0a0e'; g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const px = x * T, py = y * T;
        if (!wall(x, y)) {
          g.fillStyle = theme.floor[(x + y) % 2];
          g.fillRect(px, py, T, T);
          g.fillStyle = 'rgba(0,0,0,0.18)';
          g.fillRect(px, py + T - 1, T, 1); g.fillRect(px + T - 1, py, 1, T);
          if (rng() < 0.25) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(px + 4 + Math.floor(rng() * 20), py + 4 + Math.floor(rng() * 20), 3, 2); }
          // 场景点缀
          const r = rng();
          if (r < 0.08) {
            const ox = px + 6 + Math.floor(rng() * 14), oy = py + 8 + Math.floor(rng() * 14);
            if (theme.deco === 'water') {
              g.fillStyle = 'rgba(115,239,247,0.13)'; g.fillRect(ox - 4, oy, 16, 5); g.fillRect(ox - 1, oy - 2, 10, 9);
              g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(ox + 2, oy + 1, 3, 1);
            } else if (theme.deco === 'lava') {
              g.fillStyle = 'rgba(239,125,87,0.6)';
              g.fillRect(ox, oy, 7, 1); g.fillRect(ox + 6, oy + 1, 1, 4); g.fillRect(ox + 6, oy + 4, 8, 1);
              g.fillStyle = 'rgba(255,205,117,0.6)'; g.fillRect(ox + 6, oy + 2, 1, 1);
            } else if (theme.deco === 'abyss') {
              g.fillStyle = 'rgba(200,160,224,0.22)';
              g.fillRect(ox, oy, 8, 1); g.fillRect(ox + 3, oy - 3, 1, 8); g.fillRect(ox + 1, oy - 2, 1, 1); g.fillRect(ox + 6, oy + 2, 1, 1);
            } else {
              g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(ox, oy, 6, 1); g.fillRect(ox + 5, oy + 1, 1, 4);
            }
          } else if (r < 0.11) {
            // 散落的白骨
            const ox = px + 8 + Math.floor(rng() * 12), oy = py + 10 + Math.floor(rng() * 12);
            g.fillStyle = 'rgba(232,220,192,0.45)'; g.fillRect(ox, oy, 7, 2); g.fillRect(ox - 1, oy - 1, 2, 4); g.fillRect(ox + 6, oy - 1, 2, 4);
          }
          continue;
        }
        // 墙：下方是地面的墙画成砖墙立面，其余画成墙顶
        if (y + 1 < map.rows && !wall(x, y + 1)) {
          g.fillStyle = theme.wall; g.fillRect(px, py, T, T);
          for (let by = 0; by < T; by += 8) {
            const off = (by / 8) % 2 ? 0 : 8;
            for (let bx = -8 + off; bx < T; bx += 16) {
              g.fillStyle = theme.brick;
              g.fillRect(px + Math.max(0, bx) + 1, py + by + 1, Math.min(14, T - Math.max(0, bx) - 1, bx + 15), 6);
            }
          }
          g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px, py + T - 3, T, 3);
          const d = rng();
          if (d < 0.14) {
            // 镇妖黄符
            const fx = px + 12;
            g.fillStyle = '#d8b04a'; g.fillRect(fx, py + 8, 8, 16);
            g.fillStyle = '#b13e53'; g.fillRect(fx + 3, py + 10, 2, 12); g.fillRect(fx + 1, py + 13, 6, 1);
          } else if (d < 0.2) {
            // 锁链
            g.fillStyle = '#6b6b6b';
            for (let cy = 2; cy < T - 4; cy += 4) g.fillRect(px + 15 + ((cy / 4) % 2), py + cy, 2, 3);
          } else if (d < 0.3) {
            torches.push({ x: px + 16, y: py + 14 });
          }
          if (rng() < 0.15) { g.fillStyle = theme.moss; g.globalAlpha = 0.45; g.fillRect(px + Math.floor(rng() * 24), py + T - 6, 5, 3); g.globalAlpha = 1; }
        } else {
          g.fillStyle = '#100e14'; g.fillRect(px, py, T, T);
          // 与地面相邻的墙顶描边
          g.fillStyle = theme.wall;
          if (y > 0 && !wall(x, y - 1)) g.fillRect(px, py, T, 4);
          if (x > 0 && !wall(x - 1, y)) g.fillRect(px, py, 4, T);
          if (x + 1 < map.cols && !wall(x + 1, y)) g.fillRect(px + T - 4, py, 4, T);
        }
      }
    }
    // 入口（向上的石阶）
    const ex = Math.floor(map.entry.x) * T, ey = Math.floor(map.entry.y) * T;
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#6f6250' : '#8a7b64'; g.fillRect(ex + 2, ey + i * 7, T - 4, 6); }
    // 下行阶梯
    const sx = Math.floor(map.stairs.x) * T, sy = Math.floor(map.stairs.y) * T;
    g.fillStyle = '#050407'; g.fillRect(sx + 1, sy + 1, T - 2, T - 2);
    for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(138,123,100,${0.85 - i * 0.2})`; g.fillRect(sx + 3 + i * 2, sy + 3 + i * 7, T - 6 - i * 4, 4); }
    g.strokeStyle = '#c7a35a'; g.lineWidth = 1; g.strokeRect(sx + 0.5, sy + 0.5, T - 1, T - 1);
    // 镇守殿：封印阵
    const bossPack = map.packs.find(p => p.kind === 'boss');
    if (bossPack) {
      g.strokeStyle = 'rgba(177,62,83,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.arc(bossPack.x * T, bossPack.y * T + 10, 40, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(bossPack.x * T, bossPack.y * T + 10, 30, 0, Math.PI * 2); g.stroke();
    }
    this.bgCache = { uid: map.uid, canvas: c, torches };
    return this.bgCache;
  },

  draw() {
    const g = this.ctx;
    if (!g || !this.run || !this.run.map) return;
    const run = this.run, v = this.view, W = this.W, H = this.H, T = this.T, map = run.map;
    if (v.mapUid !== map.uid) this.revealFog();
    const now = performance.now() / 1000;
    const bg = this.mapCanvas(map);
    const camX = Math.round(v.camX || 0), camY = Math.round(v.camY || 0);
    g.save();
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#07060a'; g.fillRect(0, 0, W, H);
    if (v.shake > 0) g.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 4));
    g.drawImage(bg.canvas, camX, camY, W, H, 0, 0, W, H);
    g.save();
    g.translate(-camX, -camY);
    const inView = (x, y, m = 40) => x > camX - m && x < camX + W + m && y > camY - m && y < camY + H + m;

    // 火把
    for (const t of bg.torches) {
      if (!inView(t.x, t.y) || !this.seen(t.x / T, t.y / T + 1)) continue;
      const flick = Math.sin(now * 12 + t.x) > 0 ? 1 : 0;
      g.fillStyle = '#5a3a1e'; g.fillRect(t.x - 1, t.y, 3, 8);
      g.fillStyle = '#ef7d57'; g.fillRect(t.x - 2, t.y - 5 - flick, 5, 5);
      g.fillStyle = '#ffcd75'; g.fillRect(t.x - 1, t.y - 4 - flick, 3, 3);
      const glow = g.createRadialGradient(t.x, t.y - 3, 1, t.x, t.y - 3, 40);
      glow.addColorStop(0, 'rgba(247,164,58,0.3)'); glow.addColorStop(1, 'rgba(247,164,58,0)');
      g.fillStyle = glow; g.fillRect(t.x - 40, t.y - 43, 80, 80);
    }
    // 下行阶梯提示
    if (this.seen(map.stairs.x, map.stairs.y)) {
      const a = 0.5 + Math.sin(now * 3) * 0.3;
      g.fillStyle = `rgba(255,205,117,${a})`;
      g.font = 'bold 10px "Microsoft YaHei", sans-serif'; g.textAlign = 'center';
      g.fillText('下', map.stairs.x * T, map.stairs.y * T - 18);
    }
    // 秘藏宝箱
    const chest = map.chest;
    if (chest && this.seen(chest.x, chest.y)) this.drawChest(g, chest.x * T, chest.y * T + 8, chest.opened, now);
    // 藏宝洞
    const tr = map.treasure;
    if (tr && this.seen(tr.x, tr.y)) this.drawTreasure(g, tr.x * T, tr.y * T + 10, tr.opened, now);
    // 游商
    const mc = map.merchant;
    if (mc && this.seen(mc.x, mc.y)) this.drawMerchant(g, mc, now);

    // 还没惊动的怪群（看得见才画）
    const sprites = [];
    for (const p of map.packs) {
      if (p.cleared || p === run.pack || !this.seen(p.x, p.y)) continue;
      p.enemies.forEach((e, i) => {
        if (e.hp <= 0) return;
        const [ox, oy] = this.packOffset(i, p.kind === 'boss' || p.kind === 'nemesis');
        sprites.push({ idle: true, ref: e, x: p.x * T + ox, y: p.y * T + 10 + oy, uid: e.uid, boss: e.tier === 'boss' || !!e.nemesis, flash: 0, lunge: 0, dying: 0 });
      });
    }
    for (const ve of v.enemies.values()) sprites.push(ve);
    const hp = this.heroPx();
    sprites.push({ hero: true, y: hp.y });
    sprites.sort((a, b) => a.y - b.y);
    for (const sp of sprites) {
      if (sp.hero) this.drawHero(g, now);
      else if (inView(sp.x, sp.y)) this.drawEnemy(g, sp, now);
    }

    // 特效 + 飘字（世界坐标）
    for (const f of v.fx) this.drawFx(g, f, now);
    g.textAlign = 'center';
    for (const t of v.texts) {
      const k = t.t / t.life;
      const y = t.y - k * (t.fixed ? 10 : 22);
      g.globalAlpha = Math.min(1, (1 - k) * 2);
      g.font = t.big ? 'bold 12px "Microsoft YaHei", sans-serif' : 'bold 10px "Microsoft YaHei", monospace';
      g.lineWidth = 3; g.strokeStyle = '#1a1c2c';
      g.strokeText(t.text, Math.round(t.x), Math.round(y));
      g.fillStyle = t.color;
      g.fillText(t.text, Math.round(t.x), Math.round(y));
    }
    g.globalAlpha = 1;

    // 迷雾：没去过的地方全黑
    g.fillStyle = '#07060a';
    const x0 = Math.floor(camX / T), y0 = Math.floor(camY / T);
    for (let y = y0; y <= y0 + Math.ceil(H / T) + 1; y++) for (let x = x0; x <= x0 + Math.ceil(W / T) + 1; x++) {
      if (x < map.cols && y < map.rows && !v.fog[y * map.cols + x]) g.fillRect(x * T, y * T, T, T);
    }
    g.restore();

    // 灯火：越深越暗，只照亮主角周围
    const sx = hp.x - camX, sy = hp.y - 14 - camY;
    const fx = map.fx || {};
    const radius = Math.max(110, 200 - run.floor * 2.5) * (fx.light || 1);
    const dark = Math.min(0.88, 0.3 + run.floor * 0.012 + (fx.light < 1 ? 0.08 : 0));
    const lg = g.createRadialGradient(sx, sy, radius * 0.3, sx, sy, radius);
    lg.addColorStop(0, 'rgba(10,8,14,0)');
    lg.addColorStop(1, `rgba(10,8,14,${dark})`);
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    this.drawAffixAtmos(g, map, now);

    this.drawMinimap(g);

    // 横幅
    if (v.banner) {
      const b = v.banner;
      const a = Math.min(1, b.t * 4, (b.life - b.t) * 3);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = 'rgba(10,8,14,0.75)';
      g.fillRect(0, 110, W, 22);
      g.font = 'bold 12px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      if (b.sub) {
        g.fillStyle = 'rgba(10,8,14,0.75)'; g.fillRect(0, 132, W, 16);
        g.font = '10px "Microsoft YaHei", sans-serif';
        g.fillStyle = b.subColor || '#d6c696';
        g.fillText(b.sub, W / 2, 144);
        g.font = 'bold 12px "Microsoft YaHei", sans-serif';
      }
      g.fillStyle = b.color;
      g.fillText(b.text, W / 2, 125);
      g.globalAlpha = 1;
    }
    if (run.phase === 'dead') {
      g.fillStyle = 'rgba(80,10,20,0.35)';
      g.fillRect(0, 0, W, H);
    }
    if (run.phase === 'descend') {
      g.fillStyle = `rgba(0,0,0,${Math.min(1, 1 - run.phaseTimer / 0.8)})`;
      g.fillRect(0, 0, W, H);
    }
    g.restore();
  },

  // 右上角小地图：已探索区域、看到的怪群、秘藏和阶梯
  drawMinimap(g) {
    const run = this.run, map = run.map, v = this.view, S = 2;
    const mw = map.cols * S, mh = map.rows * S, ox = this.W - mw - 4, oy = 4;
    g.fillStyle = 'rgba(7,6,10,0.75)'; g.fillRect(ox - 2, oy - 2, mw + 4, mh + 4);
    g.strokeStyle = 'rgba(199,163,90,0.6)'; g.lineWidth = 1; g.strokeRect(ox - 2.5, oy - 2.5, mw + 5, mh + 5);
    g.fillStyle = 'rgba(214,198,150,0.7)';
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) {
      const i = y * map.cols + x;
      if (v.fog[i] && map.tiles[i]) g.fillRect(ox + x * S, oy + y * S, S, S);
    }
    const dot = (x, y, c, r = 2) => { g.fillStyle = c; g.fillRect(ox + Math.floor(x * S) - 1, oy + Math.floor(y * S) - 1, r + 1, r + 1); };
    for (const p of map.packs) if (!p.cleared && this.seen(p.x, p.y)) dot(p.x, p.y, p.kind === 'boss' ? '#ff8a3d' : p.kind === 'nemesis' ? '#ff4d4d' : p.kind === 'elite' ? '#5fa8ff' : '#b13e53');
    if (map.treasure && !map.treasure.opened) dot(map.treasure.x, map.treasure.y, '#ffe14d', 3);
    if (map.merchant && this.seen(map.merchant.x, map.merchant.y)) dot(map.merchant.x, map.merchant.y, '#f7a43a');
    if (map.chest && !map.chest.opened && this.seen(map.chest.x, map.chest.y)) dot(map.chest.x, map.chest.y, '#ffe14d');
    if (this.seen(map.stairs.x, map.stairs.y)) dot(map.stairs.x, map.stairs.y, '#a7f070');
    if (Math.floor(performance.now() / 300) % 2) dot(run.hx, run.hy, '#ffffff');
  },

  drawChest(g, x, y, opened, now) {
    x = Math.round(x); y = Math.round(y);
    this.shadow(g, x, y + 1, 12);
    g.fillStyle = '#1a1c2c'; g.fillRect(x - 11, y - 15, 22, 15);
    g.fillStyle = '#8a5a2b'; g.fillRect(x - 10, y - 10, 20, 9);
    g.fillStyle = '#c7a35a'; g.fillRect(x - 10, y - 10, 20, 2); g.fillRect(x - 2, y - 9, 4, 4);
    if (opened) {
      g.fillStyle = '#5a3a1e'; g.fillRect(x - 10, y - 19, 20, 5);
    } else {
      g.fillStyle = '#a0692f'; g.fillRect(x - 10, y - 14, 20, 4);
      g.fillStyle = '#c7a35a'; g.fillRect(x - 10, y - 14, 20, 1);
      const a = 0.35 + Math.sin(now * 4) * 0.25;
      g.fillStyle = `rgba(255,225,77,${a})`; g.fillRect(x - 1, y - 22 - Math.round(Math.sin(now * 4) * 2), 2, 2);
    }
  },

  // 藏宝洞：地上一个金光闪闪的大宝箱
  drawTreasure(g, x, y, opened, now) {
    x = Math.round(x); y = Math.round(y);
    if (!opened) {
      const r = 30 + Math.sin(now * 3) * 4;
      const glow = g.createRadialGradient(x, y - 10, 3, x, y - 10, r);
      glow.addColorStop(0, 'rgba(255,225,77,0.45)'); glow.addColorStop(1, 'rgba(255,225,77,0)');
      g.fillStyle = glow; g.fillRect(x - r, y - 10 - r, r * 2, r * 2);
    }
    this.shadow(g, x, y + 1, 18);
    g.fillStyle = '#1a1c2c'; g.fillRect(x - 16, y - 21, 32, 21);
    g.fillStyle = '#7a4a1e'; g.fillRect(x - 15, y - 13, 30, 12);
    g.fillStyle = '#ffcd75'; g.fillRect(x - 15, y - 13, 30, 2); g.fillRect(x - 3, y - 12, 6, 6); g.fillRect(x - 15, y - 13, 2, 12); g.fillRect(x + 13, y - 13, 2, 12);
    if (opened) {
      g.fillStyle = '#5a3a1e'; g.fillRect(x - 15, y - 26, 30, 6);
    } else {
      g.fillStyle = '#a0692f'; g.fillRect(x - 15, y - 20, 30, 7);
      g.fillStyle = '#ffcd75'; g.fillRect(x - 15, y - 20, 30, 1);
      for (let i = 0; i < 3; i++) {
        const k = (now * 0.8 + i / 3) % 1;
        g.fillStyle = `rgba(255,225,77,${1 - k})`;
        g.fillRect(x - 10 + i * 10, Math.round(y - 24 - k * 16), 2, 2);
      }
    }
    g.font = 'bold 9px "Microsoft YaHei", sans-serif'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeStyle = '#1a1c2c'; g.strokeText(opened ? '藏宝洞（已空）' : '藏宝洞', x, y - 30);
    g.fillStyle = opened ? '#94b0c2' : '#ffe14d'; g.fillText(opened ? '藏宝洞（已空）' : '藏宝洞', x, y - 30);
  },

  drawMerchant(g, mc, now) {
    const x = Math.round(mc.x * this.T), y = Math.round(mc.y * this.T + 10);
    const lamp = 0.25 + Math.sin(now * 6) * 0.06;
    const glow = g.createRadialGradient(x - 10, y - 18, 2, x - 10, y - 18, 34);
    glow.addColorStop(0, `rgba(247,164,58,${lamp})`); glow.addColorStop(1, 'rgba(247,164,58,0)');
    g.fillStyle = glow; g.fillRect(x - 44, y - 52, 68, 68);
    this.shadow(g, x, y + 1, 12);
    const mcv = this.sprite32('npc_merchant', 'idle' + (Math.floor(now * 2) % 2), 'E');
    if (mcv) this.drawCanvas(g, mcv, x, y, 1, this.run.hx < mc.x);
    else this.drawSprite(g, 'npc_merchant', x, y + Math.round(Math.sin(now * 2) * 0.6), 2, 1, this.run.hx < mc.x);
    g.font = 'bold 9px "Microsoft YaHei", sans-serif'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeStyle = '#1a1c2c'; g.strokeText('游商', x, y - 36);
    g.fillStyle = '#f7a43a'; g.fillText('游商', x, y - 36);
  },

  // 异象氛围：整屏淡淡的色调 + 飘散的光点
  drawAffixAtmos(g, map, now) {
    const affs = (map.affixes || []).map(id => IdleCore.AFFIXES[id]).filter(Boolean);
    if (!affs.length) return;
    affs.forEach((a, j) => {
      const c = a.color;
      const rgb = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(',');
      g.fillStyle = `rgba(${rgb},0.06)`;
      g.fillRect(0, 0, this.W, this.H);
      const up = a.burn || a.name === '灵气充盈' ? -1 : 1;
      for (let i = 0; i < 14; i++) {
        const seed = i * 97.13 + j * 31.7;
        const k = ((now * (0.05 + (i % 5) * 0.012)) + (seed % 1)) % 1;
        const px = (seed * 13.7 + Math.sin(now * 0.7 + i) * 12) % this.W;
        const py = up < 0 ? this.H * (1 - k) : this.H * k;
        g.fillStyle = `rgba(${rgb},${0.25 + 0.35 * Math.sin(k * Math.PI)})`;
        g.fillRect(Math.round((px + this.W) % this.W), Math.round(py), 2, 2);
      }
    });
  },

  drawSprite(g, id, x, y, scale, alpha = 1, flip = false) {
    const sp = HomeArt.canvas(id, scale);
    if (!sp) return null;
    g.globalAlpha = alpha;
    if (flip) {
      g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1);
      g.drawImage(sp, Math.round(-sp.width / 2), Math.round(y - sp.height));
      g.restore();
    } else g.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height));
    g.globalAlpha = 1;
    return sp;
  },

  shadow(g, x, y, w) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(x, y, w, w * 0.35, 0, 0, Math.PI * 2); g.fill();
  },

  // 32×32 像素角色（idle-sprites32.js）：脚底对齐 (x, y)，可镜像、旋转
  drawCanvas(g, cv, x, y, alpha = 1, flip = false, rot = 0) {
    if (!cv) return null;
    g.save(); g.globalAlpha = alpha;
    g.translate(Math.round(x), Math.round(y));
    if (rot) { g.translate(0, -cv.height / 2); g.rotate(rot); g.translate(0, cv.height / 2); }
    if (flip) g.scale(-1, 1);
    g.drawImage(cv, Math.round(-cv.width / 2), -cv.height);
    g.restore();
    return cv;
  },

  // 方向向量 -> 8 方向
  dir8(dx, dy) {
    const i = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][i];
  },

  sprite32(key, frame, dir = 'E') {
    return typeof IdleSprites !== 'undefined' && IdleSprites.has(key) ? IdleSprites.frame(key, frame, dir) : null;
  },

  drawHero(g, now) {
    const run = this.run, v = this.view;
    const walking = run.phase === 'walk' && run.path && run.path.length > 0;
    const { x: hx, y: hy } = this.heroPx();
    const x = Math.round(hx);
    // 朝向：行走看位移，战斗看怪群
    if (v.lastHx !== null) {
      const mdx = hx - v.lastHx, mdy = hy - v.lastHy;
      if (Math.hypot(mdx, mdy) > 0.05) v.heroDir = this.dir8(mdx, mdy);
    }
    v.lastHx = hx; v.lastHy = hy;
    if (run.phase === 'fight' && run.pack) v.heroDir = this.dir8(run.pack.x * this.T - hx, run.pack.y * this.T + 10 - hy);
    const bob = walking ? 0 : Math.round(Math.sin(now * 3) * 0.6);
    // 攻击时向目标扑一下
    let lx = 0, ly = 0;
    if (v.lunge > 0 && run.pack) {
      const dx = run.pack.x * this.T - hx, dy = run.pack.y * this.T + 10 - hy, d = Math.hypot(dx, dy) || 1;
      const p = Math.sin(v.lunge * Math.PI);
      lx = dx / d * p * 5; ly = dy / d * p * 5;
    }
    const y = Math.round(hy + bob + ly);
    const facing = /W/.test(v.heroDir) ? -1 : /E/.test(v.heroDir) ? 1 : run.facing;
    const flip = facing < 0;
    // 宠物跟在身后
    const pet = player.home && player.home.activePet;
    if (pet) {
      const px = x - 22 * facing, py = Math.round(hy - 2 + Math.sin(now * (walking ? 10 : 3)) * 2);
      this.shadow(g, px, hy - 1, 9);
      this.drawSprite(g, 'pet_' + pet, px, py, 2, 1, flip);
    }
    this.shadow(g, x, hy + 1, 11);
    const dead = run.phase === 'dead';
    let fr;
    if (dead) fr = 'hurt';
    else if (v.lunge > 0) fr = v.lunge > 0.7 ? 'atk0' : v.lunge > 0.35 ? 'atk1' : 'atk2';
    else if (v.cast > 0) fr = v.cast > 0.25 ? 'cast0' : 'cast1';
    else if (v.heroFlash > 0.05) fr = 'hurt';
    else if (walking) fr = 'walk' + (Math.floor(now * 8) % 4);
    else fr = 'idle' + (Math.floor(now * 2) % 2);
    const [dd, dflip] = (typeof IdleSprites !== 'undefined' && IdleSprites.DIR8[v.heroDir]) || ['S', false];
    const cv = this.sprite32('hero', fr, dd);
    if (cv) this.drawCanvas(g, cv, x + Math.round(lx), y, dead ? 0.55 : 1, dflip, dead ? Math.PI / 2 : 0);
    else this.drawSprite(g, v.lunge > 0.3 ? 'idle_hero_atk' : 'idle_hero', x + Math.round(lx), y, 2, dead ? 0.45 : 1, flip);
    // 技能：掌心聚气的像素光点
    if (v.cast > 0 && !dead) {
      for (let i = 0; i < 4; i++) {
        const a = now * 9 + i * Math.PI / 2, r = 6 + (0.4 - v.cast) * 30;
        g.fillStyle = i % 2 ? '#ffcd75' : '#f4f4f4';
        g.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y - 16 + Math.sin(a) * r * 0.6), 2, 2);
      }
    }
    if (run.shield > 0) {
      const bf = typeof IdleSprites !== 'undefined' ? IdleSprites.fx('bell', 2) : null;
      if (bf) this.drawCanvas(g, bf, x, y + 4, 0.35 + Math.sin(now * 6) * 0.1);
      g.strokeStyle = 'rgba(255,210,77,0.6)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(x, y - 14, 19 + Math.sin(now * 8), 0, Math.PI * 2); g.stroke();
    }
  },

  // 妖物种类 / 镇守名 -> 32×32 精灵
  mobKey(e) {
    if (e.tier === 'boss') {
      const B = { '血蝠妖': 'boss_bat', '白骨夫人': 'boss_bone', '铜甲尸王': 'boss_corpse', '千年树妖': 'boss_tree', '九尾天狐': 'boss_fox', '魔蛟': 'boss_jiao' };
      return B[e.baseName] || B[String(e.name || '').replace(/^.*·/, '')] || 'boss_jiao';
    }
    return 'mob_' + e.type;
  },

  drawEnemy(g, ve, now) {
    const e = ve.ref;
    const key = this.mobKey(e);
    const hp = this.heroPx();
    // 近战扑向主角
    let lx = 0, ly = 0;
    if (ve.lunge > 0) {
      const dx = hp.x - ve.x, dy = hp.y - ve.y, d = Math.hypot(dx, dy) || 1;
      const p = Math.sin(ve.lunge * Math.PI);
      lx = dx / d * p * 10; ly = dy / d * p * 10;
    }
    const x = Math.round(ve.x + lx), y = Math.round(ve.y + ly);
    const alpha = ve.dying > 0 ? Math.max(0, 1 - ve.dying * 2) : 1;
    const big = e.tier === 'boss';
    this.shadow(g, ve.x, ve.y + 1, big ? 18 : 10);
    if (e.nemesis && alpha > 0.5) {
      const r = 24 + Math.sin(now * 5) * 3;
      const aura = g.createRadialGradient(ve.x, ve.y - 16, 4, ve.x, ve.y - 16, r);
      aura.addColorStop(0, 'rgba(255,60,60,0.4)'); aura.addColorStop(1, 'rgba(255,60,60,0)');
      g.fillStyle = aura; g.fillRect(ve.x - r, ve.y - 16 - r, r * 2, r * 2);
    }
    const jitter = ve.flash > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    const flip = hp.x < ve.x;
    let fr;
    if (ve.dying > 0 || ve.flash > 0.04) fr = 'hurt';
    else if (ve.lunge > 0) fr = ve.lunge > 0.5 ? 'atk0' : 'atk1';
    else if (ve.idle) fr = 'idle' + (Math.floor(now * 2 + ve.uid * 0.37) % 2);
    else fr = 'walk' + (Math.floor(now * 4 + ve.uid * 0.37) % 2);
    const cv = this.sprite32(key, fr, 'E');
    let h = 32;
    if (cv) { this.drawCanvas(g, cv, x + jitter, y, alpha, flip); h = cv.height; }
    else {
      const scale = ve.boss ? 3 : 2;
      const sprite = (typeof IDLE_MONSTER_SPRITE !== 'undefined' && IDLE_MONSTER_SPRITE[e.type]) || 'mob_melee';
      this.drawSprite(g, sprite, x + jitter, y, scale, alpha, flip); h = 16 * scale;
    }
    if (e.tier === 'elite' && !e.nemesis && alpha > 0.5) {
      g.fillStyle = 'rgba(95,168,255,0.9)';
      // 精英：脚下四角像素框
      for (const [cx, cy] of [[-15, -h], [12, -h], [-15, -2], [12, -2]]) { g.fillRect(x + cx, y + cy, 3, 1); g.fillRect(x + cx + (cx < 0 ? 0 : 2), y + cy + (cy < -4 ? 0 : -2), 1, 3); }
    }
    if (ve.dying > 0) return;
    const top = y - h - 4;
    if (!ve.idle) {
      const bw = big ? 48 : e.nemesis ? 36 : 26;
      g.fillStyle = '#1a1c2c'; g.fillRect(x - bw / 2 - 1, top - 1, bw + 2, 5);
      g.fillStyle = e.nemesis ? '#ff4d4d' : big ? '#ff8a3d' : (e.tier === 'elite' ? '#5fa8ff' : '#b13e53');
      g.fillRect(x - bw / 2, top, Math.max(0, Math.round(bw * e.hp / e.maxHp)), 3);
    }
    if (ve.boss || e.tier === 'elite') {
      g.font = '9px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = '#1a1c2c';
      g.strokeText(e.nemesis ? `${e.name} ☠` : e.name, x, top - 3);
      g.fillStyle = e.nemesis ? '#ff4d4d' : ve.boss ? '#ff8a3d' : '#9fc6ff';
      g.fillText(e.nemesis ? `${e.name} ☠` : e.name, x, top - 3);
    }
  },

  // 像素特效：k = 进度 0..1 -> 第几帧
  fxFrame(name, k) {
    const n = (typeof IdleSprites !== 'undefined' && IdleSprites.fxFrames[name]) || 1;
    return Math.min(n - 1, Math.floor(k * n));
  },

  drawFxCanvas(g, cv, x, y, rot = 0, alpha = 1) {
    if (!cv) return;
    g.save(); g.globalAlpha = alpha;
    g.translate(Math.round(x), Math.round(y));
    if (rot) g.rotate(rot);
    g.drawImage(cv, -cv.width / 2, -cv.height / 2);
    g.restore();
  },

  drawFx(g, f) {
    const k = Math.max(0, f.t) / f.life;
    if (f.t < 0) return;
    const S = typeof IdleSprites !== 'undefined' ? IdleSprites : null;
    if (f.kind === 'slash') {
      if (S) {
        this.drawFxCanvas(g, S.fx('slash', this.fxFrame('slash', k), f.ang || 0), f.x, f.y);
        if (f.crit) this.drawFxCanvas(g, S.fx('slash', this.fxFrame('slash', k), (f.ang || 0) + Math.PI), f.x, f.y, 0, 0.8);
        return;
      }
      g.strokeStyle = f.crit ? 'rgba(255,205,117,' + (1 - k) + ')' : 'rgba(244,244,244,' + (1 - k) + ')';
      g.lineWidth = f.crit ? 3 : 2;
      g.beginPath(); g.arc(f.x, f.y, 12 + k * 6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else if (f.kind === 'spark' && S) {
      this.drawFxCanvas(g, S.fx('spark', this.fxFrame('spark', k)), f.x, f.y);
    } else if (f.kind === 'blast' && S) {
      this.drawFxCanvas(g, S.fx('blast', this.fxFrame('blast', k)), f.x, f.y);
    } else if (f.kind === 'fireball') {
      const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
      if (S) {
        const ang = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
        // 拖尾火星
        for (let i = 1; i <= 3; i++) {
          g.fillStyle = i === 1 ? '#ef7d57' : '#b13e53';
          g.fillRect(Math.round(x - Math.cos(ang) * i * 5), Math.round(y - Math.sin(ang) * i * 5), 3 - i + 1, 3 - i + 1);
        }
        this.drawFxCanvas(g, S.fx('palm', Math.floor(f.t * 20) % 2), x, y);
        return;
      }
      g.fillStyle = 'rgba(239,125,87,1)';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
    } else if (f.kind === 'lightning') {
      // 像素折线：粗青色 + 白芯，2px 方块步进
      const pts = [[f.x0, f.y0]];
      const seg = 6;
      for (let i = 1; i <= seg; i++) {
        const tt = i / seg;
        const j = i === seg ? 0 : (Math.sin((f.seed * 100 + i) * 12.9898) * 43758.5453 % 1) * 14;
        pts.push([f.x0 + (f.x1 - f.x0) * tt + j, f.y0 + (f.y1 - f.y0) * tt]);
      }
      if (k > 0.75 && Math.floor(f.t * 30) % 2) return;
      for (let i = 0; i < seg; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 2);
        for (let s = 0; s <= n; s++) {
          const px = Math.round(ax + (bx - ax) * s / n), py = Math.round(ay + (by - ay) * s / n);
          g.fillStyle = '#41a6f6'; g.fillRect(px - 2, py - 1, 4, 3);
          g.fillStyle = '#73eff7'; g.fillRect(px - 1, py - 1, 2, 3);
          g.fillStyle = '#f4f4f4'; g.fillRect(px, py, 1, 1);
        }
      }
    } else if (f.kind === 'dart' && S) {
      const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
      const ang = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
      this.drawFxCanvas(g, S.fx('dart', Math.floor(f.t * 20) % 2), x, y, Math.round(ang / (Math.PI / 4)) * (Math.PI / 4));
    } else if (f.kind === 'dart' || f.kind === 'bolt') {
      const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
      const ang = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
      // 妖弹：像素光球 + 拖尾
      for (let i = 0; i < 4; i++) {
        g.fillStyle = i ? (f.color || '#ffcd75') : '#f4f4f4';
        const sz = i ? 3 - (i >> 1) : 3;
        g.fillRect(Math.round(x - Math.cos(ang) * i * 3 - sz / 2), Math.round(y - Math.sin(ang) * i * 3 - sz / 2), sz, sz);
      }
    } else if (f.kind === 'bell') {
      const hp = this.heroPx();
      if (S) {
        const fr = k < 0.25 ? 0 : k < 0.7 ? 1 : 2;
        const drop = k < 0.25 ? Math.round((0.25 - k) * -60) : 0;
        this.drawFxCanvas(g, S.fx('bell', fr), hp.x, hp.y - 14 + drop, 0, k < 0.7 ? 1 : (1 - k) / 0.3);
      }
      g.strokeStyle = `rgba(255,210,77,${1 - k})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(hp.x, hp.y - 14, 14 + k * 30, 0, Math.PI * 2); g.stroke();
    }
  },

  // ---------- 界面 ----------
  ensureDom() {
    if (document.getElementById('idle-mode')) return;
    const wrap = document.createElement('div');
    wrap.id = 'idle-mode';
    wrap.innerHTML = `
      <div class="idle-shell">
        <div class="idle-top">
          <div class="idle-title">镇妖塔 · 第 <b id="idle-floor">1</b> 层</div>
          <div class="idle-sub" id="idle-sub"></div>
          <button class="idle-x" data-idle="close" title="返回营地">×</button>
        </div>
        <div class="idle-bars">
          <div class="idle-bar idle-hpbar"><div class="idle-fill" id="idle-hp"></div><div class="idle-shield" id="idle-shield"></div><span id="idle-hp-text"></span></div>
          <div class="idle-bar idle-xpbar"><div class="idle-fill" id="idle-xp"></div><span id="idle-xp-text"></span></div>
          <div class="idle-explore" id="idle-explore"></div>
        </div>
        <div class="idle-stage"><canvas id="idle-canvas" width="${this.W}" height="${this.H}"></canvas><div class="idle-panel" id="idle-panel"></div></div>
        <div class="idle-tabs">
          <button class="idle-tab" data-idle="panel" data-arg="floors">📜 塔志</button>
          <button class="idle-tab" data-idle="panel" data-arg="mats">🎒 材料·炼制</button>
          <button class="idle-tab" data-idle="panel" data-arg="bounty" id="idle-tab-bounty">📋 悬赏</button>
        </div>
        <div class="idle-skills" id="idle-skills"></div>
        <div class="idle-session" id="idle-session"></div>
        <div class="idle-log" id="idle-log"></div>
        <div class="idle-actions">
          <button class="idle-btn" data-idle="advance" id="idle-advance"></button>
          <button class="idle-btn" data-idle="retreat">↑ 上一层</button>
          <button class="idle-btn" data-idle="keep" id="idle-keep"></button>
          <button class="idle-btn idle-btn-home" data-idle="close">回营地</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const off = document.createElement('div');
    off.id = 'idle-offline';
    off.innerHTML = `
      <div class="idle-offline-card">
        <div class="idle-offline-title">闭关归来</div>
        <div class="idle-offline-body"></div>
        <div class="idle-actions">
          <button class="idle-btn" data-idle="offline-stay">留在营地</button>
          <button class="idle-btn idle-btn-main" data-idle="offline-resume">继续下镇妖塔</button>
        </div>
      </div>`;
    document.body.appendChild(off);
    const onClick = e => {
      const b = e.target.closest('[data-idle]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.idle, arg = b.dataset.arg;
      if (b.disabled) return;
      if (a === 'close') this.close();
      else if (a === 'panel') this.openPanel(arg);
      else if (a === 'panel-close') this.openPanel(null);
      else if (a === 'go') this.goFloor(+arg);
      else if (a === 'filter') { this.matFilter = this.matFilter === arg ? null : arg; this.renderPanel(); }
      else if (a === 'craft') this.craft(arg);
      else if (a === 'upgrade') this.upgradeArtifact(arg);
      else if (a === 'claim') this.claimBounty(+arg);
      else if (a === 'trade') this.trade(+arg);
      else if (a === 'use-map') this.useTreasureMap();
      else if (a === 'reroll') this.rerollBounty(+arg);
      else if (a === 'advance') this.toggleAdvance();
      else if (a === 'retreat') this.retreat();
      else if (a === 'keep') this.cycleKeep();
      else if (a === 'offline-stay') this.closeOffline(false);
      else if (a === 'offline-resume') this.closeOffline(true);
    };
    wrap.addEventListener('click', onClick);
    off.addEventListener('click', onClick);
    // 阻止事件穿透到游戏画布（避免点击挂机界面时角色在营地里走动）
    for (const el of [wrap, off]) {
      for (const ev of ['mousedown', 'mouseup', 'touchstart', 'touchend', 'contextmenu', 'wheel']) el.addEventListener(ev, e => e.stopPropagation());
    }
    this.canvas = wrap.querySelector('#idle-canvas');
    this.ctx = this.canvas.getContext('2d');
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if (!this.canvas) return;
    const stage = this.canvas.parentElement;
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // 能放大 2 倍以上时取整数倍保证像素清晰，否则按比例铺满
    let s = Math.min(r.width / this.W, r.height / this.H);
    if (s >= 2) s = Math.floor(s);
    this.canvas.style.width = Math.floor(this.W * s) + 'px';
    this.canvas.style.height = Math.floor(this.H * s) + 'px';
  },

  renderUI(full) {
    if (!this.run || typeof document === 'undefined') return;
    const run = this.run, s = this.state();
    const $ = id => document.getElementById(id);
    $('idle-floor').textContent = run.floor;
    const bossFloor = IdleCore.isBossFloor(run.floor);
    $('idle-sub').textContent = `${this.themeFor(run.floor).name} · 最深 ${s.maxFloor} 层${bossFloor ? ' · 镇守层' : ''}`;
    const hpPct = Math.max(0, run.hp / run.hero.maxHp * 100);
    $('idle-hp').style.width = hpPct + '%';
    $('idle-shield').style.width = Math.min(100, run.shield / run.hero.maxHp * 100) + '%';
    $('idle-hp-text').textContent = `气血 ${Math.ceil(Math.max(0, run.hp))} / ${run.hero.maxHp}  ·  疗伤药 ${run.medicine}`;
    const xpPct = player.xpNext ? Math.min(100, player.xp / player.xpNext * 100) : 0;
    $('idle-xp').style.width = xpPct + '%';
    $('idle-xp-text').textContent = `Lv.${player.lvl}  ${xpPct.toFixed(1)}%`;
    const map = run.map, packs = map.packs;
    const done = packs.filter(p => p.cleared).length;
    const elite = packs.filter(p => p.kind === 'elite'), boss = packs.find(p => p.kind === 'boss');
    const info = IdleCore.floorInfo(run.floor);
    const buffs = Object.keys(IdleCore.RECIPES).filter(id => (s.buffs[id] || 0) > Date.now()).map(id => IdleCore.RECIPES[id].name);
    const exploreHtml = `<span>怪群 <b>${done}/${packs.length}</b></span><span>精英 <b>${elite.filter(p => p.cleared).length}/${elite.length}</b></span>`
      + (boss ? `<span class="boss">镇守 <b>${boss.cleared ? '已伏诛' : '未除'}</b></span>` : (info.boss ? '<span>镇守 <b>未归</b></span>' : ''))
      + (map.chest ? `<span class="gold">秘藏 <b>${map.chest.opened ? '已开' : '?'}</b></span>` : '')
      + `<span>主妖 <b>${this.monsterName(info.main)}</b></span>`
      + (map.packs.some(p => p.kind === 'nemesis' && !p.cleared) ? '<span class="nem">宿敌 <b>在此</b></span>' : '')
      + (map.treasure ? `<span class="gold">藏宝洞 <b>${map.treasure.opened ? '已挖' : '?'}</b></span>` : '')
      + (this.merchant() ? '<button class="idle-chip idle-merchant-btn" data-idle="panel" data-arg="merchant">🏮 游商</button>' : '')
      + (map.affixes || []).map(id => { const a = IdleCore.AFFIXES[id]; return `<span class="idle-affix" style="--c:${a.color}" title="${a.desc}">${a.name}</span>`; }).join('')
      + (buffs.length ? `<span class="buff">${buffs.join(' ')}</span>` : '');
    // 内容没变就不重写，避免按钮在点击过程中被替换掉
    if (this._exploreHtml !== exploreHtml) { this._exploreHtml = exploreHtml; $('idle-explore').innerHTML = exploreHtml; }
    const ss = this.session;
    $('idle-session').innerHTML = `本次 击杀 <b>${ss.kills}</b> · 金币 <b>${ss.gold + ss.soldGold}</b> · 经验 <b>${ss.xp}</b> · 装备 <b>${ss.items}</b> · 材料 <b>${ss.mats}</b>${ss.home ? ` · 家园 <b>${ss.home}</b>` : ''}`;
    const ready = s.bounties.filter(b => b.done).length;
    $('idle-tab-bounty').innerHTML = `📋 悬赏${ready ? ` <em>${ready}</em>` : ''}`;
    // 武学触发器
    const trig = IdleCore.heroTriggers(run.hero);
    $('idle-skills').innerHTML = trig.map(t => {
      const cd = run.cooldowns[t.id] || 0;
      const icd = t.def.icd || (t.def.interval ? t.def.interval(t.lv) : 0);
      let pct = 0;
      if (t.def.cond === 'interval') pct = 1 - (run.intervalTimers[t.id] || 0) / t.def.interval(t.lv);
      else if (icd) pct = cd / icd;
      else if (t.def.cond === 'everyN') { const n = t.def.n(t.lv); pct = 1 - Math.min(n, run.charges[t.id] || 0) / n; }
      return `<div class="idle-skill" style="--c:${t.def.color}" title="${t.def.desc(t.lv)}"><div class="idle-skill-cd" style="height:${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%"></div><span>${t.def.name}</span><i>${t.lv}</i></div>`;
    }).join('') || '<div class="idle-hint">还没有学会武学，回营地学技能</div>';
    if (full) {
      this.renderPanel();
      $('idle-advance').textContent = run.autoAdvance ? '⬇ 自动深入' : '⏸ 停留本层';
      $('idle-advance').classList.toggle('on', run.autoAdvance);
      $('idle-keep').textContent = `拾取：${{ 2: '蓝装+', 3: '黄装+', 4: '暗金' }[s.keepMin]}`;
      this.renderLog();
    }
  },

  // ---------- 面板：塔志 / 材料·炼制 / 悬赏 ----------
  monsterName(type) {
    const m = IdleCore.MONSTERS.find(x => x.type === type);
    return m ? m.name : type;
  },

  matName(id) { return (IdleCore.MATERIALS[id] || {}).name || id; },

  matsText(mats) {
    return Object.keys(mats || {}).map(id => `${this.matName(id)}×${mats[id]}`).join('、');
  },

  // 材料小标签；have 不足时标红
  matChip(id, need) {
    const m = IdleCore.MATERIALS[id], have = this.state().mats[id] || 0;
    const lack = need !== undefined && have < need;
    return `<span class="idle-mat g${m.grade}${lack ? ' lack' : ''}" style="--c:${m.color}">${m.name}${need !== undefined ? ` ${have}/${need}` : ` ${have}`}</span>`;
  },

  bountyTitle(b) {
    if (b.kind === 'kill') return `镇压「${this.monsterName(b.target)}」×${b.need}`;
    if (b.kind === 'collect') return `收集「${this.matName(b.target)}」×${b.need}`;
    if (b.kind === 'elite') return `击杀精英妖物 ×${b.need}`;
    return `讨伐镇守「${b.target}」`;
  },

  openPanel(name) {
    this.panel = this.panel === name ? null : name;
    if (this.panel === 'bounty') this.ensureBounties();
    this.renderPanel();
  },

  renderPanel() {
    const el = document.getElementById('idle-panel');
    if (!el) return;
    document.querySelectorAll('.idle-tab').forEach(b => b.classList.toggle('on', b.dataset.arg === this.panel));
    if (!this.panel) { el.classList.remove('active'); el.innerHTML = ''; return; }
    const body = this.panel === 'floors' ? this.panelFloors() : this.panel === 'mats' ? this.panelMats() : this.panel === 'merchant' ? this.panelMerchant() : this.panelBounty();
    const title = { floors: '塔志 · 各层妖物与掉落', mats: '材料 · 炼制 · 法器', bounty: '悬赏榜', merchant: '🏮 塔中游商' }[this.panel];
    const html = `<div class="idle-panel-head"><b>${title}</b><button class="idle-x" data-idle="panel-close">×</button></div><div class="idle-panel-body">${body}</div>`;
    if (el.classList.contains('active') && this._panelHtml === html) return;
    this._panelHtml = html;
    const list = el.querySelector('.idle-panel-body');
    const scroll = list ? list.scrollTop : 0;
    el.innerHTML = html;
    el.querySelector('.idle-panel-body').scrollTop = scroll;
    el.classList.add('active');
  },

  panelFloors() {
    const s = this.state(), cur = this.run ? this.run.floor : s.floor, top = s.maxFloor;
    const all = Object.keys(IdleCore.MATERIALS);
    const chips = all.map(id => {
      const m = IdleCore.MATERIALS[id];
      return `<button class="idle-chip${this.matFilter === id ? ' on' : ''}" style="--c:${m.color}" data-idle="filter" data-arg="${id}">${m.name}</button>`;
    }).join('');
    let floors = [];
    for (let f = top; f >= 1; f--) floors.push(IdleCore.floorInfo(f));
    floors.push(IdleCore.floorInfo(top + 1));
    if (this.matFilter) {
      const id = this.matFilter;
      const score = i => (i.mainMat === id ? 3 : 0) + (i.bossMat === id ? 3 : 0) + (i.sceneMat === id ? 1 : 0) + (i.mats.includes(id) ? 1 : 0);
      floors = floors.filter(i => score(i) > 0).sort((a, b) => score(b) - score(a) || b.floor - a.floor);
    }
    const rows = floors.slice(0, 40).map(i => {
      const locked = i.floor > top;
      const mats = i.mats.map(id => `<span class="idle-mat g1${id === i.mainMat ? ' main' : ''}" style="--c:${IdleCore.MATERIALS[id].color}">${this.matName(id)}</span>`).join('');
      const boss = i.boss ? `<div class="idle-floor-boss">镇守「${i.boss.name}」→ <span style="color:${IdleCore.MATERIALS[i.bossMat].color}">${this.matName(i.bossMat)}</span></div>` : '';
      const btn = locked ? '<span class="idle-hint">未到达</span>' : i.floor === cur ? '<span class="idle-hint">当前</span>' : `<button class="idle-btn idle-btn-sm" data-idle="go" data-arg="${i.floor}">前往</button>`;
      return `<div class="idle-floor${locked ? ' locked' : ''}${i.floor === cur ? ' cur' : ''}">
        <div class="idle-floor-main"><div><b>第 ${i.floor} 层</b> <small>${i.scene.name}</small> · 主妖 <b>${this.monsterName(i.main)}</b></div>
        <div class="idle-floor-mats">${mats}<span class="idle-mat g2" style="--c:${IdleCore.MATERIALS[i.sceneMat].color}">${this.matName(i.sceneMat)}(精英/秘藏)</span></div>${boss}</div>${btn}</div>`;
    }).join('');
    return `<div class="idle-hint">每层固定一种主妖（数量最多），想刷什么材料就点下面筛选，再「前往」该层停留刷怪。</div>
      <div class="idle-chips">${chips}</div>${rows || '<div class="idle-hint">已到达的层里还没有这种材料。</div>'}`;
  },

  panelMats() {
    const s = this.state(), now = Date.now();
    const owned = Object.keys(IdleCore.MATERIALS).filter(id => (s.mats[id] || 0) > 0);
    const bag = owned.length ? owned.map(id => this.matChip(id)).join('') : '<span class="idle-hint">还没有材料：打妖物、精英、镇守和开秘藏都会掉。</span>';
    const recipes = Object.keys(IdleCore.RECIPES).map(id => {
      const r = IdleCore.RECIPES[id], left = (s.buffs[id] || 0) - now;
      const ok = IdleCore.canAfford(s.mats, r.cost);
      return `<div class="idle-recipe"><div class="idle-recipe-main"><b>${r.name}</b>${left > 0 ? ` <small class="buff">生效中 ${this.fmtDuration(left / 1000)}</small>` : ''}
        <div class="idle-hint">${r.desc}</div><div>${Object.keys(r.cost).map(k => this.matChip(k, r.cost[k])).join('')}</div></div>
        <button class="idle-btn idle-btn-sm" data-idle="craft" data-arg="${id}" ${ok ? '' : 'disabled'}>炼制</button></div>`;
    }).join('');
    const arts = Object.keys(IdleCore.ARTIFACTS).map(id => {
      const a = IdleCore.ARTIFACTS[id], lv = s.artifacts[id] || 0, cost = IdleCore.artifactCost(id, lv + 1);
      const ok = cost && IdleCore.canAfford(s.mats, cost);
      return `<div class="idle-recipe"><div class="idle-recipe-main"><b>${a.name}</b> <small>Lv.${lv}/${a.max}</small>
        <div class="idle-hint">${lv ? a.desc(lv) : '未炼成'}${cost ? ` → ${a.desc(lv + 1)}` : '（已满级）'}</div>
        <div>${cost ? Object.keys(cost).map(k => this.matChip(k, cost[k])).join('') : ''}</div></div>
        ${cost ? `<button class="idle-btn idle-btn-sm" data-idle="upgrade" data-arg="${id}" ${ok ? '' : 'disabled'}>${lv ? '升级' : '炼成'}</button>` : ''}</div>`;
    }).join('');
    const maps = s.treasureMaps || 0, nem = s.nemesis;
    const extra = `<div class="idle-recipe"><div class="idle-recipe-main"><b>📜 藏宝图 ×${maps}</b>${s.treasurePending ? ' <small class="buff">已展开，下一张地图出现藏宝洞</small>' : ''}
        <div class="idle-hint">精英妖物与宿敌掉落，游商也有卖。使用后下一张地图深处出现有精英把守的藏宝洞（金币、多件装备、场景与镇守材料）。</div></div>
        <button class="idle-btn idle-btn-sm" data-idle="use-map" ${maps > 0 && !s.treasurePending ? '' : 'disabled'}>使用</button></div>`
      + (nem ? `<div class="idle-recipe idle-nemesis"><div class="idle-recipe-main"><b style="color:#ff4d4d">☠ 宿敌 · ${this.nemesisName(nem)}</b> <small>${nem.level} 阶 · 杀过你 ${nem.kills} 次</small>
        <div class="idle-hint">在塔中游荡，每张地图约 30% 机会遇到。击杀掉落按镇守算且翻倍、金币×5、必得藏宝图；再被它杀死它会更强。</div></div></div>` : '');
    return `<div class="idle-sec">材料袋</div><div class="idle-chips">${bag}</div>${extra}
      <div class="idle-sec">丹符（限时加成，离线也计时）</div>${recipes}
      <div class="idle-sec">法器（永久加成，需要镇守材料）</div>${arts}`;
  },

  panelMerchant() {
    const m = this.merchant();
    if (!m) return '<div class="idle-hint">游商已经背着货箱走远了……下次在塔里碰到再说。</div>';
    const rows = m.deals.map((d, i) => {
      const give = d.give.gold ? `<span style="color:#ffcd75">${d.give.gold} 金</span>` : Object.keys(d.give.mats).map(id => this.matChip(id, d.give.mats[id])).join('');
      const get = d.get.treasureMaps ? `<span class="idle-mat g3" style="--c:#ffe14d">藏宝图 ×${d.get.treasureMaps}</span>` : Object.keys(d.get.mats).map(id => `<span class="idle-mat g${IdleCore.MATERIALS[id].grade}" style="--c:${IdleCore.MATERIALS[id].color}">${this.matName(id)} ×${d.get.mats[id]}</span>`).join('');
      return `<div class="idle-recipe${d.sold ? ' sold' : ''}"><div class="idle-recipe-main"><div>${get}</div><div class="idle-hint">价格：${give}</div></div>
        <button class="idle-btn idle-btn-sm" data-idle="trade" data-arg="${i}" ${this.canDeal(d) ? '' : 'disabled'}>${d.sold ? '已售' : '买下'}</button></div>`;
    }).join('');
    return `<div class="idle-hint">「荒山野岭的，难得碰上活人。货不多，看上就拿。」游商只在本张地图停留，离开就没了。你有 <b style="color:#ffcd75">${player.gold || 0}</b> 金。</div>${rows}`;
  },

  panelBounty() {
    const s = this.state(), cost = this.rerollCost();
    const cards = s.bounties.map(b => {
      const info = IdleCore.floorInfo(b.floor), r = b.reward;
      const hint = b.kind === 'boss' ? `第 ${b.floor} 层镇守殿（5 分钟刷新）` : b.kind === 'elite' ? '任意层的精英怪群；引妖香可让精英翻倍' : `推荐第 ${b.floor} 层（${info.scene.name}，主妖 ${this.monsterName(info.main)}）`;
      const pct = Math.round(b.have / b.need * 100);
      const canGo = this.run && b.floor <= this.run.maxFloor && b.floor !== this.run.floor && b.kind !== 'elite';
      return `<div class="idle-bounty${b.done ? ' done' : ''}">
        <div><b>${this.bountyTitle(b)}</b></div><div class="idle-hint">${hint}</div>
        <div class="idle-progress"><div style="width:${pct}%"></div><span>${b.have}/${b.need}</span></div>
        <div class="idle-reward">奖励：金币 ${r.gold} · 经验 ${r.xp} · ${this.matsText(r.mats)} · ${this.rarityName(r.item)}装 ×1</div>
        <div class="idle-actions">${b.done ? `<button class="idle-btn idle-btn-main idle-btn-sm" data-idle="claim" data-arg="${b.id}">领取</button>`
          : `${canGo ? `<button class="idle-btn idle-btn-sm" data-idle="go" data-arg="${b.floor}">前往第 ${b.floor} 层</button>` : ''}<button class="idle-btn idle-btn-sm" data-idle="reroll" data-arg="${b.id}">换一个（${cost} 金）</button>`}</div>
      </div>`;
    }).join('');
    return `<div class="idle-hint">悬赏按你到过的层生成，离线闭关也会累计进度。已完成 ${s.totals.bounties} 个。</div>${cards}`;
  },

  log(text, color) {
    this.logLines.unshift({ text, color: color || '#ddd' });
    if (this.logLines.length > 30) this.logLines.length = 30;
    if (this.active) this.renderLog();
  },

  renderLog() {
    const el = document.getElementById('idle-log');
    if (!el) return;
    el.innerHTML = this.logLines.slice(0, 6).map(l => `<div style="color:${l.color}">${l.text}</div>`).join('');
  },

  notify(msg) {
    if (typeof showNotification === 'function') showNotification(msg);
  },

  fmtDuration(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h} 小时${m ? ' ' + m + ' 分钟' : ''}`;
    if (m > 0) return `${m} 分钟`;
    return `${sec} 秒`;
  }
};

if (typeof window !== 'undefined') window.IdleMode = IdleMode;
if (typeof module !== 'undefined') module.exports = { IdleMode };
