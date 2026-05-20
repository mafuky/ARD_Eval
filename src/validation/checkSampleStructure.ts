import fs from "node:fs";
import path from "node:path";

export interface StructureError {
  sample_id: string;
  arm?: string;
  file?: string;
  problem: string;
}

export function checkSampleStructure(samplesRoot: string, formats: string[]): StructureError[] {
  const errors: StructureError[] = [];

  if (formats.length === 0) {
    errors.push({
      sample_id: "(manifest)",
      problem: "manifest.factors.context_format is empty",
    });
    return errors;
  }

  if (!fs.existsSync(samplesRoot)) {
    errors.push({ sample_id: "(root)", problem: `samples root not found: ${samplesRoot}` });
    return errors;
  }

  const sampleIds = fs
    .readdirSync(samplesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const sampleId of sampleIds) {
    const contextsDir = path.join(samplesRoot, sampleId, "contexts");
    if (!fs.existsSync(contextsDir)) {
      errors.push({ sample_id: sampleId, problem: `missing contexts/ directory: ${contextsDir}` });
      continue;
    }

    const arms = fs
      .readdirSync(contextsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    if (!arms.includes("base")) {
      errors.push({
        sample_id: sampleId,
        problem: `missing required "base" anchor arm under ${contextsDir} (found: ${arms.join(", ") || "none"})`,
      });
    }

    for (const arm of arms) {
      if (arm.trim() === "") {
        errors.push({ sample_id: sampleId, arm, problem: "empty arm name" });
      } else if (/\s/.test(arm)) {
        errors.push({ sample_id: sampleId, arm, problem: `arm name contains whitespace: "${arm}"` });
      } else if (arm.includes("__")) {
        errors.push({
          sample_id: sampleId,
          arm,
          problem: `arm name contains "__" (reserved task_id delimiter): "${arm}"`,
        });
      }

      for (const format of formats) {
        const armNamedFile = path.join(contextsDir, arm, `${arm}.${format}`);
        const legacyFile = path.join(contextsDir, arm, format, `context.${format}`);
        const file = fs.existsSync(armNamedFile) ? armNamedFile : legacyFile;

        if (!fs.existsSync(file)) {
          errors.push({
            sample_id: sampleId,
            arm,
            file: armNamedFile,
            problem: `missing ${arm}.${format} or ${format}/context.${format}`,
          });
          continue;
        }

        if (format === "json") {
          try {
            JSON.parse(fs.readFileSync(file, "utf8"));
          } catch (error) {
            errors.push({
              sample_id: sampleId,
              arm,
              file,
              problem: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      }
    }
  }

  return errors;
}
