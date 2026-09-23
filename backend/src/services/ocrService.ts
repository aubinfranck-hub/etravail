import { createWorker } from "tesseract.js";

export interface OCRResult {
  status: "COMPLETED" | "FAILED";
  text: string | null;
  language: string;
}

export async function extractText(buffer: Buffer, language = "fra"): Promise<OCRResult> {
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    worker = await createWorker(language);
    const result = await worker.recognize(buffer);
    const text = result.data.text?.trim() || null;
    return { status: "COMPLETED", text, language };
  } catch {
    return { status: "FAILED", text: null, language };
  } finally {
    if (worker) await worker.terminate();
  }
}
