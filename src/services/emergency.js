import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_KEYWORDS_PATH = path.resolve(__dirname, "../../data/emergency-keywords.json");
const DEFAULT_NUMBERS_PATH = path.resolve(__dirname, "../../data/emergency-numbers.json");

const EmergencyKeywordsSchema = z.array(z.string().min(1)).min(1);

const EmergencyNumbersSchema = z.array(z.object({
  jurisdictionAliases: z.array(z.string().min(1)).min(1),
  number: z.string().min(1),
  serviceDescription: z.string().min(1),
  verificationSource: z.string().min(1),
})).min(1);

let loadedKeywords = [];
let loadedNumbers = [];

/**
 * Validate and load emergency datasets
 */
export function loadEmergencyData(
  keywordsPath = DEFAULT_KEYWORDS_PATH,
  numbersPath = DEFAULT_NUMBERS_PATH
) {
  if (!fs.existsSync(keywordsPath)) {
    const error = new Error(`Emergency keywords file not found at: ${keywordsPath}`);
    error.code = "EMERGENCY_KEYWORDS_MISSING";
    throw error;
  }

  if (!fs.existsSync(numbersPath)) {
    const error = new Error(`Emergency numbers file not found at: ${numbersPath}`);
    error.code = "EMERGENCY_NUMBERS_MISSING";
    throw error;
  }

  try {
    const rawKeywords = fs.readFileSync(keywordsPath, "utf-8");
    loadedKeywords = EmergencyKeywordsSchema.parse(JSON.parse(rawKeywords));
  } catch (err) {
    const error = new Error(`Emergency keywords file is invalid: ${err.message}`);
    error.code = "EMERGENCY_KEYWORDS_INVALID";
    throw error;
  }

  try {
    const rawNumbers = fs.readFileSync(numbersPath, "utf-8");
    loadedNumbers = EmergencyNumbersSchema.parse(JSON.parse(rawNumbers));
  } catch (err) {
    const error = new Error(`Emergency numbers file is invalid: ${err.message}`);
    error.code = "EMERGENCY_NUMBERS_INVALID";
    throw error;
  }

  return {
    keywords: loadedKeywords,
    numbers: loadedNumbers,
  };
}

export function getLoadedKeywords() {
  return loadedKeywords;
}

export function getLoadedNumbers() {
  return loadedNumbers;
}
