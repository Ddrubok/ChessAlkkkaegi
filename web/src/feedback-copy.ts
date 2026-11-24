import { I18nManager } from "./i18n";

export function feedbackCopy() {
  const copy = (key: string, params?: Record<string, string | number>) => I18nManager.t(`feedback.${key}`, params);
  return {
    practice: copy("practice"), practiceTitle: copy("practiceTitle"), practiceGoal: copy("practiceGoal"),
    practiceGuide: copy("practiceGuide"), practiceSuccess: copy("practiceSuccess"),
    practiceRetry: copy("practiceRetry"), practiceExit: copy("practiceExit"), menu: copy("menu"),
    firstSuccess: copy("firstSuccess"), firstNext: copy("firstNext"), startStage: copy("startStage"),
    practiceMiss: (value: number) => copy("practiceMiss", { value }), practiceNoReward: copy("practiceNoReward"),
    onlineMember: copy("onlineMember"), onlineGuest: copy("onlineGuest"), friendGuide: copy("friendGuide"),
    guestOnlineStatus: copy("guestOnlineStatus"), onlineSiteLogin: copy("onlineSiteLogin"),
    searchingEmpty: (mode: string) => copy("searchingEmpty", { mode }), separateQueues: copy("separateQueues"),
    breakableWall: copy("breakableWall"), pocketWall: copy("pocketWall"), stageOpening: copy("stageOpening"),
    rookChoice: copy("rookChoice"), knightChoice: copy("knightChoice"),
  };
}
