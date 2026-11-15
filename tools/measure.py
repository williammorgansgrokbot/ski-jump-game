# load size + renderer stats. usage: measure.py W H [url-suffix]
import sys, time, gzip, json
from playwright.sync_api import sync_playwright
W,H=int(sys.argv[1]),int(sys.argv[2]); base=sys.argv[3] if len(sys.argv)>3 else 'http://localhost:8765/index.html'
URL=base+('&' if '?' in base else '?')+'noadapt=1&shots=1'
files={}
def fmt(n): return '%.0f KB'%(n/1024)
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    ctx=b.new_context(viewport={'width':W,'height':H},device_scale_factor=1,has_touch=True); pg=ctx.new_page()
    errs=[]; pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None); pg.on('pageerror',lambda e:errs.append(str(e)))
    def r(resp):
        try: body=resp.body()
        except Exception: return
        ct=resp.headers.get('content-type','')
        gz=len(gzip.compress(body,6)) if ('text' in ct or 'javascript' in ct or 'json' in ct) else len(body)
        files[resp.url.split('/')[-1] or 'index']=(len(body),gz)
    pg.on('response',r)
    pg.goto(URL); pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=90000); time.sleep(2)
    raw=sum(v[0] for v in files.values()); gz=sum(v[1] for v in files.values())
    print('LOAD raw',fmt(raw),'compressed-est',fmt(gz),'files',len(files))
    for k,v in sorted(files.items(),key=lambda kv:-kv[1][1])[:8]: print('  ',k,fmt(v[0]),fmt(v[1]))
    stats={}
    pg.evaluate('(a)=>window.__game.setAuto(a)',{'speed':0.86,'launch':0.55,'landOffset':0.04}); pg.click('#go',force=True)
    t0=time.time(); got=set()
    while time.time()-t0<120:
        st=pg.evaluate('window.__game.state')
        if st=='inrun' and 'inrun' not in got and pg.evaluate('window.__game.run.t')>3: stats['inrun']=pg.evaluate('window.__game.info()'); got.add('inrun')
        if st=='flight' and 'flight' not in got and pg.evaluate('window.__game.fl.ft')>1.8: stats['flight']=pg.evaluate('window.__game.info()'); got.add('flight')
        if st=='celebrate' and 'cel' not in got: time.sleep(0.4); stats['celebrate']=pg.evaluate('window.__game.info()'); got.add('cel')
        if st=='result': break
        time.sleep(0.1)
    print('STATS',json.dumps(stats)); print('ERR',errs); b.close()
