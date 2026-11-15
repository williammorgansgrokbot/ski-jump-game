# usage: closeup.py out.png clip [yaw] [mode: face|body|side]
import sys,time
from playwright.sync_api import sync_playwright
out,clip=sys.argv[1],sys.argv[2]; yaw=float(sys.argv[3]) if len(sys.argv)>3 else -1.25; mode=sys.argv[4] if len(sys.argv)>4 else 'body'
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1000,'height':700},device_scale_factor=1)
    pg.on('pageerror',lambda e:print('pageerror',e))
    pg.on('console',lambda m:print('c:',m.text) if m.type=='error' else None)
    pg.goto('http://localhost:8765/index.html?q=high&noadapt=1&shots=1')
    pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=60000)
    pg.add_style_tag(content='#title,#bg{display:none!important} body{background:#8fc3ee!important}')
    pg.evaluate("""([clip,yaw,mode])=>{const g=window.__game; const s=g.skier(); s.play(clip,0); g.G.tt=-999; g.G.titleCheer=0; const t=g.tcam; t.clearViewOffset(); t.fov=30; t.aspect=1000/700;
      s.root.rotation.y=yaw; window.__freeze=1;
      const hp=new t.position.constructor(); s.bones.Head.getWorldPosition(hp); if(mode==='face'){t.position.set(1.0,hp.y+0.05,2.6); t.lookAt(0,hp.y+0.05,0); t.fov=20} else if(mode==='side'){t.position.set(0,1.0,7); t.lookAt(0,0.8,0)} else {t.position.set(1.2,1.2,4.6); t.lookAt(0,0.95,0)}
      t.updateProjectionMatrix();}""",[clip,yaw,mode])
    time.sleep(1.0)
    pg.evaluate("""([clip,yaw,mode])=>{const g=window.__game; const t=g.tcam; g.skier().root.rotation.y=yaw;}""",[clip,yaw,mode])
    time.sleep(0.4); pg.screenshot(path=out); b.close()
