/**
 * 版番号を 3 箇所から読み、食い違いがあれば失敗する。
 *
 * package.json / Cargo.toml / tauri.conf.json のどれか一つを上げ忘れると、
 * インストーラの版だけが古いといった食い違いが起きる。気づきにくいので
 * 機械で確かめる。
 *
 * 一致していれば版番号を標準出力へ書く。CI とリリースの双方から使う。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const sources = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": /^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1],
};

const missing = Object.entries(sources).filter(([, value]) => value === undefined);
if (missing.length > 0) {
  console.error(`版番号を読み取れません: ${missing.map(([file]) => file).join(", ")}`);
  process.exit(1);
}

const values = [...new Set(Object.values(sources))];
if (values.length !== 1) {
  console.error("版番号が食い違っています:");
  for (const [file, value] of Object.entries(sources)) {
    console.error(`  ${file}: ${value}`);
  }
  process.exit(1);
}

process.stdout.write(`${values[0]}\n`);
