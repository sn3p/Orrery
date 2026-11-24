import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CONVENTIONS} from '../src/unified/comets/source/cometSourceCore.js';
const template=JSON.parse(await fs.readFile('tests/fixtures/comet-history-index.json'));
const ref=(body,prefix)=>{const sha256=createHash('sha256').update(body).digest('hex');return {url:`${prefix}${sha256}.json`,sha256,bytes:body.length};};
export function fixture(mutate=()=>{}) {
  const index=structuredClone(template), files=new Map();
  for(const o of index.objects) {
    for(const s of o.segments) {
      const count=(s.sample_coverage[1]-s.sample_coverage[0])/4+1;
      const value={comet_contract_version:s.payload_contract_version,id:o.id,conventions:CONVENTIONS,
        series:{start:s.sample_coverage[0],step:4,states:Array.from({length:count},()=>[0,0,0,0,0,0])}};
      if(s.key==='historical')value.segment='historical';
      for(const c of s.key==='historical'?s.validation.checks:[s.validation]) {
        c.max_error_au=0; c.references=c.references.map(r=>[r[0],0,0,0]);
      }
      mutate('payload',value,o,s);
      const body=Buffer.from(JSON.stringify(value));s.data=ref(body,'objects/');files.set(s.data.url,body);
    }
    if(o.transition)for(const c of o.transition.comparisons){c.position_difference_au=0;c.velocity_difference_au_per_day=0;}
  }
  mutate('index',index);
  const body=Buffer.from(JSON.stringify(index)), pin=ref(body,'index-');files.set(pin.url,body);
  files.set('latest.json',JSON.stringify({comet_contract_version:3,index:pin}));
  return {files,index};
}
