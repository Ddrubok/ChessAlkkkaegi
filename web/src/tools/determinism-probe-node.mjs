import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const outputPath =
  process.argv[2] === undefined
    ? fileURLToPath(new URL("./determinism-probe-node.json", import.meta.url))
    : process.argv[2];
const vite = await createServer({
  root: webRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
});

try {
  const probeModule = await vite.ssrLoadModule(
    "/src/tools/determinism-probe.ts",
  );
  const meta = JSON.parse(
    await readFile(
      new URL("../../public/assets/chess-set.meta.json", import.meta.url),
      "utf8",
    ),
  );
  const report = await probeModule.runDeterminismProbe(meta);
  for (const checkpoint of report.checkpoints) {
    console.log(
      `${String(checkpoint.launchIndex).padStart(2, "0")} ${checkpoint.sha256}`,
    );
  }
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Node 결정성 프로브 저장: ${outputPath}`);
} catch (error) {
  const fullError =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(fullError);
  process.exitCode = 1;
} finally {
  await vite.close();
}
