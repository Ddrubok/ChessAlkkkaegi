import { I18nManager, type LanguageCode } from './i18n';
type Copy = { title: string; label: string; description: string; system: string };
const copies: Record<LanguageCode, Copy> = {
 ko: {title:'화면 효과',label:'연출 최소화',description:'메뉴·결과·발사 장식 효과를 줄입니다. 게임 진행과 조작은 그대로 유지됩니다.',system:'운영체제의 동작 줄이기도 항상 적용됩니다.'},
 en: {title:'Visual effects',label:'Reduce motion',description:'Reduce menu, result and launch effects. Gameplay and controls stay the same.',system:'Your operating system’s reduced-motion preference always applies.'},
 ja: {title:'画面効果',label:'演出を最小化',description:'メニュー・結果・発射の演出を減らします。ゲーム進行と操作は変わりません。',system:'OSの視差効果を減らす設定も常に適用されます。'},
 'zh-CN': {title:'画面效果',label:'减少动态效果',description:'减少菜单、结果和发射的装饰效果，不改变游戏进程和操作。',system:'始终遵循操作系统的减少动态效果设置。'},
 ru: {title:'Визуальные эффекты',label:'Уменьшить движение',description:'Меньше эффектов меню, результатов и выстрелов. Игра и управление не меняются.',system:'Системная настройка уменьшения движения применяется всегда.'},
 es: {title:'Efectos visuales',label:'Reducir movimiento',description:'Reduce efectos de menús, resultados y lanzamientos, sin cambiar el juego ni los controles.',system:'Siempre se respeta la preferencia de movimiento reducido del sistema.'},
 fr: {title:'Effets visuels',label:'Réduire les animations',description:'Réduit les effets des menus, résultats et tirs, sans modifier le jeu ni les commandes.',system:'Le réglage de réduction des animations du système reste prioritaire.'},
 de: {title:'Bildeffekte',label:'Bewegung reduzieren',description:'Reduziert Menü-, Ergebnis- und Schusseffekte. Spielablauf und Steuerung bleiben gleich.',system:'Die Systemeinstellung für reduzierte Bewegung wird immer berücksichtigt.'},
 'pt-BR': {title:'Efeitos visuais',label:'Reduzir movimento',description:'Reduz efeitos de menus, resultados e lançamentos, sem alterar o jogo ou os controles.',system:'A preferência de movimento reduzido do sistema é sempre respeitada.'},
};
export const motionCopy = (): Copy => copies[I18nManager.currentLang] ?? copies.en;
