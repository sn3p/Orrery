const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {launchBrowser} = require('./browsers.cjs');
const revision = '53a6ce491c5b5a119236fc629e54449bf15920a5';
(async()=>{
  const producer=path.resolve(process.argv[2]||'.context/producer');
  if(execFileSync('git',['-C',producer,'rev-parse','HEAD'],{encoding:'utf8'}).trim()!==revision)throw Error('Exact producer revision required');
  const root=path.resolve('.context/comet-directory-app');
  await require('./three-build.cjs').build(root);
  const browser=await launchBrowser(process.argv[3]||'chromium');
  try {
    for(const lane of ['data/comets','.context/comet-candidates/directory-v4-907f8cb552c6'])
      await require('./comet-directory-browser.cjs')(browser,root,path.join(producer,lane));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
