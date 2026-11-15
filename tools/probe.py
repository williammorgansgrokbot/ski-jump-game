import sys, json, time
from playwright.sync_api import sync_playwright
W,H=int(sys.argv[1]),int(sys.argv[2]); st_want=sys.argv[3]; thr=float(sys.argv[4]) if len(sys.argv)>4 else 1.8
auto=json.loads(sys.argv[5]) if len(sys.argv)>5 else {'speed':0.86,'launch':0.55,'landOffset':0.04}
URL='http://localhost:8765/index.html?q=low&noadapt=1&shots=1'
JS='''()=>{const g=window.__game,s=g.skier(),c=g.cam;const V=c.position.clone();c.updateMatrixWorld(true);s.root.updateMatrixWorld(true);
const body=s.body;const pts=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([x,y])=>{const v=V.clone().set(x,y,0);body.localToWorld(v);v.project(c);return [(v.x*.5+.5)*innerWidth,(1-(v.y*.5+.5))*innerHeight]});
const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
return {state:g.state,cam:c.position.toArray().map(v=>+v.toFixed(2)),fov:c.fov,skier:s.root.position.toArray().map(v=>+v.toFixed(2)),quadH:+(Math.max(...ys)-Math.min(...ys)).toFixed(1),quadHfrac:+((Math.max(...ys)-Math.min(...ys))/innerHeight).toFixed(3),quadW:+(Math.max(...xs)-Math.min(...xs)).toFixed(1),bbox:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(v=>+v.toFixed(0)),cur:s.cur}}'''
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':W,'height':H},device_scale_factor=1,has_touch=True); pg=ctx.new_page()
    pg.on('pageerror',lambda e:print('pageerror',e))
    pg.goto(URL); pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=60000)
    time.sleep(1.5); pg.evaluate('(a)=>window.__game.setAuto(a)',auto); pg.click('#go',force=True)
    t0=time.time(); n=0
    while time.time()-t0<100:
        st=pg.evaluate('window.__game.state')
        if st in ('flight','landing','celebrate'):
            ft=pg.evaluate('window.__game.fl.ft')
            if st=='flight' and ft>thr or st!='flight' and st==st_want:
                print(json.dumps(pg.evaluate(JS))); n+=1
                if n>=int(sys.argv[6] if len(sys.argv)>6 else 3): break
                time.sleep(0.7)
        time.sleep(0.1)
    b.close()
