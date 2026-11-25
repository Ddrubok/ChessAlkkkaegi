import { I18nManager, type LanguageCode } from "./i18n";

type Reason = "loss" | "forfeit";
const copy: Record<LanguageCode, Record<Reason, string>> = {
  ko: { loss: "스테이지 {stage} 패배", forfeit: "직접 종료한 도전" },
  en: { loss: "Stage {stage} lost", forfeit: "Run ended by you" },
  ja: { loss: "ステージ {stage} 敗北", forfeit: "自分で終了した挑戦" },
  "zh-CN": { loss: "第 {stage} 关失败", forfeit: "你已结束本次挑战" },
  de: { loss: "Stufe {stage} verloren", forfeit: "Durchlauf von dir beendet" },
  fr: { loss: "Étape {stage} perdue", forfeit: "Partie terminée par vous" },
  es: { loss: "Etapa {stage} perdida", forfeit: "Partida terminada por ti" },
  ru: { loss: "Этап {stage} проигран", forfeit: "Вы завершили попытку" },
  "pt-BR": { loss: "Fase {stage} perdida", forfeit: "Partida encerrada por você" },
};

export function stageResultReason(reason: Reason, stage: number): string {
  return (copy[I18nManager.getLanguage()] ?? copy.en)[reason].replace("{stage}", String(stage));
}
