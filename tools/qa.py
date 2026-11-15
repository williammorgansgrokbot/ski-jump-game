import sys, json, time
from playwright.sync_api import sync_playwright
W,H = int(sys.argv[1]), int(sys.argv[2]); tag=sys.argv[3]; mode=sys.argv[4] if len(sys.argv)>4 else 'title'
URL='http://localhost:8765/index.html?noadapt=1&shots=1'
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    ctx=b.new_context(viewport={'width':W,'height':H},device_scale_factor=1,has_touch=True, record_video_dir='/workspace/ski-jump-game/previews/vid_'+tag if mode=='video' else None, record_video_size={'width':W,'height':H} if mode=='video' else None)
    pg=ctx.new_page()
    pg.on('console',lambda m:(print('console:',m.type,m.text), errs.append(m.text) if m.type=='error' else None))
    pg.on('pageerror',lambda e:(print('pageerror:',e), errs.append(str(e))))
    pg.goto(URL)
    pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=60000)
    time.sleep(1.0)
    pg.screenshot(path=f'previews/{tag}_title.png')
    if mode!='title':
        pg.evaluate('(a)=>window.__game.setAuto(a)', json.loads(sys.argv[5]) if len(sys.argv)>5 else {'speed':0.86,'launch':0.55,'landOffset':0.04})
        pg.click('#go',force=True)
        shots={'inrun':False,'flight':False,'landing':False,'celebrate':False,'result':False}
        t0=time.time(); lipshot=False
        while time.time()-t0<float(__import__("os").environ.get("QA_TMO","120")):
            st=pg.evaluate('window.__game.state')
            if st=='inrun':
                rt=pg.evaluate('window.__game.run.t')
                for k,th in enumerate([0.5,1.7,2.9,4.1]):
                    if rt>th and not shots.get('in%d'%k):
                        pg.screenshot(path=f'previews/{tag}_inrun{k+1}.png'); shots['in%d'%k]=True; print('inrun shot',k+1,'t=',rt)
                        break
                shots['inrun']=True
            if st=='lip' and not lipshot and pg.evaluate('window.__game.lip.t')>0.5: pg.screenshot(path=f'previews/{tag}_lip.png'); lipshot=True
            if st=='flight' and not shots['flight'] and pg.evaluate('window.__game.fl.ft')>1.8:
                print('info-flight',pg.evaluate('window.__game.info()')); pg.screenshot(path=f'previews/{tag}_flight.png'); shots['flight']=True
            if st=='flight' and shots['flight'] and not shots.get('pre') and pg.evaluate('window.__game.fl.sim.tHit-window.__game.fl.ft')<1.0: pg.screenshot(path=f'previews/{tag}_preland.png'); shots['pre']=True
            if st=='landing' and not shots['landing'] and pg.evaluate('window.__game.fl.sl')>0.9: pg.screenshot(path=f'previews/{tag}_landing.png'); shots['landing']=True
            if st=='celebrate' and not shots['celebrate'] and pg.evaluate('window.__game.fl.announced'): time.sleep(0.5); pg.screenshot(path=f'previews/{tag}_celebrate.png'); shots['celebrate']=True
            if st=='result' and not shots['result']: time.sleep(1.3); pg.screenshot(path=f'previews/{tag}_result.png'); shots['result']=True; break
            time.sleep(0.15)
        print('info',pg.evaluate('window.__game.info()')); print('result',pg.evaluate('window.__game.result()'), 'fps', pg.evaluate('window.__game.fps()'), shots)
    print('ERRORS',errs)
    ctx.close(); b.close()
