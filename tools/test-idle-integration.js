// 镇妖塔集成边界回归：Node VM + 存储/DOM 替身，不代表浏览器或真机实测。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const read = name => baseline ? cp.execFileSync('git', ['show', `63aac7e:${name}`], {cwd:root, encoding:'utf8'}) : fs.readFileSync(path.join(root,name),'utf8');
const core = require('../idle-core.js');
function fixture() {
  const timers=[], saved=[], listeners={}, els=new Map();
  const element=()=>({classList:{add(){},remove(){}},querySelector(){return {innerHTML:''}}});
  for(const id of ['idle-mode','idle-offline']) els.set(id,element());
  const x={console, structuredClone, IdleCore:core, performance:{now:()=>1000}, Date,
    player:{lvl:10,xp:0,xpNext:1e12,gold:0,kills:0,damage:[60,90],maxHp:400,armor:80,skills:{fireball:5},inventory:[],stash:[],equipment:{},personalBest:{}},
    document:{getElementById:id=>els.get(id)||null},
    setTimeout:fn=>{timers.push(fn);return timers.length}, cancelAnimationFrame(){},requestAnimationFrame(){return 1},
    isInTown:()=>true, updateStats(){},updateUI(){},Settings:{},AutoBattle:{settings:{}},townPortal:null,
    localStorage:{setItem(){}},window:{addEventListener:(name,fn)=>listeners[name]=fn},
  };
  vm.createContext(x);
  vm.runInContext(read('idle-mode.js')+'\nthis.mode=IdleMode;',x);
  vm.runInContext(read('save-system.js')+`\nthis.saves=SaveSystem;db={transaction(){const tx={objectStore(){return {put(data){saved.push(structuredClone(data));queueMicrotask(()=>tx.oncomplete?.());}}}};return tx}};`,Object.assign(x,{saved,queueMicrotask}));
  const m=x.mode;
  // 只替换渲染和通知；奖励、地图、保底与存档实现使用生产代码。
  m.ensureDom=()=>{};m.resize=()=>{};m.renderUI=()=>{};m.notify=()=>{};
  return {x,m,timers,saved,listeners};
}
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name)}catch(e){failed++;console.log('FAIL '+name+': '+e.message)}}
(async()=>{
await test('保存真实奖励时同步运行层数、保底及时间戳',async()=>{
  const {m,x,saved}=fixture();m.open();m.run.floor=4;m.run.maxFloor=6;x.player.idle.floor=1;x.player.idle.lastActive=1;
  await x.saves.save(true);const a=saved.at(-1);
  assert.equal(a.idle.floor,4);assert.equal(a.idle.maxFloor,6);assert(a.idle.lastActive>1);assert.equal(a.idle.running,true);
});
await test('隐藏页面保存不会抹掉尚未补算的离线时间',async()=>{
  const {m,x,saved}=fixture();let now=1000000;x.Date={now:()=>now};m.open();const processed=x.player.idle.lastActive;
  now+=3600000;await x.saves.save(true);assert.equal(saved.at(-1).idle.lastActive,processed);
});
await test('后台补算后的保底不会被下一次 persist 覆盖',()=>{
  const {m,x}=fixture();m.open();const pity={rare:17,unique:61};
  m.applySettlement({xp:0,gold:0,kills:0,floor:1,drops:[],pity,mats:{}});m.persist();
  assert.equal(x.player.idle.pity.rare,17);assert.equal(m.run.pity.unique,61);
});
await test('离线奖励立即发放并保存，重复检查不会再次领取',()=>{
  const {m,x,saved,timers}=fixture();Object.assign(m.state(),{running:true,lastActive:Date.now()-3600000});
  assert.equal(m.handleOfflineReturn(Date.now()-3600000),true);
  assert(x.player.gold>0,'弹窗出现前奖励必须已经发放');assert.equal(x.player.idle.totals.offlineClaims,1);
  const gold=x.player.gold;assert.equal(m.handleOfflineReturn(1),false);assert.equal(x.player.gold,gold);
  assert.equal(saved.at(-1).idle.running,false);assert.equal(saved.at(-1).gold,gold);
  timers.splice(0).forEach(fn=>fn());assert.equal(x.player.gold,gold,'显示面板不能重复发奖');
});
await test('旧槽位的延迟面板与短离线恢复不会影响新槽位',()=>{
  for(const elapsed of [60,3600]) {
    const {m,x,timers}=fixture();Object.assign(m.state(),{running:true,lastActive:Date.now()-elapsed*1000});
    m.handleOfflineReturn(1);m.onSaveLoaded(null);x.player.gold=0;
    timers.splice(0).forEach(fn=>fn());assert.equal(m.active,false);assert.equal(m.offlineVisible,false);assert.equal(x.player.gold,0);
  }
});
await test('读旧存档与新槽时清除旧运行状态并隔离塔进度',()=>{
  const {m,x}=fixture();m.open();m.run.floor=12;m.panel='mats';m.onSaveLoaded({});
  assert.equal(m.run,null);assert.equal(m.panel,null);assert.equal(x.player.idle.floor,1);
  const first=x.player.idle;m.onSaveLoaded({idle:{floor:3,maxFloor:4}});assert.equal(x.player.idle.floor,3);
  m.onSaveLoaded(null);assert.notEqual(x.player.idle,first);assert.equal(x.player.idle.maxFloor,1);
});
await test('部分旧存档的累计字段补齐，继续挂机不产生 NaN',()=>{
  const {m,x}=fixture();x.player.idle={floor:2,totals:{kills:7}};
  const s=m.state();assert.equal(s.totals.kills,7);assert.equal(s.totals.seconds,0);assert.equal(s.totals.offlineClaims,0);
});
await test('镇妖塔快捷键隔离，退出后原 ARPG 快捷键恢复',()=>{
  const {m,x,listeners}=fixture();const source=read('game.js');
  const begin=source.indexOf("window.addEventListener('keydown', e => {");const end=source.indexOf('\n});',begin)+4;
  let uses=0,interactions=0,toggles=0;
  Object.assign(x,{AudioSys:{tryAutoStartBGM(){}},useQuickItem(){uses++},handleInteraction(){interactions++},toggleAutoBattle(){toggles++}});
  vm.runInContext(source.slice(begin,end),x);m.active=true;
  for(const key of ['1','2','3','Enter','f'])listeners.keydown({key});
  assert.equal(uses+interactions+toggles,0);
  m.active=false;for(const key of ['1','Enter','f'])listeners.keydown({key});assert.equal(uses+interactions+toggles,3);
});
await test('镇妖塔暂停原 ARPG 主循环，仍自动存档，退出后恢复',()=>{
  const {m,x,saved}=fixture();const source=read('game.js');const begin=source.indexOf('function gameLoop(ts) {');const end=source.indexOf('// Main Update Loop',begin);
  let updates=0,draws=0;Object.assign(x,{gameActive:true,lastTime:0,autoSaveTimer:31,GAME_CONFIG:{AUTO_SAVE_INTERVAL:30},Juice:{update:()=>false},slowMotion:{active:false},update(){updates++},draw(){draws++}});
  vm.runInContext(source.slice(begin,end),x);m.active=true;x.gameLoop(100);
  assert.equal(updates+draws,0);assert.equal(saved.length,1);m.active=false;x.gameLoop(200);assert.equal(updates,1);assert.equal(draws,1);
});
await test('奖励接入层连续24次后台恢复：8小时加速稳定性',async()=>{
  const {m,x,saved}=fixture();m.open();const start=Date.now();
  for(let i=0;i<24;i++){m.catchUp(1200);await x.saves.save(true);assert(Number.isFinite(x.player.gold));assert(Number.isFinite(x.player.xp));assert.equal(x.player.idle.pity,m.run.pity);assert(m.logLines.length<=30);assert(m.view.enemies.size<=30)}
  assert.equal(x.player.idle.totals.seconds,28800);assert(x.player.idle.totals.kills>0);assert(saved.length>=24);
  console.log(JSON.stringify({acceleratedHours:8,wallMs:Date.now()-start,kills:x.player.kills,gold:x.player.gold,logCount:m.logLines.length,enemyViews:m.view.enemies.size}));
});
console.log(`集成回归：${passed} 通过，${failed} 失败（非浏览器）`);process.exitCode=failed?1:0;
})();
