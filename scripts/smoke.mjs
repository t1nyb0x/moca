/**
 * 起動のスモークテスト。
 *
 * ビルド済みの実行ファイルを起動し、期待するログが出るまで待つ。出れば
 * WebView が立ち上がり、React が動き、IPC 経由で Rust に到達したことの
 * 証拠になる。
 *
 * WebdriverIO による UI 自動操作は導入も維持も重く、不安定になりやすい。
 * 「起動して疎通する」ことの確認であれば、この方法のほうが確実で速い。
 * 画面の操作を伴う検証が必要になった時点で改めて検討する。
 *
 *   node scripts/smoke.mjs [実行ファイルのパス]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const exe = process.argv[2] ?? "src-tauri/target/debug/moca.exe";
const TIMEOUT_MS = 90_000;

/** これが揃えば、起動と IPC の疎通まで確認できたことになる。 */
const REQUIRED = [
  { pattern: "起動しました", why: "Rust 側の初期化が終わった" },
  { pattern: "設定の読み出し", why: "WebView が立ち上がり IPC に到達した" },
];

if (!existsSync(exe)) {
  console.error(`実行ファイルがありません: ${exe}`);
  console.error("先に `npm run tauri build -- --debug --no-bundle` を実行してください。");
  process.exit(1);
}

/** Windows では kill が効かないことがあるので確実に落とす。 */
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

const child = spawn(exe, [], {
  env: { ...process.env, RUST_LOG: "moca=debug,info" },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
const seen = new Set();

const done = new Promise((resolve) => {
  const check = (chunk) => {
    output += chunk.toString();
    for (const { pattern } of REQUIRED) {
      if (!seen.has(pattern) && output.includes(pattern)) {
        seen.add(pattern);
        console.log(`  確認: ${pattern}`);
      }
    }
    if (seen.size === REQUIRED.length) resolve("ok");
  };

  child.stdout.on("data", check);
  child.stderr.on("data", check);
  child.on("error", (error) => resolve(`起動できませんでした: ${error.message}`));
  child.on("exit", (code) => resolve(`途中で終了しました (code=${code})`));
  setTimeout(() => resolve("時間内にログが出ませんでした"), TIMEOUT_MS);
});

console.log(`起動します: ${exe}`);
const result = await done;
terminate(child);

if (result === "ok") {
  console.log("スモークテスト: 成功");
  process.exit(0);
}

console.error(`スモークテスト: 失敗 (${result})`);
for (const { pattern, why } of REQUIRED) {
  console.error(`  ${seen.has(pattern) ? "確認" : "未確認"}: ${pattern}  — ${why}`);
}
console.error("--- 実行ファイルの出力 ---");
console.error(output.slice(-2000) || "(出力なし)");
process.exit(1);
