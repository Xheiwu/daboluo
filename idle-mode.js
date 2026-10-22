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
  run: null,
  canvas: null,
  ctx: null,
  raf: 0,
  lastFrame: 0,
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
    for (const k of ['chests', 'bounties']) if (typeof s.totals[k] !== 'number') s.totals[k] = 0;
    if (!Array.isArray(s.bounties)) s.bounties = [];
    // 旧存档：镇守/妖物改名（与立绘统一）后迁移悬赏目标和宿敌名
    const RENAMED = { '血蝠妖': '血衣罗刹', '九尾天狐': '赤焰魔君', '魔蛟': '九幽冥王', '跳尸': '尸傀', '纸人': '阴兵弓手', '毒蛛': '白骨卒', '狐妖': '魈巫', '鬼火': '幽冥使', '机关铜人': '缠尸', '蛇妖': '血魔' };
    for (const b of s.bounties) if (b && RENAMED[b.target]) b.target = RENAMED[b.target];
    if (s.nemesis && RENAMED[s.nemesis.baseName]) s.nemesis.baseName = RENAMED[s.nemesis.baseName];
    return s;
  },

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
    if (this.loadArt) this.loadArt();
    const s = this.state();
    if (!this.run) {
      this.run = new IdleCore.Run(this.snapshot(), {
        seed: (Date.now() % 2147483647) >>> 0,
        floor: s.floor, maxFloor: s.maxFloor, autoAdvance: s.autoAdvance, pity: s.pity, mods: this.mods(),
        nemesis: s.nemesis, treasurePending: s.treasurePending
      });
      this.view = { enemies: new Map(), fx: [], texts: [], lunge: 0, shake: 0, heroFlash: 0, banner: null, camX: null, camY: 0, mapUid: 0, fog: null };
      this.session = { kills: 0, gold: 0, xp: 0, items: 0, sold: 0, soldGold: 0, home: 0, mats: 0, chests: 0, startedAt: Date.now() };
      this.ensureBounties();
      this.logLines = [];
      this.log(`进入镇妖塔第 ${s.floor} 层 · ${this.themeFor(s.floor).name}`, '#c8b88a');
    }
    s.running = true;
    s.lastActive = Date.now();
    this.active = true;
    document.getElementById('idle-mode').classList.add('active');
    this.resize();
    this.lastFrame = performance.now();
    this.acc = 0;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(t => this.frame(t));
    this.renderUI(true);
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
    s.lastActive = Date.now();
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
          if (visual) { this.fxTrigger(e); if (this.view.pose) this.view.pose.cast = 0.4; }
          break;
        case 'heroHit':
          if (visual) {
            this.view.heroFlash = 0.15;
            if (this.view.pose) this.view.pose.hurt = 0.15;
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
    if (res.pity) s.pity = res.pity;
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
    if (!res) {
      setTimeout(() => this.open(), 600);
      return true;
    }
    setTimeout(() => this.showOfflinePanel(res), 800);
    return true;
  },

  showOfflinePanel(res) {
    this.ensureDom();
    const el = document.getElementById('idle-offline');
    const r = this.applySettlement(res);
    const s = this.state();
    s.totals.offlineClaims++;
    s.lastActive = Date.now();
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
    if (boss) return [[0, 0], [-46, 18], [46, 18], [0, 34]][i] || [((i % 2) ? 1 : -1) * 40, -24];
    return [[0, 0], [-30, 13], [30, 13], [-16, -19], [16, -19], [0, 27]][i] || [((i % 2) ? 1 : -1) * 35, 32];
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
    this.view.fx.push({ kind: 'slash', x: ve.x, y: ve.y - 14, t: 0, life: 0.18, crit });
  },

  fxTrigger(e) {
    const hp = this.heroPx();
    const hero = { x: hp.x, y: hp.y - 12 };
    this.view.texts.push({ x: hero.x, y: hero.y - 34, text: e.name + '！', color: e.color, t: 0, life: 1.1, big: true, fixed: true });
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
      for (const ve of targets) this.view.fx.push({ kind: 'fireball', x0: hero.x, y0: hero.y, x1: ve.x, y1: ve.y - 14, t: 0, life: 0.3 });
    } else if (e.id === 'thunder') {
      let px = hero.x, py = hero.y - 120;
      for (const ve of targets) {
        this.view.fx.push({ kind: 'lightning', x0: px, y0: py, x1: ve.x, y1: ve.y - 14, t: 0, life: 0.28, seed: Math.random() });
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
        if (ve.dying > 0.9) v.enemies.delete(uid);
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
