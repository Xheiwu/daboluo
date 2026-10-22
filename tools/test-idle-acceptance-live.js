// 真实 Chromium 浏览器模拟验收（仍非手机真机）。需要已有 playwright 与浏览器。
// node tools/test-idle-acceptance-live.js [--output /tmp/pr1-browser]
// 使用独立临时上下文与本地 QA 服务；隔离线上服务，保留真实 IndexedDB。
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const arg=process.argv.indexOf('--output');
const out=path.resolve(arg<0?'/tmp/pr1-browser':process.argv[arg+1]);
fs.mkdirSync(out,{recursive:true});
(async()=>{
  let browser;
  const server=spawn(process.execPath,['tools/qa-server.js','--port','0'],{cwd:root,stdio:['ignore','pipe','pipe']});
  try{
    const base=await new Promise((resolve,reject)=>{
      let buf='';const timeout=setTimeout(()=>reject(new Error('QA 服务启动超时')),10000);
      server.stdout.on('data',d=>{buf+=d;const line=buf.split('\n')[0];try{const info=JSON.parse(line);clearTimeout(timeout);resolve(info.original)}catch{}});
      server.on('error',reject);server.on('exit',code=>reject(new Error('QA 服务退出 '+code)));
    });
    browser=await chromium.launch({headless:true});
    const results=[];
    for(const size of [{width:390,height:844},{width:320,height:568}]){
      const ctx=await browser.newContext({viewport:size,isMobile:true,hasTouch:true});
      const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const start=async slot=>{
        await page.goto(base);
        await page.waitForFunction(()=>SaveSystem.isReady);
        await page.evaluate(async slot=>{
          await SaveSystem.loadSlot(slot);startGame();closeDailyLoginPanel();
          player.tutorial.completed=true;hideTutorialTip();hideTutorialBubble();
        },slot);
      };
      const tapMenu=async id=>{
        if(!await page.locator(id).isVisible())await page.locator('#mobile-menu-toggle').tap();
        await page.locator(id).tap();
      };
      await start(1);
      // 新版创建存档后删除新增字段，构造 main 时代的真实 IndexedDB 存档。
      await page.evaluate(async()=>{
        await SaveSystem.save(true);
        await new Promise((resolve,reject)=>{
          const tx=db.transaction(['saveData'],'readwrite'),store=tx.objectStore('saveData'),req=store.get('slot_1');
          req.onsuccess=()=>{const d=req.result;delete d.home;delete d.idle;store.put(d)};
          tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
        });
      });
      await start(1);
      assert(await page.evaluate(()=>!!player.home && player.idle.floor===1));
      await tapMenu('#btn-home');await page.locator('[data-home-tab="farm"]').tap();
      const home=await page.locator('#home-panel').boundingBox();
      assert(home.x>=0 && home.x+home.width<=size.width+1,'家园横向越界');
      await page.screenshot({path:path.join(out,`${size.width}-home.png`)});
      await page.locator('#home-panel [data-home-action="close"]').tap();
      await tapMenu('#btn-idle');await page.waitForFunction(()=>IdleMode.active);
      await page.locator('[data-idle="panel"][data-arg="floors"]').tap();
      assert(await page.locator('#idle-panel').isVisible());
      await page.locator('[data-idle="panel-close"]').tap();
      const canvas=await page.locator('#idle-canvas').boundingBox();assert(canvas.width>0 && canvas.height>80,'战场可视区域不足');
      const exit=await page.locator('[data-idle="close"]').last().boundingBox();assert(exit.y+exit.height<=size.height+1,'回营地按钮超出屏幕');
      await page.screenshot({path:path.join(out,`${size.width}-tower.png`)});
      await page.keyboard.press('3');assert(await page.evaluate(()=>isInTown()),'塔内快捷键改变了原模式位置');
      // 合成时间仅验证后台恢复路径，并非经过真实一小时。
      await page.evaluate(()=>{IdleMode.lastFrame-=3600000});
      await page.waitForTimeout(1000);assert(await page.evaluate(()=>Number.isFinite(player.gold)));
      await page.locator('[data-idle="close"]').last().tap();
      assert(await page.evaluate(()=>!IdleMode.active && isInTown()));
      // 真实数据库 round trip：标记 A 槽，刷新后新 B 槽不能继承，再加载 A。
      await page.evaluate(async()=>{player.idle.mats.qa_marker=23;await SaveSystem.save(true)});
      await start(2);assert(await page.evaluate(()=>!player.idle.mats.qa_marker && player.idle.floor===1));
      await page.evaluate(async()=>{await SaveSystem.save(true)});
      await start(1);assert.equal(await page.evaluate(()=>player.idle.mats.qa_marker),23);
      // 原 ARPG 进入地牢与回营地，确认主循环恢复；视觉仍需人工检查截图。
      await page.evaluate(()=>enterFloor(1,'start'));await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(()=>player.floor),1);
      await page.screenshot({path:path.join(out,`${size.width}-arpg.png`)});
      await page.evaluate(()=>enterFloor(0,'start'));
      assert.deepEqual(errors,[],'浏览器运行异常');results.push({size,status:'passed',errors});await ctx.close();
    }
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
  }finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
