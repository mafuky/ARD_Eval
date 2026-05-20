import { config as loadDotenv } from "dotenv";
import { ModelConfig } from "../types.js";
import { projectPath, readYaml } from "../utils/fs.js";

loadDotenv();

export async function loadModelConfig(): Promise<ModelConfig> {
  return readYaml<ModelConfig>(projectPath("config", "model_config.yaml"));
}

export function isMockMode(): boolean {
  return process.env.ARD_EVAL_MOCK !== "0";
}
