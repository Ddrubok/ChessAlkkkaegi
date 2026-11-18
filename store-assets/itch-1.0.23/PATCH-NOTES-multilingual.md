# Chess Alkkagi 1.0.23 — itch patch notes

These notes describe the 1.0.23 HTML release candidate; publication is recorded separately.

## 한국어

- 온라인 대국에서 양쪽 판이 달라졌을 때, 권위 상태에 있는 누락된 기물을 복원하도록 개선했습니다.
- 복구 후 차례와 승패 처리를 바로잡고, 이전 대국이나 차례의 오래된 복구 메시지가 현재 대국에 적용되지 않도록 했습니다.
- 동기화를 복구할 수 없으면 대국을 종료하고 다음에 할 일을 화면에 안내합니다.

## English

- Improved online recovery so missing pieces can be restored from the authoritative board when players' boards differ.
- Corrected turn and result handling after recovery, and rejected stale recovery messages from an earlier match or turn.
- If synchronization cannot recover, the match ends with guidance on what to do next.

## 日本語

- オンライン対局で双方の盤面が食い違ったとき、基準となる盤面にある欠けた駒を復元するよう改善しました。
- 復旧後の手番と勝敗の処理を修正し、以前の対局や手番の古い復旧メッセージが現在の対局に適用されないようにしました。
- 同期を復旧できない場合は対局を終了し、次に行う操作を画面で案内します。

## Français

- La récupération en ligne peut restaurer les pièces manquantes depuis le plateau de référence lorsque les plateaux des joueurs divergent.
- Le tour et le résultat sont mieux gérés après récupération ; les anciens messages d'une autre partie ou d'un autre tour sont écartés.
- Si la synchronisation ne peut pas être rétablie, la partie se termine et le jeu indique la marche à suivre.
