import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export async function readYaml<T>(filePath: string): Promise<T> {
  return YAML.parse(await readText(filePath)) as T;
}

export async function writeYaml(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, YAML.stringify(value));
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readText(filePath)) as T;
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function projectPath(...parts: string[]): string {
  return path.resolve(process.cwd(), ...parts);
}

export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
