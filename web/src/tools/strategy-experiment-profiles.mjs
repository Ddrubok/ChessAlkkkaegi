// Developer-only variants. Ordinary Vite/build entry points never import this plugin.
export const EXPERIMENT_PROFILES = Object.freeze([
  { id:'baseline', label:'현행', description:'공개 기본값', groundSpeed:11, pawnPower:1 },
  { id:'e01-9', label:'지상 속도 9', description:'나이트를 제외한 지상 기물 속도 9', groundSpeed:9, pawnPower:1 },
  { id:'e01-8', label:'지상 속도 8', description:'나이트를 제외한 지상 기물 속도 8', groundSpeed:8, pawnPower:1 },
  { id:'e02-085', label:'폰 배율 0.85', description:'기준 속도에서 폰만 0.85', groundSpeed:11, pawnPower:.85 },
  { id:'e02-070', label:'폰 배율 0.70', description:'기준 속도에서 폰만 0.70', groundSpeed:11, pawnPower:.70 },
  { id:'e04-rook', label:'룩 초과 위력 축소', description:'룩의 100% 초과분만 절반, 150% 입력은 125% 속도', groundSpeed:11, pawnPower:1, overdriveType:'Rook', overdriveScale:.5 },
  { id:'e04-queen', label:'퀸 초과 위력 축소', description:'퀸의 100% 초과분만 절반, 150% 입력은 125% 속도', groundSpeed:11, pawnPower:1, overdriveType:'Queen', overdriveScale:.5 },
  { id:'e05-bishop', label:'비숍 대각선', description:'비숍 보드 대각선 ±12도에서 속도 +10%', groundSpeed:11, pawnPower:1, bishopDiagonalBonus:1.1 },
]);
function replaceOnce(source, anchor, replacement) {
  if (!source.includes(anchor) || source.indexOf(anchor) !== source.lastIndexOf(anchor)) throw Error('Strategy experiment anchor missing or ambiguous');
  return source.replace(anchor, replacement);
}
export function experimentPlugin(profileId) {
  const p=EXPERIMENT_PROFILES.find(p=>p.id===profileId);
  if (!p) throw Error('Unknown strategy experiment profile: '+profileId);
  let enabled=false, transformed=false;
  return {
    name:'strategy-experiment-'+profileId, enforce:'pre',
    configResolved(config) {
      if (config.mode!=='itch') throw Error('Strategy experiment requires explicit Vite mode itch');
      enabled=true;
    },
    transform(source,id) {
      if (!enabled) return null;
      const file=id.replaceAll('\\','/');
      if (file.endsWith('/src/config.ts')) {
        transformed=true;
        return {code:replaceOnce(source,'  return baseSpeed * getPiecePowerMultiplier(pieceType);',
          '  const trialGround = gameMode === "stage" && pieceType !== "Knight" ? '+(p.groundSpeed/11)+' : 1;\n'+
          '  const trialPawn = gameMode === "stage" && pieceType === "Pawn" ? '+p.pawnPower+' : 1;\n'+
          '  return baseSpeed * trialGround * trialPawn * getPiecePowerMultiplier(pieceType);'),map:null};
      }
      if (!file.endsWith('/src/launch.ts')) return null;
      const anchor=/  const targetSpeed = effectivePower \* getMaxLaunchSpeed\(gameMode, pieceType, maxLaunchSpeed\)\r?\n    \* speedMultiplier \* controlMultiplier;/;
      if (!anchor.test(source)) throw Error('Strategy experiment launch anchor missing');
      const variant='  const trialPower = gameMode === "stage" && pieceType === '+JSON.stringify(p.overdriveType??'')+
        ' ? Math.min(effectivePower, 1) + Math.max(0, effectivePower - 1) * '+(p.overdriveScale??1)+' : effectivePower;\n'+
        '  const trialDiagonal = gameMode === "stage" && pieceType === "Bishop" && Math.abs(Math.atan2(Math.abs(direction.z), Math.abs(direction.x)) - Math.PI/4) <= (12 + 1e-9) * Math.PI/180;\n'+
        '  const targetSpeed = trialPower * getMaxLaunchSpeed(gameMode, pieceType, maxLaunchSpeed) * speedMultiplier * controlMultiplier * (trialDiagonal ? '+(p.bishopDiagonalBonus??1)+' : 1);';
      transformed=true;
      return {code:source.replace(anchor,variant),map:null};
    },
    getExperimentStatus(){return {profileId,enabled,transformed};},
  };
}
