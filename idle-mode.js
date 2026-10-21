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
  HERO_Y: 132,
  ENEMY_Y: 262,
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

  // ---------- 存档状态（player.idle） ----------
  state() {
    if (typeof player === 'undefined') return null;
    const d = { floor: 1, maxFloor: 1, autoAdvance: true, running: false, lastActive: 0, keepMin: 2, pity: { rare: 0, unique: 0 }, totals: { kills: 0, seconds: 0, offlineClaims: 0 } };
    if (!player.idle || typeof player.idle !== 'object') player.idle = d;
    const s = player.idle;
    for (const k of Object.keys(d)) if (s[k] === undefined || s[k] === null) s[k] = d[k];
    s.floor = Math.max(1, Math.floor(s.floor) || 1);
    s.maxFloor = Math.max(s.floor, Math.floor(s.maxFloor) || 1);
    if (![2, 3, 4].includes(s.keepMin)) s.keepMin = 2;
    return s;
  },

  snapshot() {
    return IdleCore.buildHeroSnapshot(player);
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
        floor: s.floor, maxFloor: s.maxFloor, autoAdvance: s.autoAdvance, pity: s.pity
      });
      this.view = { enemies: new Map(), fx: [], texts: [], lunge: 0, shake: 0, heroFlash: 0, banner: null };
      this.session = { kills: 0, gold: 0, xp: 0, items: 0, sold: 0, soldGold: 0, home: 0, startedAt: Date.now() };
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
    this.run.floor--;
    this.run.wave = 0;
    this.run.enemies = [];
    this.run.phase = 'walk';
    this.run.phaseTimer = IdleCore.IDLE_CONFIG.WALK_TIME;
    this.run.autoAdvance = false;
    this.state().autoAdvance = false;
    this.view.enemies.clear();
    this.log(`退回第 ${this.run.floor} 层`, '#9fc6ff');
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
    s.lastActive = Date.now();
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
    this.raf = requestAnimationFrame(n => this.frame(n));
  },

  catchUp(seconds) {
    const DT = IdleCore.IDLE_CONFIG.DT;
    const direct = Math.min(seconds, 600);
    const steps = Math.floor(direct / DT);
    for (let i = 0; i < steps; i++) this.handleEvents(this.run.step(DT), false);
    if (seconds > 600) {
      const res = IdleCore.offlineSettlement(this.snapshot(), { elapsedSec: seconds - 600, floor: this.run.floor, pity: this.run.pity, seed: Date.now() % 100000 });
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
        case 'wave':
          this.run.setHero(this.snapshot());
          if (visual) this.syncEnemies(true);
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
            this.floatText(this.W / 2 + 14, this.HERO_Y - 30, '-' + e.dmg, '#ef7d57');
            const src = this.view.enemies.get(e.source);
            if (src && !e.ranged) src.lunge = 1;
            if (src && e.ranged) this.view.fx.push({ kind: 'bolt', x0: src.x, y0: src.y - 12, x1: this.W / 2, y1: this.HERO_Y - 12, t: 0, life: 0.25, color: '#c8a0e0' });
          }
          break;
        case 'block':
          if (visual) this.floatText(this.W / 2, this.HERO_Y - 34, '格挡', '#94b0c2');
          break;
        case 'medicine':
          if (visual) this.floatText(this.W / 2, this.HERO_Y - 40, '疗伤药', '#a7f070');
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
    if (visual) {
      const ve = this.view.enemies.get(e.enemy.uid);
      if (ve) {
        ve.dying = 0.001;
        this.floatText(ve.x, ve.y - 40, '+' + e.gold + '金', '#ffcd75');
      }
    }
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
    if (e.next !== e.floor) this.log(`第 ${e.floor} 层妖物已肃清，继续向下 → 第 ${e.next} 层`, '#c8b88a');
    if (this.view) this.view.banner = { text: `镇妖塔 第 ${e.next} 层`, color: '#ffcd75', t: 0, life: 1.6 };
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
    const res = IdleCore.offlineSettlement(this.snapshot(), { elapsedSec, floor: s.floor, pity: s.pity, seed: Date.now() % 100000 });
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
  syncEnemies(entering) {
    if (!this.run) return;
    const list = this.run.enemies;
    const n = list.length;
    list.forEach((e, i) => {
      if (this.view.enemies.has(e.uid)) return;
      const boss = e.tier === 'boss';
      const spread = n > 1 ? (i - (n - 1) / 2) * (boss ? 70 : 52) : 0;
      this.view.enemies.set(e.uid, {
        uid: e.uid, ref: e, x: this.W / 2 + spread, y: this.ENEMY_Y + (boss ? 10 : (i % 2) * 12),
        enter: entering ? 1 : 0, flash: 0, lunge: 0, dying: 0, boss
      });
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
    const hero = { x: this.W / 2, y: this.HERO_Y - 12 };
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
      let px = hero.x, py = 0;
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

  updateView(dt) {
    const v = this.view;
    if (!v || !this.run) return;
    if (this.run.phase === 'walk' || this.run.phase === 'dead') {
      if (this.run.phase === 'walk') this.scroll += dt * 70;
      for (const [uid, ve] of v.enemies) if (!ve.dying) ve.dying = 0.001;
    }
    for (const [uid, ve] of v.enemies) {
      if (ve.enter > 0) ve.enter = Math.max(0, ve.enter - dt * 2.5);
      ve.flash = Math.max(0, ve.flash - dt);
      ve.lunge = Math.max(0, ve.lunge - dt * 5);
      if (ve.dying > 0) {
        ve.dying += dt;
        if (ve.dying > 0.5) v.enemies.delete(uid);
      }
    }
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

  // 预渲染一屏高的镇妖塔甬道（可无缝纵向平铺）
  background(floor) {
    const theme = this.themeFor(floor);
    const key = theme.max;
    if (this.bgCache[key]) return this.bgCache[key];
    const c = document.createElement('canvas');
    c.width = this.W; c.height = 200;
    const g = c.getContext('2d');
    const T = 20;
    for (let y = 0; y < 200; y += T) {
      for (let x = 40; x < 200; x += T) {
        g.fillStyle = theme.floor[((x + y) / T) % 2];
        g.fillRect(x, y, T, T);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x, y + T - 1, T, 1);
        g.fillRect(x + T - 1, y, 1, T);
        if (((x * 7 + y * 13) % 9) === 0) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x + 5, y + 6, 3, 2); }
      }
    }
    for (const side of [0, 200]) {
      g.fillStyle = theme.wall;
      g.fillRect(side, 0, 40, 200);
      for (let y = 0; y < 200; y += 10) {
        const off = (y / 10) % 2 ? 0 : 10;
        for (let x = side - 10 + off; x < side + 40; x += 20) {
          g.fillStyle = theme.brick;
          g.fillRect(Math.max(side, x) + 1, y + 1, Math.min(18, side + 40 - Math.max(side, x) - 1), 8);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(side === 0 ? 34 : 200, 0, 6, 200);
      g.fillStyle = theme.moss;
      g.globalAlpha = 0.5;
      for (let y = 15; y < 200; y += 47) g.fillRect(side === 0 ? 30 : 204, y, 4, 3);
      g.globalAlpha = 1;
      // 镇妖黄符：墙上贴的符纸（朱砂竖纹）
      for (const y of [28, 128]) {
        const fx = side === 0 ? 12 : 220;
        g.fillStyle = '#d8b04a'; g.fillRect(fx, y, 7, 16);
        g.fillStyle = '#b13e53'; g.fillRect(fx + 3, y + 2, 1, 12); g.fillRect(fx + 1, y + 5, 5, 1);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(fx, y + 15, 7, 1);
      }
      // 锁链：从墙头垂下
      g.fillStyle = '#6b6b6b';
      const cx = side === 0 ? 25 : 212;
      for (let y = 70; y < 110; y += 4) g.fillRect(cx + ((y / 4) % 2), y, 2, 3);
    }
    // 分段场景点缀
    const spots = [[62, 40], [168, 92], [96, 150], [140, 22], [70, 178]];
    for (const [x, y] of spots) {
      if (theme.deco === 'water') {
        g.fillStyle = 'rgba(115,239,247,0.10)'; g.fillRect(x - 6, y, 16, 4); g.fillRect(x - 3, y - 1, 10, 6);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y + 1, 3, 1);
      } else if (theme.deco === 'lava') {
        g.fillStyle = 'rgba(239,125,87,0.55)';
        g.fillRect(x, y, 6, 1); g.fillRect(x + 5, y + 1, 1, 4); g.fillRect(x + 5, y + 4, 7, 1);
        g.fillStyle = 'rgba(255,205,117,0.5)'; g.fillRect(x + 5, y + 2, 1, 1);
      } else if (theme.deco === 'abyss') {
        g.fillStyle = 'rgba(200,160,224,0.18)';
        g.fillRect(x, y, 7, 1); g.fillRect(x + 3, y - 3, 1, 7); g.fillRect(x + 1, y - 2, 1, 1); g.fillRect(x + 5, y + 2, 1, 1);
      } else {
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, y, 5, 1); g.fillRect(x + 4, y + 1, 1, 3);
      }
    }
    this.bgCache[key] = c;
    return c;
  },

  draw() {
    const g = this.ctx;
    if (!g || !this.run) return;
    const run = this.run, v = this.view, W = this.W, H = this.H;
    const now = performance.now() / 1000;
    g.save();
    g.imageSmoothingEnabled = false;
    if (v.shake > 0) g.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 4));
    // 镇妖塔背景：向上滚动 = 角色向下深入
    const bg = this.background(run.floor);
    const off = Math.floor(this.scroll % 200);
    for (let y = -off; y < H; y += 200) g.drawImage(bg, 0, y);
    // 火把
    for (let y = -off % 100 + 40; y < H; y += 100) {
      for (const x of [36, 204]) {
        g.fillStyle = '#5a3a1e'; g.fillRect(x - 1, y, 3, 8);
        const flick = Math.sin(now * 12 + y) > 0 ? 1 : 0;
        g.fillStyle = '#ef7d57'; g.fillRect(x - 2, y - 5 - flick, 5, 5);
        g.fillStyle = '#ffcd75'; g.fillRect(x - 1, y - 4 - flick, 3, 3);
        const glow = g.createRadialGradient(x, y - 3, 1, x, y - 3, 34);
        glow.addColorStop(0, 'rgba(247,164,58,0.28)'); glow.addColorStop(1, 'rgba(247,164,58,0)');
        g.fillStyle = glow; g.fillRect(x - 34, y - 37, 68, 68);
      }
    }

    // 敌人
    const ordered = [...v.enemies.values()].sort((a, b) => a.y - b.y);
    for (const ve of ordered) this.drawEnemy(g, ve, now);

    // 宠物 + 主角
    this.drawHero(g, now);

    // 特效
    for (const f of v.fx) this.drawFx(g, f, now);

    // 灯火：越深越暗，只照亮主角周围
    const radius = Math.max(120, 250 - run.floor * 3);
    const dark = Math.min(0.78, 0.35 + run.floor * 0.012);
    const lg = g.createRadialGradient(W / 2, this.HERO_Y + 50, radius * 0.35, W / 2, this.HERO_Y + 50, radius);
    lg.addColorStop(0, 'rgba(10,8,14,0)');
    lg.addColorStop(1, `rgba(10,8,14,${dark})`);
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);

    // 飘字
    g.textAlign = 'center';
    for (const t of v.texts) {
      const k = t.t / t.life;
      const y = t.y - k * (t.fixed ? 10 : 22);
      g.globalAlpha = Math.min(1, (1 - k) * 2);
      g.font = t.big ? 'bold 12px "Microsoft YaHei", sans-serif' : 'bold 10px monospace';
      g.lineWidth = 3; g.strokeStyle = '#1a1c2c';
      g.strokeText(t.text, Math.round(t.x), Math.round(y));
      g.fillStyle = t.color;
      g.fillText(t.text, Math.round(t.x), Math.round(y));
    }
    g.globalAlpha = 1;

    // 横幅
    if (v.banner) {
      const b = v.banner;
      const a = Math.min(1, b.t * 4, (b.life - b.t) * 3);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = 'rgba(10,8,14,0.75)';
      g.fillRect(0, 58, W, 22);
      g.font = 'bold 12px "Microsoft YaHei", sans-serif';
      g.fillStyle = b.color;
      g.fillText(b.text, W / 2, 73);
      g.globalAlpha = 1;
    }
    if (run.phase === 'dead') {
      g.fillStyle = 'rgba(80,10,20,0.35)';
      g.fillRect(0, 0, W, H);
    }
    g.restore();
  },

  drawSprite(g, id, x, y, scale, alpha = 1) {
    const sp = HomeArt.canvas(id, scale);
    if (!sp) return null;
    g.globalAlpha = alpha;
    g.drawImage(sp, Math.round(x - sp.width / 2), Math.round(y - sp.height));
    g.globalAlpha = 1;
    return sp;
  },

  shadow(g, x, y, w) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(x, y, w, w * 0.35, 0, 0, Math.PI * 2); g.fill();
  },

  drawHero(g, now) {
    const run = this.run, v = this.view;
    const walking = run.phase === 'walk';
    const x = this.W / 2;
    const bob = walking ? Math.round(Math.abs(Math.sin(now * 9)) * -2) : Math.round(Math.sin(now * 3) * 0.6);
    const y = this.HERO_Y + bob + Math.round(v.lunge * 8);
    // 宠物
    const pet = player.home && player.home.activePet;
    if (pet) {
      const px = x - 30, py = this.HERO_Y - 6 + Math.round(Math.sin(now * (walking ? 10 : 3)) * 2);
      this.shadow(g, px, this.HERO_Y - 5, 9);
      this.drawSprite(g, 'pet_' + pet, px, py, 2);
    }
    this.shadow(g, x, this.HERO_Y + 1, 12);
    const alpha = run.phase === 'dead' ? 0.45 : 1;
    this.drawSprite(g, v.lunge > 0.3 ? 'idle_hero_atk' : 'idle_hero', x, y, 2, alpha);
    if (v.heroFlash > 0) {
      g.fillStyle = 'rgba(239,125,87,0.35)';
      g.fillRect(x - 16, y - 32, 32, 32);
    }
    // 护盾
    if (run.shield > 0) {
      g.strokeStyle = 'rgba(255,210,77,0.8)';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y - 16, 22 + Math.sin(now * 8), 0, Math.PI * 2); g.stroke();
    }
  },

  drawEnemy(g, ve, now) {
    const e = ve.ref;
    const scale = ve.boss ? 3 : 2;
    const sprite = (typeof IDLE_MONSTER_SPRITE !== 'undefined' && IDLE_MONSTER_SPRITE[e.type]) || 'mob_melee';
    const enterOff = ve.enter * 90;
    const bob = Math.round(Math.sin(now * 4 + ve.uid) * 1.2);
    const x = ve.x, y = ve.y + enterOff + bob - Math.round(ve.lunge * 10);
    const alpha = ve.dying > 0 ? Math.max(0, 1 - ve.dying * 2) : 1;
    this.shadow(g, x, ve.y + enterOff + 1, ve.boss ? 20 : 11);
    const jitter = ve.flash > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
    this.drawSprite(g, sprite, x + jitter, y, scale, alpha);
    if (e.tier === 'elite' && alpha > 0.5) {
      g.strokeStyle = 'rgba(95,168,255,0.8)';
      g.lineWidth = 1;
      g.strokeRect(x - 17, y - 33, 34, 34);
    }
    if (ve.dying > 0) return;
    // 血条
    const bw = ve.boss ? 56 : 28;
    const top = y - 16 * scale - 6;
    g.fillStyle = '#1a1c2c'; g.fillRect(x - bw / 2 - 1, top - 1, bw + 2, 5);
    g.fillStyle = ve.boss ? '#ff8a3d' : (e.tier === 'elite' ? '#5fa8ff' : '#b13e53');
    g.fillRect(x - bw / 2, top, Math.max(0, Math.round(bw * e.hp / e.maxHp)), 3);
    if (ve.boss || e.tier === 'elite') {
      g.font = '9px "Microsoft YaHei", sans-serif';
      g.textAlign = 'center';
      g.fillStyle = ve.boss ? '#ff8a3d' : '#9fc6ff';
      g.fillText(e.name, x, top - 3);
    }
  },

  drawFx(g, f) {
    const k = Math.max(0, f.t) / f.life;
    if (f.t < 0) return;
    if (f.kind === 'slash') {
      g.strokeStyle = f.crit ? 'rgba(255,205,117,' + (1 - k) + ')' : 'rgba(244,244,244,' + (1 - k) + ')';
      g.lineWidth = f.crit ? 3 : 2;
      g.beginPath(); g.arc(f.x, f.y, 12 + k * 6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else if (f.kind === 'fireball') {
      const x = f.x0 + (f.x1 - f.x0) * Math.min(1, k * 1.4), y = f.y0 + (f.y1 - f.y0) * Math.min(1, k * 1.4);
      const r = k < 0.7 ? 5 : 5 + (k - 0.7) * 50;
      g.fillStyle = `rgba(239,125,87,${k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,205,117,0.9)';
      g.beginPath(); g.arc(x, y, r * 0.5, 0, Math.PI * 2); g.fill();
    } else if (f.kind === 'lightning') {
      g.strokeStyle = `rgba(115,239,247,${1 - k})`;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(f.x0, f.y0);
      const seg = 6;
      for (let i = 1; i <= seg; i++) {
        const tt = i / seg;
        const j = i === seg ? 0 : (Math.sin((f.seed * 100 + i) * 12.9898) * 43758.5453 % 1) * 14;
        g.lineTo(f.x0 + (f.x1 - f.x0) * tt + j, f.y0 + (f.y1 - f.y0) * tt);
      }
      g.stroke();
      g.strokeStyle = `rgba(244,244,244,${1 - k})`; g.lineWidth = 1; g.stroke();
    } else if (f.kind === 'dart' || f.kind === 'bolt') {
      const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k;
      const ang = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
      g.strokeStyle = f.color || '#ffcd75';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - Math.cos(ang) * 7, y - Math.sin(ang) * 7); g.lineTo(x, y); g.stroke();
    } else if (f.kind === 'bell') {
      g.strokeStyle = `rgba(255,210,77,${1 - k})`;
      g.lineWidth = 3;
      g.beginPath(); g.arc(this.W / 2, this.HERO_Y - 16, 14 + k * 30, 0, Math.PI * 2); g.stroke();
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
          <div class="idle-waves" id="idle-waves"></div>
        </div>
        <div class="idle-stage"><canvas id="idle-canvas" width="${this.W}" height="${this.H}"></canvas></div>
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
      const a = b.dataset.idle;
      if (a === 'close') this.close();
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
    const W = IdleCore.IDLE_CONFIG.WAVES_PER_FLOOR;
    let waves = '';
    for (let i = 0; i < W; i++) {
      const cls = i < run.wave ? 'done' : (i === run.wave ? 'now' : '');
      waves += `<span class="idle-wave ${cls} ${i === W - 1 && bossFloor ? 'boss' : ''}"></span>`;
    }
    $('idle-waves').innerHTML = waves;
    const ss = this.session;
    $('idle-session').innerHTML = `本次 击杀 <b>${ss.kills}</b> · 金币 <b>${ss.gold + ss.soldGold}</b> · 经验 <b>${ss.xp}</b> · 装备 <b>${ss.items}</b>${ss.home ? ` · 家园 <b>${ss.home}</b>` : ''}`;
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
      $('idle-advance').textContent = run.autoAdvance ? '⬇ 自动深入' : '⏸ 停留本层';
      $('idle-advance').classList.toggle('on', run.autoAdvance);
      $('idle-keep').textContent = `拾取：${{ 2: '蓝装+', 3: '黄装+', 4: '暗金' }[s.keepMin]}`;
      this.renderLog();
    }
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
