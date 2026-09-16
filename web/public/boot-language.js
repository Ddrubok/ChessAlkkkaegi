(() => {
  const languages = ['ko','en','ja','zh-CN','de','fr','es','ru','pt-BR'];
  const labels = {
    ko: ['체스알까기','체스 말을 조준해 상대 말을 보드 밖으로 밀어내는 물리 대전 게임입니다.','게임 소개','조작법과 규칙','티어 안내','불러오는 중입니다'],
    en: ['Chess Alkkagi','Aim and launch chess pieces to knock opponents off the board.','About','Controls and rules','Tiers','Loading…'],
    ja: ['チェスアルカギ','チェスの駒を狙って発射し、相手の駒を盤外に押し出す物理対戦ゲームです。','ゲーム紹介','操作とルール','ティア案内','読み込み中…'],
    'zh-CN': ['弹射国际象棋','瞄准并弹射棋子，将对方棋子击出棋盘的物理对战游戏。','游戏介绍','操作与规则','段位说明','正在加载…'],
    de: ['Schach Alkkagi','Ziele und schleudere Schachfiguren, um Gegner vom Brett zu stoßen.','Über das Spiel','Steuerung und Regeln','Ränge','Wird geladen…'],
    fr: ['Échecs Alkkagi','Visez et lancez vos pièces pour éjecter les pièces adverses du plateau.','Présentation','Commandes et règles','Rangs','Chargement…'],
    es: ['Ajedrez Alkkagi','Apunta y lanza piezas para expulsar las del rival del tablero.','Acerca del juego','Controles y reglas','Rangos','Cargando…'],
    ru: ['Шахматы Алккаги','Прицельтесь и запустите фигуры, чтобы вытолкнуть соперника за край доски.','Об игре','Управление и правила','Ранги','Загрузка…'],
    'pt-BR': ['Xadrez Alkkagi','Mire e lance peças para tirar as peças adversárias do tabuleiro.','Sobre o jogo','Controles e regras','Patentes','Carregando…'],
  };
  let saved; try { saved = localStorage.getItem('app_language'); } catch {}
  const match = raw => { const base=raw.toLowerCase().split('-')[0];return base==='zh'?'zh-CN':base==='pt'?'pt-BR':languages.find(l=>l===base); };
  const lang=labels[saved]?saved:(navigator.languages||[navigator.language]).map(match).find(Boolean)||'en';
  const text=labels[lang], card=document.querySelector('.boot-loading-card');if(!card)return;
  document.documentElement.lang=lang;card.querySelector('h1').textContent=text[0];card.querySelector('p').textContent=text[1];
  card.querySelectorAll('nav a').forEach((a,i)=>a.textContent=text[i+2]);card.querySelector('nav').setAttribute('aria-label',text[3]);document.querySelector('#boot-loading-phase').textContent=text[5];
})();
