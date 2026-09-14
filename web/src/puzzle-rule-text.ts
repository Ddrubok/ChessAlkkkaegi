import type { PuzzleDefinition, PuzzleRule } from "./puzzle";

interface RuleCopy {
  goal: (shots: number, targets: number) => string;
  alive: string;
  untouched: string;
  hole: string;
  wall: string;
  breakWall: string;
  breakWallFirst: string;
  custom: string;
  center: string;
  power: (percent: number) => string;
}

const COPY: Record<string, RuleCopy> = {
  ko: {
    goal: (shots, targets) => `${shots}발 이내에 목표 기물 ${targets}개를 모두 장외로 보내세요.`,
    alive: "생존 조건이 있는 아군 기물은 판 위에 남아야 합니다.",
    untouched: "보호 대상과는 접촉하지 마세요.",
    hole: "지정된 목표는 구멍으로 떨어뜨려야 합니다.",
    wall: "발사 기물이 목표에 처음 닿기 전에 벽에 먼저 닿아야 합니다.",
    breakWall: "파괴 가능한 벽을 부숴야 합니다.",
    breakWallFirst: "목표가 장외로 떨어지기 전에 파괴 가능한 벽을 먼저 부숴야 합니다.",
    custom: "중앙에서 벗어난 타점을 한 번 이상 사용하세요.",
    center: "룩의 중앙 타점으로 발사하세요.",
    power: (percent) => `룩의 발사 세기는 ${percent}% 이하여야 합니다.`,
  },
  en: {
    goal: (shots, targets) => `Knock ${targets === 1 ? "the target piece" : `all ${targets} target pieces`} off the board within ${shots} ${shots === 1 ? "shot" : "shots"}.`,
    alive: "All allied pieces required to survive must remain on the board.",
    untouched: "Do not touch the protected pieces.",
    hole: "The designated targets must fall through a hole.",
    wall: "The launched piece must touch a wall before its first contact with the target.",
    breakWall: "Destroy a breakable wall.",
    breakWallFirst: "Destroy a breakable wall before the target falls off the board.",
    custom: "Use an off-center strike point at least once.",
    center: "Launch the rook with a central strike point.",
    power: (percent) => `Rook shot power must be ${percent}% or less.`,
  },
  ja: {
    goal: (shots, targets) => `${shots}回以内の発射で、目標の駒${targets}個をすべて盤外に落としてください。`,
    alive: "生存条件のある味方の駒を盤上に残してください。",
    untouched: "保護対象の駒には接触しないでください。",
    hole: "指定された目標を穴に落としてください。",
    wall: "発射した駒が目標に初めて触れる前に、壁に触れる必要があります。",
    breakWall: "破壊可能な壁を壊してください。",
    breakWallFirst: "目標が盤外に落ちる前に、破壊可能な壁を壊してください。",
    custom: "中心から外れた打点を1回以上使ってください。",
    center: "ルークを中央の打点で発射してください。",
    power: (percent) => `ルークの発射パワーは${percent}%以下にしてください。`,
  },
  zh: {
    goal: (shots, targets) => `在${shots}次发射内，将全部${targets}个目标棋子击出棋盘。`,
    alive: "有存活要求的己方棋子必须留在棋盘上。",
    untouched: "不要接触受保护的棋子。",
    hole: "指定目标必须落入洞中。",
    wall: "发射的棋子必须先碰墙，再首次接触目标。",
    breakWall: "摧毁可破坏的墙壁。",
    breakWallFirst: "必须先摧毁可破坏的墙壁，再让目标落出棋盘。",
    custom: "至少使用一次偏离中心的击打点。",
    center: "使用中央击打点发射车。",
    power: (percent) => `车的发射力度不得超过${percent}%。`,
  },
  de: {
    goal: (shots, targets) => `Stoße ${targets === 1 ? "die Zielfigur" : `alle ${targets} Zielfiguren`} mit höchstens ${shots === 1 ? "einem Schuss" : `${shots} Schüssen`} vom Brett.`,
    alive: "Verbündete Figuren mit Überlebensbedingung müssen auf dem Brett bleiben.",
    untouched: "Berühre keine geschützten Figuren.",
    hole: "Die festgelegten Ziele müssen durch ein Loch fallen.",
    wall: "Die geschossene Figur muss vor ihrem ersten Zielkontakt eine Wand berühren.",
    breakWall: "Zerstöre eine zerstörbare Wand.",
    breakWallFirst: "Zerstöre eine zerstörbare Wand, bevor das Ziel vom Brett fällt.",
    custom: "Nutze mindestens einmal einen außermittigen Treffpunkt.",
    center: "Schieße den Turm mit einem mittigen Treffpunkt.",
    power: (percent) => `Die Schussstärke des Turms darf höchstens ${percent}% betragen.`,
  },
  fr: {
    goal: (shots, targets) => `Éjectez ${targets === 1 ? "la pièce cible" : `les ${targets} pièces cibles`} en ${shots} ${shots === 1 ? "tir" : "tirs"} maximum.`,
    alive: "Les pièces alliées devant survivre doivent rester sur le plateau.",
    untouched: "Ne touchez pas les pièces protégées.",
    hole: "Les cibles désignées doivent tomber dans un trou.",
    wall: "La pièce lancée doit toucher un mur avant son premier contact avec la cible.",
    breakWall: "Détruisez un mur destructible.",
    breakWallFirst: "Détruisez un mur destructible avant que la cible tombe du plateau.",
    custom: "Utilisez au moins une fois un point de frappe décentré.",
    center: "Lancez la tour avec un point de frappe central.",
    power: (percent) => `La puissance du tir de la tour doit être de ${percent}% maximum.`,
  },
  es: {
    goal: (shots, targets) => `Expulsa ${targets === 1 ? "la pieza objetivo" : `las ${targets} piezas objetivo`} en un máximo de ${shots} ${shots === 1 ? "disparo" : "disparos"}.`,
    alive: "Las piezas aliadas que deben sobrevivir tienen que permanecer en el tablero.",
    untouched: "No toques las piezas protegidas.",
    hole: "Los objetivos indicados deben caer por un agujero.",
    wall: "La pieza lanzada debe tocar una pared antes de su primer contacto con el objetivo.",
    breakWall: "Destruye una pared destructible.",
    breakWallFirst: "Destruye una pared destructible antes de que el objetivo caiga del tablero.",
    custom: "Usa un punto de golpe descentrado al menos una vez.",
    center: "Lanza la torre con un punto de golpe central.",
    power: (percent) => `La potencia del disparo de la torre debe ser del ${percent}% o menos.`,
  },
  ru: {
    goal: (shots, targets) => `Выбейте ${targets === 1 ? "целевую фигуру" : `все ${targets} целевые фигуры`} не более чем за ${shots} ${shots === 1 ? "выстрел" : "выстрела"}.`,
    alive: "Союзные фигуры с условием выживания должны остаться на доске.",
    untouched: "Не касайтесь защищаемых фигур.",
    hole: "Указанные цели должны упасть в отверстие.",
    wall: "Запущенная фигура должна коснуться стены до первого контакта с целью.",
    breakWall: "Разрушьте разрушаемую стену.",
    breakWallFirst: "Разрушьте разрушаемую стену до того, как цель упадёт с доски.",
    custom: "Хотя бы один раз используйте смещённую от центра точку удара.",
    center: "Запустите ладью ударом по центру.",
    power: (percent) => `Сила выстрела ладьи должна быть не выше ${percent}%.`,
  },
  pt: {
    goal: (shots, targets) => `Retire ${targets === 1 ? "a peça-alvo" : `todas as ${targets} peças-alvo`} do tabuleiro em até ${shots} ${shots === 1 ? "disparo" : "disparos"}.`,
    alive: "As peças aliadas que precisam sobreviver devem permanecer no tabuleiro.",
    untouched: "Não toque nas peças protegidas.",
    hole: "Os alvos indicados devem cair em um buraco.",
    wall: "A peça lançada deve tocar uma parede antes do primeiro contato com o alvo.",
    breakWall: "Destrua uma parede destrutível.",
    breakWallFirst: "Destrua uma parede destrutível antes que o alvo caia do tabuleiro.",
    custom: "Use um ponto de impacto fora do centro pelo menos uma vez.",
    center: "Lance a torre com um ponto de impacto central.",
    power: (percent) => `A força do disparo da torre deve ser de no máximo ${percent}%.`,
  },
};

/** Numerical conditions come from the evaluator's rule, not duplicated UI copy. */
export function describePuzzleRule(puzzle: PuzzleDefinition, rule: PuzzleRule, language: string): string {
  const copy = COPY[language.toLowerCase().split(/[-_]/)[0]] ?? COPY.en;
  const parts = [copy.goal(rule.maxLaunches, rule.requiredFallIds.length)];
  if (rule.requiredAliveIds?.length || (rule === puzzle.required && puzzle.forbidden.fallIds.length)) parts.push(copy.alive);
  if (rule.forbiddenContactIds?.length || (rule === puzzle.required && puzzle.forbidden.contactIds.length)) parts.push(copy.untouched);
  if (rule.requiredHoleOutIds?.length) parts.push(copy.hole);
  if (rule.contactSequence) parts.push(copy.wall);
  if (rule.requiredWallDestroyedCounts && Object.values(rule.requiredWallDestroyedCounts).some((count) => count > 0)) parts.push(rule.wallDestructionBeforeFall ? copy.breakWallFirst : copy.breakWall);
  if (rule.requireCustomHit) parts.push(copy.custom);
  if (rule.rookShot?.requireCenterHit) parts.push(copy.center);
  if (rule.rookShot?.maxPower !== undefined) parts.push(copy.power(Math.round(rule.rookShot.maxPower * 100)));
  return parts.join(" ");
}
