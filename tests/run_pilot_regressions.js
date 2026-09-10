'use strict';
// Run independently and record exit status; npm's original semicolon chain is
// shell-dependent and can hide earlier failures. Do not silently skip failures.
const fs = require('fs');
const path = require('path');
const {spawnSync}=require('child_process');
const files=[
  'verify_alpha_gates.js','verify_security_gates.js','verify_stage1_evidence_gates.js',
  'verify_stage1_otel_sdk_proof.js','verify_stage4_governance_gates.js',
  'verify_stage5_durability_gates.js','verify_stage6_ibm_adapter_gates.js',
  'verify_stage9_drift_gates.js','verify_stage10_request_drift_gates.js',
  'verify_stage11_generality_gates.js','verify_stage12_otlp_encoding_gates.js',
  'verify_stage13_rulepack_coverage_gates.js','verify_stage14_learned_baseline_gates.js',
  'verify_stage16_no_fabricated_facts_gates.js','verify_relationship_pilot.js',
  'verify_fin_capture.js','verify_node_live_capture.js'
];
const dir=path.resolve(__dirname,'../artifacts/pilot');fs.mkdirSync(dir,{recursive:true});
const results=[];
for(const file of files){
  const r=spawnSync(process.execPath,[path.join(__dirname,file)],{encoding:'utf8',timeout:90000});
  const output=(r.stdout||'')+(r.stderr||'');fs.writeFileSync(path.join(dir,file+'.log'),output);
  const status=r.status===0&&!r.error?'PASS':'FAIL';
  results.push({file,status,exitCode:r.status,error:r.error?.message,log:file+'.log'});console.log(status,file);
}
fs.writeFileSync(path.join(dir,'regressions.json'),JSON.stringify({runAt:new Date().toISOString(),results},null,2));
process.exitCode=results.some(r=>r.status!=='PASS')?1:0;
