// Bundles src/main.js (minified) and inlines it into index.html (from src/index.template.html).
import fs from 'fs'; import { execSync } from 'child_process';
execSync('node tools/build.mjs main', { stdio: 'inherit' });
const js = fs.readFileSync('build/main.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/index.template.html', 'utf8');
if (tpl.indexOf('/*GAME*/') < 0) throw new Error('placeholder missing');
fs.writeFileSync('index.html', tpl.replace('<script>/*GAME*/</script>', () => '<script>' + js + '</script>'));
console.log('index.html', (fs.statSync('index.html').size / 1024).toFixed(0) + 'KB');
