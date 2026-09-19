import { I18nManager, type LanguageCode } from "./i18n";

export interface InputCancelDict {
  cancelTitle: string;
  cancelHintDesktop: string;
  cancelHintMobile: string;
  cancelZoneText: string;
}

const CANCEL_DICTS: Record<LanguageCode, InputCancelDict> = {
  ko: {
    cancelTitle: "발사 취소",
    cancelHintDesktop: "ESC 또는 우클릭으로 취소",
    cancelHintMobile: "여기로 드래그하거나 두 번째 터치로 취소",
    cancelZoneText: "발사 취소",
  },
  en: {
    cancelTitle: "Cancel Shot",
    cancelHintDesktop: "Press ESC or right-click to cancel",
    cancelHintMobile: "Drag here or tap with 2nd finger to cancel",
    cancelZoneText: "Cancel Shot",
  },
  ja: {
    cancelTitle: "発射キャンセル",
    cancelHintDesktop: "ESCまたは右クリックでキャンセル",
    cancelHintMobile: "ここへドラッグまたは2本指タップでキャンセル",
    cancelZoneText: "発射キャンセル",
  },
  "zh-CN": {
    cancelTitle: "取消发射",
    cancelHintDesktop: "按 ESC 或右键取消",
    cancelHintMobile: "拖动至此处或双指轻点取消",
    cancelZoneText: "取消发射",
  },
  de: {
    cancelTitle: "Schuss abbrechen",
    cancelHintDesktop: "ESC oder Rechtsklick zum Abbrechen",
    cancelHintMobile: "Hierher ziehen oder mit 2. Finger tippen zum Abbrechen",
    cancelZoneText: "Schuss abbrechen",
  },
  fr: {
    cancelTitle: "Annuler le tir",
    cancelHintDesktop: "Appuyez sur Échap ou clic droit pour annuler",
    cancelHintMobile: "Glissez ici ou touchez avec un 2e doigt pour annuler",
    cancelZoneText: "Annuler le tir",
  },
  es: {
    cancelTitle: "Cancelar disparo",
    cancelHintDesktop: "Presiona ESC o clic derecho para cancelar",
    cancelHintMobile: "Arrastra aquí o toca con un 2.º dedo para cancelar",
    cancelZoneText: "Cancelar disparo",
  },
  ru: {
    cancelTitle: "Отмена выстрела",
    cancelHintDesktop: "Нажмите ESC или ПКМ для отмены",
    cancelHintMobile: "Перетащите сюда или коснитесь 2-м пальцем для отмены",
    cancelZoneText: "Отмена выстрела",
  },
  "pt-BR": {
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
