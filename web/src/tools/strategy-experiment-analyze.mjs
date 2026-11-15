import { readFile, writeFile } from 'node:fs/promises';
const base=new URL('../../../qa/strategy-experiments-2026-11-15/physics/',import.meta.url);
const result=JSON.parse(await readFile(new URL('results.json',base),'utf8'));
const main=result.trials.filter(r=>r.repeat==='main');
const baseline=main.filter(r=>r.profileId==='baseline');
const safe=r=>r.enemyOutSelfSurvival&&!r.forced&&!r.unsettled;
const key=r=>r.fixtureId+'/'+r.role;
const summary=[];
for(const id of result.profiles){
  const rows=main.filter(r=>r.profileId===id), groups=[...new Set(rows.map(key))];
  const lostContact=groups.filter(k=>baseline.some(r=>key(r)===k&&r.enemyContact)&&!rows.some(r=>key(r)===k&&r.enemyContact));
  const mid=rows.filter(r=>r.power<=.6), baseMid=baseline.filter(r=>r.power<=.6);
  const changedMid=mid.filter(r=>safe(r)&&!safe(baseMid.find(b=>key(b)===key(r)&&b.power===r.power)));
  const lostMid=baseMid.filter(r=>safe(r)&&!safe(mid.find(b=>key(b)===key(r)&&b.power===r.power)));
  summary.push({id,shots:rows.length,contact:rows.filter(r=>r.enemyContact).length,
    safeMid:mid.filter(safe).length,safeAll:rows.filter(safe).length,selfOut:rows.filter(r=>r.selfOut).length,
    forced:rows.filter(r=>r.forced).length,unsettled:rows.filter(r=>r.unsettled).length,
    gainedMid:changedMid.map(r=>key(r)+'/'+r.power),lostMid:lostMid.map(r=>key(r)+'/'+r.power),lostContact,
    dispersedChain:rows.filter(r=>r.fixtureId==='dispersed'&&r.enemyOut>=3).map(r=>({role:r.role,power:r.power,enemyOut:r.enemyOut,selfOut:r.selfOut})),
    clusterChain:rows.filter(r=>r.fixtureId==='cluster'&&r.enemyOut>=3).map(r=>({role:r.role,power:r.power,enemyOut:r.enemyOut,selfOut:r.selfOut})),
    roles:[...new Set(rows.map(r=>r.role))].map(role=>({role,contact:rows.filter(r=>r.role===role&&r.enemyContact).length,safe:rows.filter(r=>r.role===role&&safe(r)).length,selfOut:rows.filter(r=>r.role===role&&r.selfOut).length})),
  });
}
const sensitivity=baseline.length?result.trials.filter(r=>r.profileId==='baseline'&&r.repeat!=='main').map(r=>{
  const b=baseline.find(b=>key(b)===key(r)&&b.power===r.power);
  return {fixtureId:r.fixtureId,role:r.role,repeat:r.repeat,changedOutcome:r.selfOut!==b.selfOut||r.enemyOut!==b.enemyOut||r.forced!==b.forced,
    selfOut:r.selfOut,enemyOut:r.enemyOut,forced:r.forced};
}):[];
await writeFile(new URL('analysis.json',base),JSON.stringify({summary,sensitivity},null,2));
const lines=['# 2차 실험 비교 결과','','강제/미정착은 안전 성공에서 제외. 수치는 고정 샷 표본이며 사람 승률이 아니다.','',
  '| 프로필 | 샷 | 적 접촉 | 중간 세기 안전 장외 | 전체 안전 장외 | 자기 장외 | 강제 정착 | 접촉 경로 소실 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const s of summary)lines.push('| '+[s.id,s.shots,s.contact,s.safeMid,s.safeAll,s.selfOut,s.forced,s.lostContact.length].join(' | ')+' |');
for(const s of summary.slice(1))lines.push('','## '+s.id,'','중간 세기 이득: '+(s.gainedMid.join(', ')||'없음')+'.','',
  '중간 세기 손실: '+(s.lostMid.join(', ')||'없음')+'.','','시험한 30/60/100%(해당 기물 150% 포함)에서 직접 접촉을 잃은 조합: '+(s.lostContact.join(', ')||'없음')+'.');
lines.push('','## 판단','','기준 유지. e01-8 등은 QA 비교 대상으로 넘기되 공개 채택하지 않는다. 도달 손실과 입력 민감도, 실제 플레이의 선택 이유를 별도로 확인한다. E03은 분산/군집 결과로 원인을 확정하지 못해 반발·감쇠 변경을 보류한다.','',
  '반복 표본 결과 변화: '+sensitivity.filter(r=>r.changedOutcome&&r.repeat==='T05-repeat').length+
  '건. 각도 ±1도 결과 변화: '+sensitivity.filter(r=>r.changedOutcome&&r.repeat.startsWith('T05d')).length+
  '건. 파워 ±1%p 결과 변화: '+sensitivity.filter(r=>r.changedOutcome&&r.repeat.startsWith('T05e')).length+'건. 위치·회전의 수치 변화와 승패/장외 변화는 구별해야 한다.');
await writeFile(new URL('ANALYSIS-ko.md',base),lines.join('\n'));
console.log(JSON.stringify(summary.map(({id,safeMid,forced,lostContact})=>({id,safeMid,forced,lostContact}))));
