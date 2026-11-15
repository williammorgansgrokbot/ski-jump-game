import sys, json, time, os
from playwright.sync_api import sync_playwright
W,H = int(sys.argv[1]), int(sys.argv[2]); tag=sys.argv[3]; mode=sys.argv[4] if len(sys.argv)>4 else 'full'   # full | subset | video
PLAN=json.loads(sys.argv[5]) if len(sys.argv)>5 else [0.0,-0.2,0.0,'miss',0.02,-0.4,0.0]
URL='http://localhost:8765/index.html?noadapt=1&shots=1'
OUT='previews/park/'; os.makedirs(OUT,exist_ok=True)
errs=[]; TMO=float(os.environ.get('QA_TMO','240'))
IDS=['grab','rail','back','box','spin','front','big']
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
    ctx=b.new_context(viewport={'width':W,'height':H},device_scale_factor=1,has_touch=True, record_video_dir='/workspace/ski-jump-game/previews/vid_'+tag if mode=='video' else None, record_video_size={'width':W,'height':H} if mode=='video' else None)
    pg=ctx.new_page()
    pg.on('console',lambda m:(print('console:',m.type,m.text), errs.append(m.text) if m.type=='error' else None))
    pg.on('pageerror',lambda e:(print('pageerror:',e), errs.append(str(e))))
    pg.goto(URL)
    pg.wait_for_function('window.__game && window.__game.state==="title"',timeout=60000)
    time.sleep(0.8)
    full = mode=='full'
    if full: pg.screenshot(path=f'{OUT}{tag}_title_jump.png')
    pg.click('#modes .chip[data-id=park]',force=True); time.sleep(0.5)
    pg.screenshot(path=f'{OUT}{tag}_title.png')
    pg.click('#go',force=True); tgo=time.time()
    pg.wait_for_function('window.__game.state==="park" && window.__game.park.sim && window.__game.park.state!=="idle"',timeout=90000)
    inf=pg.evaluate('window.__game.park.info()'); ev=inf['ev']; tg=inf['target']; print('dur',inf['dur'],'targets',[round(x,2) for x in tg])
    for j,e in enumerate(ev): print(IDS[j], {k:round(v,2) for k,v in e.items()})
    pg.evaluate('(a)=>window.__game.park.setAuto(a)',PLAN)
    # pause schedule (game time) -> screenshots
    sched=[]
    def off(j):
        a=PLAN[j]; return 0 if a=='miss' else a
    sched.append(('riding',2.2))
    for j,i in enumerate(IDS):
        e=ev[j]; sched.append((f'approach_{i}', tg[j]-0.55))
        if 'tLand' in e and 'tOn' not in e:
            sched.append((f'trick_{i}', (e['tRel']+e['tLand'])/2+0.05 if i!='big' else e['tRel']+ (e['tLand']-e['tRel'])*0.45))
            sched.append((f'popup_{i}', e['tLand']+0.25))
        else:
            sched.append((f'trick_{i}', e['tOn']+ (e['tRel']-e['tOn'])*0.55)); sched.append((f'popup_{i}', e['tRel']+0.4))
    keep={'riding','approach_back','trick_grab','trick_rail','trick_back','trick_box','trick_spin','trick_front','trick_big','popup_big','popup_back','approach_big'} if full else {'approach_back','trick_back','trick_big'}
    if mode=='video': keep=set()
    sched=sorted([s for s in sched if s[0] in keep], key=lambda x:x[1])
    pg.evaluate('(a)=>{window.__game.park.pauseAt=a}',[s[1] for s in sched])
    t0=time.time(); k=0; finished=False; fin_shot=False
    while time.time()-t0<TMO:
        st=pg.evaluate('window.__game.park.state')
        if pg.evaluate('window.__game.park.paused') and k<len(sched):
            nm=sched[k][0]; time.sleep(0.25); pg.screenshot(path=f'{OUT}{tag}_{nm}.png'); print('shot',nm, pg.evaluate('JSON.stringify(window.__game.park.info().cur)')); k+=1
            pg.evaluate('window.__game.park.paused=false')
        if st=='finish' and full and not fin_shot: time.sleep(0.8); pg.screenshot(path=f'{OUT}{tag}_finish_line.png'); fin_shot=True
        if st=='result':
            time.sleep(1.3); pg.screenshot(path=f'{OUT}{tag}_finish.png'); finished=True; break
        time.sleep(0.12 if mode!='video' else 0.3)
    inf=pg.evaluate('window.__game.park.info()'); print('res',inf['rt'],'score',inf['score'],'last',pg.evaluate('window.__lastParkResult'),'fps',pg.evaluate('window.__game.fps()'),'finished',finished,'elapsed',round(time.time()-t0))
    print('ERRORS',errs,'wall_since_go',round(time.time()-tgo,1))
    ctx.close(); b.close()
