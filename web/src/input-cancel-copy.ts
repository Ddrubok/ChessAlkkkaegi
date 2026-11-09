import { I18nManager, type LanguageCode } from "./i18n";

export interface InputCancelDict {
  cancelTitle: string;
  cancelHintDesktop: string;
  cancelHintMobile: string;
  cancelZoneText: string;
  outsideHint: string;
  cancelledOutside: string;
}

const CANCEL_DICTS: Record<LanguageCode, InputCancelDict> = {
  ko: {
    outsideHint: "판 밖에서 놓으면 취소됩니다. 판 안으로 돌아오세요.",
    cancelledOutside: "판 밖에서 놓아 발사가 취소되었습니다.",
    cancelTitle: "발사 취소",
    cancelHintDesktop: "ESC 또는 우클릭으로 취소",
    cancelHintMobile: "여기로 드래그하거나 두 번째 터치로 취소",
    cancelZoneText: "발사 취소",
  },
  en: {
    outsideHint: "Release here to cancel. Move back onto the board to shoot.",
    cancelledOutside: "Shot cancelled: released outside the board.",
    cancelTitle: "Cancel Shot",
    cancelHintDesktop: "Press ESC or right-click to cancel",
    cancelHintMobile: "Drag here or tap with 2nd finger to cancel",
    cancelZoneText: "Cancel Shot",
  },
  ja: {
    outsideHint: "ここで離すとキャンセルします。盤上に戻すと発射できます。",
    cancelledOutside: "盤外で離したため発射をキャンセルしました。",
    cancelTitle: "発射キャンセル",
    cancelHintDesktop: "ESCまたは右クリックでキャンセル",
    cancelHintMobile: "ここへドラッグまたは2本指タップでキャンセル",
    cancelZoneText: "発射キャンセル",
  },
  "zh-CN": {
    outsideHint: "在此松开将取消。移回棋盘内即可发射。",
    cancelledOutside: "已取消发射：在棋盘外松开。",
    cancelTitle: "取消发射",
    cancelHintDesktop: "按 ESC 或右键取消",
    cancelHintMobile: "拖动至此处或双指轻点取消",
    cancelZoneText: "取消发射",
  },
  de: {
    outsideHint: "Hier loslassen zum Abbrechen. Zum Schießen zurück aufs Brett ziehen.",
    cancelledOutside: "Schuss abgebrochen: außerhalb des Bretts losgelassen.",
    cancelTitle: "Schuss abbrechen",
    cancelHintDesktop: "ESC oder Rechtsklick zum Abbrechen",
    cancelHintMobile: "Hierher ziehen oder mit 2. Finger tippen zum Abbrechen",
    cancelZoneText: "Schuss abbrechen",
  },
  fr: {
    outsideHint: "Relâchez ici pour annuler. Revenez sur le plateau pour tirer.",
    cancelledOutside: "Tir annulé : relâchement hors du plateau.",
    cancelTitle: "Annuler le tir",
    cancelHintDesktop: "Appuyez sur Échap ou clic droit pour annuler",
    cancelHintMobile: "Glissez ici ou touchez avec un 2e doigt pour annuler",
    cancelZoneText: "Annuler le tir",
  },
  es: {
    outsideHint: "Suelta aquí para cancelar. Vuelve al tablero para disparar.",
    cancelledOutside: "Disparo cancelado: soltaste fuera del tablero.",
    cancelTitle: "Cancelar disparo",
    cancelHintDesktop: "Presiona ESC o clic derecho para cancelar",
    cancelHintMobile: "Arrastra aquí o toca con un 2.º dedo para cancelar",
    cancelZoneText: "Cancelar disparo",
  },
  ru: {
    outsideHint: "Отпустите здесь для отмены. Вернитесь на доску, чтобы выстрелить.",
    cancelledOutside: "Выстрел отменён: отпускание за пределами доски.",
    cancelTitle: "Отмена выстрела",
    cancelHintDesktop: "Нажмите ESC или ПКМ для отмены",
    cancelHintMobile: "Перетащите сюда или коснитесь 2-м пальцем для отмены",
    cancelZoneText: "Отмена выстрела",
  },
  "pt-BR": {
    outsideHint: "Solte aqui para cancelar. Volte ao tabuleiro para disparar.",
    cancelledOutside: "Disparo cancelado: soltou fora do tabuleiro.",
    cancelTitle: "Cancelar disparo",
    cancelHintDesktop: "Pressione ESC ou clique com o botão direito para cancelar",
    cancelHintMobile: "Arraste para cá ou toque com o 2º dedo para cancelar",
    cancelZoneText: "Cancelar disparo",
  },
};

export function inputCancelCopy(language?: LanguageCode): InputCancelDict {
  const lang = language || I18nManager.getLanguage?.() || "ko";
  return CANCEL_DICTS[lang] || CANCEL_DICTS["ko"];
}
