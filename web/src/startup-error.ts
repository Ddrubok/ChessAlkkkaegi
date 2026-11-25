import { startupFailureKind, type StartupFailureKind } from "./startup-failure";

type Copy = { graphics: string; graphicsHelp: string; download: string; downloadHelp: string; unknown: string; unknownHelp: string; retry: string };

const COPY: Record<string, Copy> = {
  en: { graphics: "Graphics could not start", graphicsHelp: "Check that WebGL or hardware acceleration is available in your browser, then try again.", download: "Game files could not be loaded", downloadHelp: "Check your connection, then try again.", unknown: "The game could not start", unknownHelp: "Please try again. If the problem continues, restart your browser.", retry: "Try again" },
  ko: { graphics: "그래픽을 시작하지 못했습니다", graphicsHelp: "브라우저에서 WebGL 또는 하드웨어 가속을 사용할 수 있는지 확인한 뒤 다시 시도해 주세요.", download: "게임 파일을 불러오지 못했습니다", downloadHelp: "연결 상태를 확인한 뒤 다시 시도해 주세요.", unknown: "게임을 시작하지 못했습니다", unknownHelp: "다시 시도해 주세요. 문제가 계속되면 브라우저를 다시 시작해 주세요.", retry: "다시 시도" },
  ja: { graphics: "グラフィックを開始できませんでした", graphicsHelp: "ブラウザーでWebGLまたはハードウェアアクセラレーションが使えるか確認し、再試行してください。", download: "ゲームファイルを読み込めませんでした", downloadHelp: "接続を確認してから再試行してください。", unknown: "ゲームを開始できませんでした", unknownHelp: "再試行してください。問題が続く場合はブラウザーを再起動してください。", retry: "再試行" },
  "zh-CN": { graphics: "无法启动图形功能", graphicsHelp: "请确认浏览器支持 WebGL 或已启用硬件加速，然后重试。", download: "无法加载游戏文件", downloadHelp: "请检查网络连接，然后重试。", unknown: "无法启动游戏", unknownHelp: "请重试。如果问题仍然存在，请重启浏览器。", retry: "重试" },
  de: { graphics: "Grafik konnte nicht gestartet werden", graphicsHelp: "Prüfe, ob WebGL oder Hardwarebeschleunigung im Browser verfügbar ist, und versuche es erneut.", download: "Spieldateien konnten nicht geladen werden", downloadHelp: "Prüfe deine Verbindung und versuche es erneut.", unknown: "Das Spiel konnte nicht gestartet werden", unknownHelp: "Versuche es erneut. Falls das Problem bleibt, starte den Browser neu.", retry: "Erneut versuchen" },
  fr: { graphics: "Impossible de démarrer les graphismes", graphicsHelp: "Vérifiez que WebGL ou l’accélération matérielle est disponible dans votre navigateur, puis réessayez.", download: "Impossible de charger les fichiers du jeu", downloadHelp: "Vérifiez votre connexion, puis réessayez.", unknown: "Impossible de démarrer le jeu", unknownHelp: "Réessayez. Si le problème persiste, redémarrez votre navigateur.", retry: "Réessayer" },
  es: { graphics: "No se pudieron iniciar los gráficos", graphicsHelp: "Comprueba que WebGL o la aceleración por hardware estén disponibles en tu navegador y vuelve a intentarlo.", download: "No se pudieron cargar los archivos del juego", downloadHelp: "Comprueba tu conexión y vuelve a intentarlo.", unknown: "No se pudo iniciar el juego", unknownHelp: "Vuelve a intentarlo. Si el problema continúa, reinicia el navegador.", retry: "Reintentar" },
  ru: { graphics: "Не удалось запустить графику", graphicsHelp: "Проверьте, доступен ли WebGL или аппаратное ускорение в браузере, затем повторите попытку.", download: "Не удалось загрузить файлы игры", downloadHelp: "Проверьте подключение и повторите попытку.", unknown: "Не удалось запустить игру", unknownHelp: "Повторите попытку. Если проблема сохранится, перезапустите браузер.", retry: "Повторить" },
  "pt-BR": { graphics: "Não foi possível iniciar os gráficos", graphicsHelp: "Verifique se WebGL ou aceleração de hardware está disponível no navegador e tente novamente.", download: "Não foi possível carregar os arquivos do jogo", downloadHelp: "Verifique sua conexão e tente novamente.", unknown: "Não foi possível iniciar o jogo", unknownHelp: "Tente novamente. Se o problema continuar, reinicie o navegador.", retry: "Tentar novamente" },
};

function currentCopy(): Copy {
  const language = document.documentElement?.lang;
  return COPY[language] ?? COPY[language?.split("-")[0] ?? ""] ?? COPY.en;
}

export function showStartupError(error: unknown): void {
  console.error("Game startup failed", error);
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  const kind: StartupFailureKind = startupFailureKind(error);
  const copy = currentCopy();
  const panel = document.createElement("section");
  panel.id = "boot-loading";
  panel.className = "error-panel";
  panel.setAttribute("role", "alert");
  const card = document.createElement("div");
  card.className = "boot-loading-card";
  const heading = document.createElement("h1");
  heading.textContent = copy[kind];
  const help = document.createElement("p");
  help.textContent = copy[`${kind}Help`];
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = copy.retry;
  retry.addEventListener("click", () => window.location.reload());
  card.append(heading, help, retry);
  panel.append(card);
  app.replaceChildren(panel);
  retry.focus();
}
