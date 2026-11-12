import { I18nManager } from "./i18n";

export function feedbackCopy() {
  return I18nManager.getLanguage() === "ko" ? {
    practice: "약한 샷 연습", practiceTitle: "파워 조절 연습", practiceGoal: "30~50% 세기로 한 번 발사해 보세요. 장외시킬 필요는 없습니다.",
    practiceGuide: "조금만 당기면 약한 샷입니다. 말 쪽으로 되돌리면 세기가 줄어듭니다.",
    practiceSuccess: "원하는 세기로 발사했습니다!", practiceRetry: "다시 연습", practiceExit: "연습 끝내기", menu: "메뉴로",
    firstSuccess: "첫 샷 성공!", firstNext: "다음은 폰 3개로 시작하는 1단계입니다. 약한 샷도 연습할 수 있습니다.", startStage: "1단계 시작",
    practiceMiss: (value: number) => `이번 세기 ${value}%. 조금 조절해서 30~50%로 다시 해보세요.`,
    practiceNoReward: "자유 연습 · 진행과 보상에 영향을 주지 않습니다.",
    onlineMember: "상대 찾기: 클래식 또는 전략을 선택하세요. 같은 모드에서 검색하는 이용자끼리 연결됩니다. 친구와 하려면 초대 코드를 이용하세요.",
    onlineGuest: "친구와 대전: 방 코드를 만들거나 입력하세요. 무작위 상대를 찾으려면 게임 안에서 로그인하세요.",
    friendGuide: "한 명이 방을 만들어 코드를 공유하고, 다른 한 명이 코드를 입력하세요. 자동으로 상대를 찾는 기능과는 다릅니다.",
    guestOnlineStatus: "친구 방 코드 · 로그인하면 상대 찾기",
    onlineSiteLogin: "itch.io 사이트 로그인 후에도 게임 안에서 계정 연결이 필요할 수 있습니다.",
    searchingEmpty: (mode: string) => `지금 ${mode}에서 검색하는 다른 이용자가 없습니다. 기다리거나 취소 후 친구를 초대할 수 있습니다.`,
    separateQueues: "클래식과 전략은 서로 다른 매칭 대기열입니다.",
    breakableWall: "이 벽은 새 접촉이 두 번 발생하면 부서집니다. 첫 접촉 후 균열이 생깁니다. 낮은 벽은 뛰어넘을 수 있습니다.",
    pocketWall: "이 단계의 벽은 부서지지 않습니다. 모서리 출구를 이용하세요.",
    stageOpening: "내 폰 3개 · 상대 폰 3개. 한 발 제한이 아닙니다. 약하게 쏘며 위치를 잡아도 됩니다.",
  } : {
    practice: "Practice a softer shot", practiceTitle: "Power control practice", practiceGoal: "Release one shot at 30–50% power. You do not need a knockout.",
    practiceGuide: "Pull a little for a softer shot. Move back toward the piece to reduce power.",
    practiceSuccess: "You released a controlled shot!", practiceRetry: "Practice again", practiceExit: "Finish practice", menu: "Main menu",
    firstSuccess: "First flick complete!", firstNext: "Stage 1 starts with three pawns on each side. You can also practice a softer shot first.", startStage: "Start Stage 1",
    practiceMiss: (value: number) => `That shot was ${value}%. Adjust your pull and try 30–50% again.`,
    practiceNoReward: "Free practice · does not change progress or rewards.",
    onlineMember: "Find an opponent: choose Classic or Strategy. Players searching in the same mode can match. Use an invite code to play with a friend.",
    onlineGuest: "Play with a friend: create or enter a room code. Sign in inside the game to find a random opponent.",
    friendGuide: "One player creates a room and shares its code; the other enters it. Room codes connect friends, not random opponents.",
    guestOnlineStatus: "Friend room codes · sign in for matchmaking",
    onlineSiteLogin: "Signing in to the itch.io website may still require linking your account inside the game.",
    searchingEmpty: (mode: string) => `No other players are searching in ${mode} right now. You can keep waiting or cancel and invite a friend.`,
    separateQueues: "Classic and Strategy use separate matchmaking queues.",
    breakableWall: "These walls break after two new contacts. The first contact leaves a crack. Low walls can be jumped over.",
    pocketWall: "These walls do not break. Use the corner exits.",
    stageOpening: "Three pawns on each side. This is not a one-shot challenge. Softer shots can help you position your pieces.",
  };
}

export const isPracticePower = (power: number): boolean => Number.isFinite(power) && power >= 0.3 - 1e-9 && power <= 0.5 + 1e-9;
