# usage: camtest.py W H mode '{json tune}' tag   -> screenshot at flight(ft>1.8) / landing / celebrate with camera overrides
import sys, json, time
from playwright.sync_api import sync_playwright
W,H=int(sys.argv[1]),int(sys.argv[2]); mode=sys.argv[3]; tune=json.loads(sys.argv[4]); tag=sys.argv[5]
URL='http://localhost:8765/index.html?q=low&noadapt=1&shots=1'
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':W,'height':H},device_scale_factor=1,has_touch=True); pg=ctx.new_page()
    pg.on('pageerror',lambda e:print('pageerror',e))
    pg.goto(URL); pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=60000)
    pg.evaluate('(t)=>{window.__camTune=t}',tune)
    time.sleep(1.5); pg.evaluate('(a)=>window.__game.setAuto(a)',{'speed':0.86,'launch':0.55,'landOffset':0.04}); pg.click('#go',force=True)
    t0=time.time(); done=False
    while time.time()-t0<110 and not done:
        st=pg.evaluate('window.__game.state')
        if mode=='flight' and st=='flight' and pg.evaluate('window.__game.fl.ft')>1.9: done=True
        if mode=='preland' and st=='flight' and pg.evaluate('window.__game.fl.sim.tHit-window.__game.fl.ft')<0.9: done=True
        if mode=='land' and st=='landing' and pg.evaluate('window.__game.fl.sl')>0.9: done=True
        if mode=='celebrate' and st=='celebrate' and pg.evaluate('window.__game.fl.announced'): time.sleep(0.6); done=True
        time.sleep(0.08)
    pg.screenshot(path=f'/tmp/{tag}.png'); print('ok',tag)
    b.close()
