// ==UserScript==
// @name         多点自动点击
// @namespace    local.garden.clicker
// @version      1.2.1
// @updateURL    https://raw.githubusercontent.com/60gg/script/main/garden-auto-click.user.js
// @downloadURL  https://raw.githubusercontent.com/60gg/script/main/garden-auto-click.user.js
// @description  拖动准星取点、多点顺序点击、独立等待时间和循环间隔。默认不自动运行。
// @match        https://*/*
// @match        http://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  const CHANNEL = 'garden-click-bridge-v1';
  const TARGET_KEY = 'clicker-local-target';
  const localTarget = GM_getValue(TARGET_KEY, null);
  if (window === window.top) {
    GM_registerMenuCommand('在当前页面启用点击面板（仅本地）', () => {
      GM_setValue(TARGET_KEY, { origin: location.origin, path: location.pathname });
      location.reload();
    });
    GM_registerMenuCommand('取消绑定点击页面（仅本地）', () => {
      GM_setValue(TARGET_KEY, null);
      location.reload();
    });
  }
  if (!localTarget || typeof localTarget.origin !== 'string' || typeof localTarget.path !== 'string') return;
  const trustedOrigin = origin => origin === localTarget.origin;
  const isGame = trustedOrigin(location.origin) && location.pathname === localTarget.path;
  const hostedByGame = [...(location.ancestorOrigins || [])].some(trustedOrigin);
  // 跨域 iframe 需要按其自身地址注入；其他顶层网页立即退出，不显示面板。
  if (window === window.top && !isGame) return;
  if (window !== window.top && !hostedByGame) return;
  /** 将归一化坐标传入子页面，并等待回执。 */
  function forwardClick(frame, x, y, mode) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const destination = frame.contentWindow;
      const listener = e => {
        const data = e.data;
        if (e.source !== destination || !data || data.channel !== CHANNEL || data.id !== id || data.type !== 'result') return;
        clearTimeout(timer); window.removeEventListener('message', listener);
        data.error ? reject(Error(data.error)) : resolve();
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', listener);
        reject(Error('iframe 未响应：保存新版脚本后刷新整个游戏页面，并确认油猴允许在游戏子页面运行'));
      }, 3000);
      window.addEventListener('message', listener);
      destination.postMessage({ channel:CHANNEL, type:'click', id, x, y, mode }, '*');
    });
  }
  /** 将视口坐标换算到 iframe 内容区域；由调用方等待回执。 */
  function clickFrame(frame, x, y, mode) {
    const r=frame.getBoundingClientRect();
    const sx=r.width/frame.offsetWidth, sy=r.height/frame.offsetHeight;
    const rx=(x-r.left-frame.clientLeft*sx)/(frame.clientWidth*sx);
    const ry=(y-r.top-frame.clientTop*sy)/(frame.clientHeight*sy);
    return forwardClick(frame,rx,ry,mode);
  }
  if (window !== window.top) {
    window.addEventListener('message', async e => {
      const d=e.data;
      if (e.source!==window.parent || !d || d.channel!==CHANNEL || d.type!=='click' || typeof d.id!=='string') return;
      if (!['pointer','mouse','touch'].includes(d.mode)) return;
      const result = {channel:CHANNEL,type:'result',id:d.id,error:null};
      try {
        const x=d.x*innerWidth, y=d.y*innerHeight;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x<0 || y<0 || x>=innerWidth || y>=innerHeight) throw Error('iframe 内坐标超出可见区域');
        const target=document.elementFromPoint(x,y);
        if (!target) throw Error('iframe 内没有找到点击目标');
        if (target.tagName==='IFRAME') await clickFrame(target,x,y,d.mode);
        else dispatchAt(target,x,y,d.mode);
      } catch(err) { result.error=err.message; }
      e.source.postMessage(result,e.origin==='null'?'*':e.origin);
    });
    return;
  }
  const KEY = 'garden-clicker-v1';
  const defaults = { points: [], gap: 100, rounds: 0, mode: 'pointer', left: 16, top: 90 };
  let config;
  try { config = { ...defaults, ...JSON.parse(GM_getValue(KEY, '{}')) }; }
  catch { config = { ...defaults }; }
  if (!Array.isArray(config.points)) config.points = [];
  let running = false, generation = 0, cancelWait = null, picking = false, cleanupPick = null;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:${Number(config.left)||16}px;top:${Number(config.top)||90}px;z-index:2147483647`;
  document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{font:13px/1.5 system-ui,'Microsoft YaHei',sans-serif;color:#e6edf8}
    *{box-sizing:border-box} .box{width:400px;max-width:95vw;background:#172131;border:1px solid #47556c;border-radius:12px;box-shadow:0 8px 28px #0006;overflow:hidden}
    header{padding:10px 12px;background:#233247;cursor:move;touch-action:none;display:flex;justify-content:space-between;align-items:center}
    main{padding:12px} p{margin:6px 0;color:#b7c6db} button,select,input{font:inherit;border:1px solid #52647c;border-radius:5px;background:#25354c;color:#fff;padding:5px}
    button{cursor:pointer} button:hover{background:#3a5271} button:disabled{opacity:.45;cursor:default} input{width:76px} label{display:inline-flex;gap:5px;align-items:center;margin:4px 8px 4px 0}
    .bar{display:flex;gap:7px;align-items:center;margin:8px 0}.aim{font-size:24px;width:48px;height:45px;color:#7ee5ff;touch-action:none;cursor:crosshair}.go{background:#18784b}.stop{background:#9d3442}
    .rows{max-height:230px;overflow:auto}.row{display:flex;align-items:center;gap:5px;padding:6px 0;border-bottom:1px solid #334257}.row input{width:62px}.row small{color:#aac4dc}.row button{padding:3px 6px}
    #status{padding:8px;background:#0f1825;border-radius:5px;overflow-wrap:anywhere} .hint{font-size:12px} [hidden]{display:none!important}
  </style><section class="box"><header><b>多点自动点击</b><button id="fold">收起</button></header><main>
    <div class="bar"><button class="aim" id="aim" title="按住拖到目标位置后松开">⊕</button><span>拖动准星到目标，松开添加坐标<br><small>也可点“取点”，再点画面位置</small></span><button id="pick">取点</button></div>
    <p class="hint">优先记录 Canvas 相对坐标；其他位置记录视口坐标。取点不会提交点击。</p>
    <div class="rows" id="rows"></div>
    <label>循环间隔 <input id="gap" type="number" min="0" step="100"> ms</label>
    <label>循环次数 <input id="rounds" type="number" min="0" step="1"></label>
    <p class="hint">0 次表示持续循环。每点等待 + 轮间隔累加；最后一轮不再等待。</p>
    <label>事件模式 <select id="mode"><option value="pointer">Pointer + Mouse（推荐）</option><option value="mouse">仅 Mouse</option><option value="touch">仅 Touch</option></select></label>
    <div class="bar"><button id="start" class="go">开始</button><button id="stop" class="stop">停止</button><button id="preview">预览坐标</button><button id="clear">清空</button></div>
    <p id="status">未运行。先添加一个点，单轮验证。</p><p class="hint">Esc 停止 / 取消取点；Alt+S 开始或停止。切到后台自动停止。拖动标题可移动面板。</p>
  </main></section>`;
  const $ = id => root.getElementById(id);
  const save = () => GM_setValue(KEY, JSON.stringify(config));
  const status = text => { $('status').textContent = text; };
  const number = (value, min = 0) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) throw Error(`请输入不小于 ${min} 的有效数字`);
    return n;
  };
  const settings = () => {
    config.gap = number($('gap').value);
    config.rounds = number($('rounds').value);
    if (!Number.isInteger(config.rounds)) throw Error('循环次数必须为整数');
    config.mode = $('mode').value;
    save();
  };
  const lock = () => {
    for (const el of root.querySelectorAll('input,select,#aim,#pick,#clear,#preview,.row button')) el.disabled = running;
    $('start').disabled = running;
  };
  function render() {
    $('rows').replaceChildren();
    config.points.forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'row';
      const tag = document.createElement('small'); tag.textContent = `${i + 1}. ${p.kind === 'canvas' ? '画布' : '视口'} (${p.x},${p.y})`;
      const wait = document.createElement('input'); wait.type = 'number'; wait.min = '0'; wait.step = '100'; wait.value = p.wait; wait.title = '此点点击后等待毫秒数';
      wait.addEventListener('change', () => { try { p.wait = number(wait.value); save(); } catch (e) { wait.value = p.wait; status(e.message); } });
      row.append(tag, document.createTextNode(' 等待'), wait, document.createTextNode('ms'));
      for (const [text, action] of [['↑', () => { if (i) [config.points[i-1],config.points[i]]=[config.points[i],config.points[i-1]]; }], ['×', () => config.points.splice(i,1)]]) {
        const button = document.createElement('button'); button.textContent = text;
        button.onclick = () => { action(); save(); render(); }; row.append(button);
      }
      $('rows').append(row);
    });
    lock();
  }
  for (const key of ['gap', 'rounds', 'mode']) {
    $(key).value = config[key];
    $(key).onchange = () => { try { settings(); } catch(e) { status(e.message); } };
  }
  function beginPick(dragEvent) {
    if (running || picking) return;
    picking = true;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.04);touch-action:none';
    const tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;pointer-events:none;background:#111e;color:white;padding:6px;border-radius:4px;font:13px system-ui;white-space:nowrap';
    overlay.append(tip); document.documentElement.append(overlay);
    const move = e => { tip.textContent = `⊕ ${Math.round(e.clientX)}, ${Math.round(e.clientY)} · 松开选取 · Esc取消`; tip.style.left = `${Math.min(e.clientX+14, innerWidth-260)}px`; tip.style.top = `${Math.max(0,e.clientY-34)}px`; };
    const finish = () => { overlay.remove(); picking = false; cleanupPick = null; };
    cleanupPick = finish;
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', e => {
      e.preventDefault(); e.stopImmediatePropagation();
      overlay.style.pointerEvents = 'none';
      const target = document.elementFromPoint(e.clientX, e.clientY);
      finish();
      if (!target || target === host || host.contains(target)) return status('请选取面板外的位置');
      const x = Math.round(e.clientX), y = Math.round(e.clientY);
      const canvases = [...document.querySelectorAll('canvas')];
      const canvas = target.closest('canvas');
      const p = { kind:'viewport', x, y, wait:0, width:innerWidth, height:innerHeight, scrollX, scrollY };
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        if (r.width && r.height) Object.assign(p, {kind:'canvas', index:canvases.indexOf(canvas), rx:(x-r.left)/r.width, ry:(y-r.top)/r.height});
      }
      config.points.push(p); save(); render(); status(`已添加第 ${config.points.length} 个点 (${x}, ${y})`);
    }, true);
    overlay.addEventListener('pointercancel', finish);
    if (dragEvent) { overlay.setPointerCapture(dragEvent.pointerId); move(dragEvent); }
    else { tip.textContent = '点击目标位置取点 · Esc取消'; tip.style.left='20px'; tip.style.top='20px'; }
  }
  $('aim').onpointerdown = e => { if (e.button === 0) { e.preventDefault(); beginPick(e); } };
  $('pick').onclick = () => beginPick();
  function resolve(p) {
    let x=p.x, y=p.y, canvas=null;
    if (p.kind === 'canvas') {
      canvas=document.querySelectorAll('canvas')[p.index];
      if (!canvas) throw Error('原 Canvas 不存在，请重新取点');
      const r=canvas.getBoundingClientRect();
      if (!r.width || !r.height) throw Error('Canvas 不可见');
      x=r.left+r.width*p.rx; y=r.top+r.height*p.ry;
    } else if (innerWidth!==p.width || innerHeight!==p.height || scrollX!==p.scrollX || scrollY!==p.scrollY) {
      throw Error('窗口大小或滚动位置发生变化，请重新取视口坐标');
    }
    if (x<0 || y<0 || x>=innerWidth || y>=innerHeight) throw Error('坐标在可见区域外');
    const target=document.elementFromPoint(x,y);
    if (!target || target===host || host.contains(target)) throw Error('坐标被控制面板遮挡，请移动面板');
    if (canvas && target!==canvas) throw Error('Canvas 点击位置被其他元素遮挡');
    return {x,y,target};
  }
  async function clickAt(p) {
    const {x,y,target}=resolve(p);
    if (target.tagName==='IFRAME') {
      // 必须等待 iframe 完成事件派发后，才能开始此点的等待计时。
      await clickFrame(target,x,y,config.mode);
      return;
    }
    dispatchAt(target,x,y,config.mode);
  }
  function dispatchAt(target,x,y,mode) {
    // 油猴隔离环境的 window 可能是代理，省略可选 view，避免 Window 类型转换失败。
    const init={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,screenX:screenX+x,screenY:screenY+y,button:0,detail:1};
    if (mode === 'touch') {
      if (typeof Touch !== 'function' || typeof TouchEvent !== 'function') throw Error('浏览器不支持模拟 Touch，请改用 Pointer 或 Mouse');
      const touch=new Touch({identifier:1,target,clientX:x,clientY:y,pageX:x+scrollX,pageY:y+scrollY,radiusX:1,radiusY:1,force:1});
      target.dispatchEvent(new TouchEvent('touchstart',{...init,touches:[touch],targetTouches:[touch],changedTouches:[touch]}));
      target.dispatchEvent(new TouchEvent('touchend',{...init,touches:[],targetTouches:[],changedTouches:[touch]}));
      return;
    }
    const mouse=(type,buttons=0)=>target.dispatchEvent(new MouseEvent(type,{...init,buttons}));
    const pointer=(type,buttons=0)=>target.dispatchEvent(new PointerEvent(type,{...init,buttons,pointerId:1,pointerType:'mouse',isPrimary:true,pressure:buttons?0.5:0}));
    if(mode==='pointer') pointer('pointermove'); mouse('mousemove');
    if(mode==='pointer') pointer('pointerdown',1); mouse('mousedown',1);
    if(mode==='pointer') pointer('pointerup'); mouse('mouseup'); mouse('click');
  }
  function stop(message='已停止') {
    running=false; generation++; if(cancelWait) cancelWait(); lock(); status(message);
  }
  function wait(ms,token) {
    return new Promise(resolve => {
      let timer; const finish=()=>{clearTimeout(timer);cancelWait=null;resolve();};
      cancelWait=finish; timer=setTimeout(finish,Math.max(0,ms));
      if(token!==generation) finish();
    });
  }
  async function start() {
    if(running || picking) return;
    try {
      settings();
      if(!config.points.length) throw Error('请先添加坐标');
      if(document.hidden) throw Error('请将游戏切换到前台');
      config.points.forEach(p => { number(p.wait); resolve(p); });
    } catch(e) { status(e.message); return; }
    running=true; const token=++generation; lock();
    const points=config.points.map(p=>({...p}));
    try {
      for(let round=1; running && token===generation; round++) {
        for(let i=0;i<points.length;i++) {
          if(!running || token!==generation) return;
          if(document.hidden) throw Error('页面进入后台，已停止');
          status(`第 ${round} 轮 · 点击 ${i+1}/${points.length} · Esc 停止`);
          // 点击与等待必须顺序执行，避免下一点先于游戏收到本次输入。
          await clickAt(points[i]);
          if(!running || token!==generation) return;
          if(i<points.length-1 || !config.rounds || round<config.rounds) await wait(points[i].wait,token);
        }
        if(!running || token!==generation) return;
        if(config.rounds && round>=config.rounds) { stop(`已完成 ${round} 轮。请检查游戏是否响应。`); return; }
        status(`第 ${round} 轮完成 · 等待 ${config.gap} ms 后继续`);
        await wait(config.gap,token);
      }
    } catch(e) { if(token===generation) stop(`停止：${e.message}`); }
  }
  $('start').onclick=start; $('stop').onclick=()=>stop();
  $('clear').onclick=()=>{config.points=[];save();render();status('已清空坐标');};
  $('preview').onclick=()=>{
    try {
      config.points.forEach((p,i)=>{
        const {x,y}=resolve(p), dot=document.createElement('div');
        dot.textContent=String(i+1); dot.style.cssText=`position:fixed;left:${x-12}px;top:${y-12}px;width:24px;height:24px;line-height:24px;text-align:center;border:2px solid #fff;border-radius:50%;background:#e33;color:white;z-index:2147483647;pointer-events:none;font: bold 15px/20px system-ui`;
        document.documentElement.append(dot);setTimeout(()=>dot.remove(),2000);
      }); status('已显示坐标编号，2 秒后消失；没有执行点击');
    } catch(e) {status(e.message);}
  };
  $('fold').onclick=()=>{const main=root.querySelector('main');main.hidden=!main.hidden;$('fold').textContent=main.hidden?'展开':'收起';};
  const header=root.querySelector('header');
  header.onpointerdown=e=>{
    if(e.target.closest('button') || e.button!==0) return;
    const r=host.getBoundingClientRect(), dx=e.clientX-r.left,dy=e.clientY-r.top;
    header.setPointerCapture(e.pointerId);
    header.onpointermove=ev=>{host.style.left=`${Math.max(0,Math.min(innerWidth-50,ev.clientX-dx))}px`;host.style.top=`${Math.max(0,Math.min(innerHeight-35,ev.clientY-dy))}px`;};
    header.onpointerup=()=>{header.onpointermove=null;config.left=parseFloat(host.style.left);config.top=parseFloat(host.style.top);save();};
    header.onpointercancel=()=>{header.onpointermove=null;};
  };
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){if(cleanupPick) cleanupPick();stop();}
    if(e.altKey && e.code==='KeyS' && !e.repeat){e.preventDefault();running?stop():start();}
  },true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden && running) stop('页面进入后台，已停止');});
  render();
})();
