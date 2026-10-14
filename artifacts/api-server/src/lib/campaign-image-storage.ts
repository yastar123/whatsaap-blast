import { mkdirSync } from "node:fs";
import path from "node:path";

const configuredDirectory = process.env.CAMPAIGN_UPLOAD_DIR?.trim() || "uploads";

export const campaignImageDirectory = path.resolve(configuredDirectory);

mkdirSync(campaignImageDirectory, { recursive: true });
