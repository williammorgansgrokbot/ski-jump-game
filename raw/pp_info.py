import sys,re,urllib.request
def get(u): return urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=25).read().decode('utf8','ignore')
for i in sys.argv[1:]:
    try:
        t=get('https://poly.pizza/m/'+i)
        m=re.search(r'<title[^>]*>([^<]*)',t); title=m.group(1)[:60] if m else '?'
        g=re.search(r'https://static.poly.pizza/[a-f0-9-]+\.glb',t)
        lic=re.search(r'(CC0|CC-BY|Public Domain|Creative Commons[^<"]{0,20})',t)
        auth=re.search(r'href="/u/([^"]+)"',t)
        print(i,'|',title,'|',auth and auth.group(1),'|',lic and lic.group(1),'|',g and g.group(0))
    except Exception as e: print(i,'ERR',e)
