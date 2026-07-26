import { determineMatchWinner } from "../match.ts";

const cases = [
  {
    name: "흑의 마지막 말 낙하",
    remaining: { white: 1, black: 0 },
    launcher: "white",
    expected: "white",
  },
  {
    name: "같은 발사에서 양쪽 동시 전멸",
    remaining: { white: 0, black: 0 },
    launcher: "black",
    expected: "black",
  },
];

for (const testCase of cases) {
  const actual = determineMatchWinner(
    testCase.remaining,
    testCase.launcher,
  );
  if (actual !== testCase.expected) {
    throw new Error(
      `${testCase.name} 실패: expected=${testCase.expected}, actual=${String(actual)}`,
    );
  }
  console.log(
    `[통과] ${testCase.name}: launcher=${testCase.launcher}, remaining=${JSON.stringify(testCase.remaining)}, winner=${actual}`,
  );
}
