# 1.0.22 patch notes — review draft

These notes describe the candidate build. They do not indicate that it has been uploaded or published.

## 한국어

- 일반 스테이지에서 패배하거나 비기면 현재 단계와 획득한 강화 카드를 유지하고 같은 단계를 다시 시작할 수 있습니다. 보드는 해당 단계의 시작 상태로 돌아갑니다.
- 메뉴로 나가면 도전이 보류됩니다. 별도로 도전 종료를 확인하면 통과한 단계의 보상 정산을 시도합니다.
- 승리 후 카드 선택과 다음 단계 준비 상태를 저장해, 새로고침 때 같은 선택지를 다시 뽑거나 카드를 중복 선택하지 않도록 했습니다.
- 저장 또는 정산 확인이 안 되면 완료로 표시하지 않고 대기 상태와 안내를 보여줍니다. 브라우저 저장이 불가능한 경우 현재 창에서만 계속 플레이할 수 있습니다.
- 나이트 AI의 장애물·착지 위치 예측과 약한 샷 선택을 개선했습니다. 나이트 궤적 안내도 실제 발사 계산에 더 가깝게 맞췄습니다.

## English

- In regular stages, a loss or draw now lets you retry the same stage with the upgrade cards earned in that run. The board resets to that stage's starting state.
- Returning to the menu pauses the run. Confirming End Run separately attempts to settle rewards for cleared stages.
- Card choices and next-stage preparation are saved so a reload does not redraw the choices or apply a card twice.
- If saving or settlement cannot be confirmed, the game shows a pending state instead of claiming completion. When browser storage is unavailable, play can continue in the current window only.
- Knight AI better estimates obstacles and landing positions and considers softer shots. The Knight trajectory guide more closely follows the launch calculation.

## 日本語

- 通常ステージで負けるか引き分けると、獲得した強化カードを保持して同じステージに再挑戦できます。盤面はそのステージの開始状態に戻ります。
- メニューに戻ると挑戦は一時停止します。別途「挑戦を終了」を確定すると、クリア済みステージの報酬精算を試みます。
- カードの選択肢と次のステージの準備状態を保存し、再読み込みで選択肢を引き直したりカードを二重適用したりしないようにしました。
- 保存や精算を確認できない場合、完了扱いにせず保留状態を表示します。ブラウザーの保存が使えない場合、現在のウィンドウ内ではプレイを続けられます。
- ナイトAIの障害物と着地点の予測、弱いショットの選択を改善しました。軌道ガイドも実際の発射計算により近づけました。

## Français

- Dans les étapes normales, une défaite ou une égalité permet de rejouer la même étape en conservant les cartes gagnées pendant la tentative. Le plateau revient à l'état initial de cette étape.
- Revenir au menu suspend la tentative. Confirmer séparément sa fin lance une tentative de validation des récompenses des étapes terminées.
- Les choix de cartes et la préparation de l'étape suivante sont enregistrés pour éviter un nouveau tirage ou une double application après rechargement.
- Si l'enregistrement ou la validation des récompenses ne peut pas être confirmé, le jeu affiche un état en attente. Si le stockage du navigateur est indisponible, la partie peut continuer dans la fenêtre actuelle seulement.
- L'IA du Cavalier estime mieux les obstacles et le point de chute et examine aussi les tirs faibles. Son guide de trajectoire suit mieux le calcul du tir réel.
