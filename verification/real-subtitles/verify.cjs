// Third-party subtitle data is CC BY 3.0; see ATTRIBUTION.md. This script is MIT.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../../core.js');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const write = (name, text) => fs.writeFileSync(path.join(__dirname, name), text);
const hashes = Object.fromEntries(['TOS-en.original.srt','TOS-CH.original.srt'].map(name => [name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,name))).digest('hex')]));
assert.equal(hashes['TOS-en.original.srt'], 'ce9578f6fe098a5821045a38884b229160f9e7ba27890448a92f5be330c6e6fe');
assert.equal(hashes['TOS-CH.original.srt'], '456152557f85f5874ec7c96c99a68ff05c325013972ca059b193f0d93f036d45');
const source = read('TOS-en.original.srt');
const original = read('TOS-CH.original.srt');
// An independent, fixture-specific normalizer; it is NOT used by the product.
const rows = original.replace(/^\uFEFF/,'').split(/\r\n|\r|\n/).map(s=>s.trim()).filter(Boolean);
const indices = rows.map((s,i)=>s.includes('-->')?i:-1).filter(i=>i>=0);
assert.equal(indices.length,77);
const normalizedCues = indices.map((line,i)=> {
  const next = indices[i+1] ?? rows.length;
  const end = next < rows.length && /^\d+$/.test(rows[next-1]) ? next-1 : next;
  let timing = rows[line];
  if (i === 0) { assert.equal(timing,'00:00:04,000 --> 00:00:06'); timing += ',000'; }
  assert.match(timing,/^\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}$/);
  return {id:i===0?'0':rows[line-1],timing,body:rows.slice(line+1,end).join('\n')};
});
assert.deepEqual(normalizedCues.map(c=>c.id),Array.from({length:77},(_,i)=>String(i)));
assert.deepEqual(normalizedCues.flatMap(c=>c.body.split('\n')),rows.filter(s=>!s.includes('-->')&&!/^\d+$/.test(s)));
const serialize = cues => cues.map(c=>`${c.id}\n${c.timing}\n${c.body}`).join('\n\n')+'\n';
const normalized = serialize(normalizedCues);
assert.equal(normalized,read('TOS-CH.normalized.srt'));
// Controlled aligned copy: remove the additional intro and align cue 9's start.
// This is explicitly a test derivative, not the unmodified official translation.
const alignedCues = structuredClone(normalizedCues.slice(1));
assert.equal(alignedCues[8].timing,'00:00:43,000 --> 00:00:45,000');
alignedCues[8].timing='00:00:42,200 --> 00:00:45,000';
const aligned = serialize(alignedCues);
write('TOS-CH.aligned-control.srt',aligned);
const cases = [];
function run(name,target,check,options={toleranceMs:0}) {
  const r=C.analyze(source,target,options); check(r);
  cases.push({name,passed:true,summary:r.summary,issues:r.issues.map(i=>({code:i.code,sourceId:i.sourceCue?.id??null,targetId:i.targetCue?.id??null}))});
  return r;
}
const ids=(r,code,side)=>r.issues.filter(i=>i.code===code).map(i=>i[side+'Cue'].id);
run('unmodified_official_files_reject_bad_structure',original,r=>{
  assert(r.summary.errors>0); assert(r.issues.some(i=>i.code==='BAD_TIME_FORMAT'));
});
run('normalized_translation_preserves_real_timing_differences',normalized,r=>{
  assert.equal(r.summary.matched,75); assert.equal(r.summary.errors,0);
  assert.deepEqual(ids(r,'UNMATCHED_SOURCE','source'),['9']);
  assert.deepEqual(ids(r,'UNMATCHED_TARGET','target'),['0','9']);
});
run('aligned_bilingual_control',aligned,r=>{
  assert.equal(r.summary.matched,76); assert.equal(r.issues.length,0);
});
const deleted=alignedCues.filter(c=>c.id!=='20').map((c,i)=>({...c,id:String(i+1)}));
run('delete_cue_20_then_renumber',serialize(deleted),r=>{
  assert.equal(r.summary.matched,75); assert.equal(r.summary.unmatchedTarget,0);
  assert.deepEqual(ids(r,'UNMATCHED_SOURCE','source'),['20']);
  assert(r.pairs.some(p=>p.sourceCue.id==='21'&&p.targetCue.id==='20'));
});
const shifted=structuredClone(alignedCues);
const shiftTime=t=>{const [h,m,s,ms]=t.split(/[:,]/).map(Number);return C.formatTime(((h*60+m)*60+s)*1000+ms+500);};
shifted[39].timing=shifted[39].timing.split(' --> ').map(shiftTime).join(' --> ');
run('shift_cue_40_by_500ms',serialize(shifted),r=>{
  assert.equal(r.summary.matched,75);
  assert.deepEqual(ids(r,'UNMATCHED_SOURCE','source'),['40']);
  assert.deepEqual(ids(r,'UNMATCHED_TARGET','target'),['40']);
});
const empty=structuredClone(alignedCues); empty[59].body='';
run('empty_body_cue_60',serialize(empty),r=>{
  assert.equal(r.summary.matched,76); assert.equal(r.summary.errors,1);
  assert.deepEqual(ids(r,'EMPTY_TEXT','target'),['60']);
});
const combined=shifted.filter(c=>c.id!=='20').map(c=>({...c,body:c.id==='60'?'':c.body}));
const combinedText=serialize(combined);
write('TOS-CH.controlled-problems.srt',combinedText);
run('combined_three_known_changes',combinedText,r=>{
  assert.equal(r.summary.matched,74); assert.equal(r.summary.errors,1);
  assert.deepEqual(ids(r,'UNMATCHED_SOURCE','source'),['20','40']);
  assert.deepEqual(ids(r,'UNMATCHED_TARGET','target'),['40']);
  assert.deepEqual(ids(r,'EMPTY_TEXT','target'),['60']);
});
const semantic=structuredClone(alignedCues); semantic[29].body='这句话故意与原意无关，用于验证结构检查的边界。';
run('semantic_change_is_outside_scope',serialize(semantic),r=>{
  assert.equal(r.summary.matched,76); assert.equal(r.issues.length,0);
});
write('results.json',JSON.stringify({validatedOn:'2026-10-25',timezone:'Asia/Hong_Kong',hashes,cases},null,2)+'\n');
console.log(JSON.stringify({passed:cases.length,failed:0,cases:cases.map(c=>({name:c.name,...c.summary}))},null,2));
