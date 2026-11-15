import sys,asyncio,json
from playwright.sync_api import sync_playwright
# usage: shot.py url out.png "js to eval before shot"
url,out=sys.argv[1],sys.argv[2]; js=sys.argv[3] if len(sys.argv)>3 else ''
with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg=b.new_page(viewport={'width':1400,'height':900})
    pg.on('console',lambda m:print('console:',m.text))
    pg.on('pageerror',lambda e:print('pageerror:',e))
    pg.goto(url); pg.wait_for_function('window.__ready===true',timeout=20000)
    if js: print(pg.evaluate(js))
    pg.screenshot(path=out); b.close()
