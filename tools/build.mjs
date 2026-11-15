import esbuild from 'esbuild';
import fs from 'fs';
const entries = process.argv.slice(2).length ? process.argv.slice(2) : ['main'];
for (const e of entries) {
  const r = await esbuild.build({ entryPoints: ['src/'+e+'.js'], bundle: true, minify: e==='main', format: 'iife', target: ['es2022'], write: false, legalComments: 'none', logLevel: 'warning' });
  fs.mkdirSync('build', { recursive: true });
  fs.writeFileSync('build/'+e+'.js', r.outputFiles[0].text);
  console.log(e, (r.outputFiles[0].text.length/1024).toFixed(0)+'KB');
}
