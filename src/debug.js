import * as THREE from 'three';
import { Skier, loadSkierAssets, SUITS } from './skier.js';
import { CLIP_DEFS } from './anim.js';
const W=1400,H=900;
const r = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); r.setSize(W,H); r.setScissorTest(true); document.body.appendChild(r.domElement);
const sc = new THREE.Scene(); sc.background=new THREE.Color(0xb8d4f0);
sc.add(new THREE.HemisphereLight(0xdceaff,0x8896aa,1.1)); const dl=new THREE.DirectionalLight(0xfff2dd,1.9); dl.position.set(3,6,5); sc.add(dl);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(50,50),new THREE.MeshToonMaterial({color:0xeaf2ff})); ground.rotation.x=-Math.PI/2; sc.add(ground);
window.THREE=THREE;
loadSkierAssets('models/').then(assets=>{
  const sk=new Skier(assets); sc.add(sk.root); window.sk=sk;
  const cam=new THREE.PerspectiveCamera(30,1,0.1,100);
  // contact sheet: rows=clips, cols = sample times
  window.sheet=(names,cols,side,suit)=>{
    if(suit) sk.setSuit(suit);
    r.setScissorTest(true); r.setClearColor(0xb8d4f0); r.clear();
    const rows=names.length; const cw=W/cols, ch=H/rows;
    names.forEach((nm,ri)=>{
      const d=CLIP_DEFS[nm]; sk.play(nm,0);
      for(let c=0;c<cols;c++){
        const t=d.dur*(cols===1?0:c/(cols-1))*(d.loop?(1-1/cols):1);
        sk.mixer.setTime(t); sk.root.updateMatrixWorld(true);
        const x=c*cw,y=H-(ri+1)*ch; r.setViewport(x,y,cw,ch); r.setScissor(x,y,cw,ch);
        cam.aspect=cw/ch; cam.updateProjectionMatrix();
        if(side==='front') cam.position.set(4.2,1.1,0.5); else if(side==='q') cam.position.set(2.0,1.2,2.8); else cam.position.set(0.2,1.0,3.6);
        cam.lookAt(0,0.95,0); r.render(sc,cam);
      }
    });
    return rows;
  };
  window.__ready=true;
});
window.addEventListener('load',()=>{});
const _wait=setInterval(()=>{ if(!window.sk) return; clearInterval(_wait);
  window.view=(clip,t,cp,la,suit)=>{ if(suit) sk.setSuit(suit); const d=CLIP_DEFS[clip]; sk.play(clip,0); sk.mixer.setTime(t); sk.root.updateMatrixWorld(true);
    r.setScissorTest(false); r.setViewport(0,0,W,H); const cam=new THREE.PerspectiveCamera(30,W/H,0.05,100); cam.position.set(...cp); cam.lookAt(...la); r.setClearColor(0xb8d4f0); r.clear(); r.render(sc,cam); return 1; };
},50);
