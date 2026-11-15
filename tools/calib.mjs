import * as P from '../src/physics.js';
console.log('K_X',P.K_X.toFixed(1),'HS_X',P.HS_X.toFixed(1),'ground@K',P.groundY(P.K_X).toFixed(1),'runstart',JSON.stringify(P.RUN_START));
const rows=[];
for (const v of [22,24,25,26.2]) { let r=[]; for (const pos of [0,0.15,0.3,0.45,0.55,0.65,0.75,0.9,1]) { const e=P.launchFromMeter(pos).e; const s=P.simulateFlight(v,e); r.push(s.dist.toFixed(0)+'('+s.tHit.toFixed(1)+')'); } console.log('v',v,r.join(' ')); }
