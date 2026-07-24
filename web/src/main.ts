import "./style.css";

const app = document.querySelector<HTMLElement>("#app");

if (app === null) {
  throw new Error("게임 진입점 #app 요소를 찾지 못했습니다.");
}

// 이번 슬라이스는 게임 런타임 대신 다음 구현 단계가 연결될 진입점만 제공한다.
app.innerHTML = `
  <section class="placeholder" aria-labelledby="page-title">
    <p class="eyebrow">SLICE 0</p>
    <h1 id="page-title">ChessAlkkagi</h1>
    <p>3D 체스 알까기 게임을 준비하고 있습니다.</p>
  </section>
`;

