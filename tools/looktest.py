import sys, json, time
from playwright.sync_api import sync_playwright
W,H=844,390
URL='http://localhost:8765/index.html?q=low&noadapt=1&shots=1'
combos=[('galaxy','rainbow','reid'),('gold','flame','brady'),(None,None,'stetson')]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    for i,(su,sk,chip) in enumerate(combos):
        ctx=b.new_context(viewport={'width':W,'height':H},device_scale_factor=1); pg=ctx.new_page()
        errs=[]; pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.add_init_script("localStorage.setItem('sj_equip',%s);localStorage.setItem('sj_suit','\"%s\"');localStorage.setItem('sj_best','200')"%(json.dumps(json.dumps({'suit':su,'ski':sk})),chip))
        pg.goto(URL); pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=60000); time.sleep(1.5)
        pg.screenshot(path=f'/tmp/look{i}_title.png')
        pg.evaluate('(a)=>window.__game.setAuto(a)',{'speed':0.86,'launch':0.55,'landOffset':0.04}); pg.click('#go',force=True)
        t0=time.time()
        while time.time()-t0<100:
            st=pg.evaluate('window.__game.state')
            if st=='flight' and pg.evaluate('window.__game.fl.ft')>1.9: break
            time.sleep(0.1)
        pg.screenshot(path=f'/tmp/look{i}_flight.png'); print(i,errs); ctx.close()
    b.close()
