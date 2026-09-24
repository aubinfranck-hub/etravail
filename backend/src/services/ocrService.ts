import { createWorker } from "tesseract.js";

export interface OCRResult {
  status: "COMPLETED" | "FAILED";
  text: string | null;
  language: string;
}

const OCR_SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

export async function extractText(buffer: Buffer, language = "fra", mimeType?: string): Promise<OCRResult> {
  // tesseract.js's Node worker cannot decode PDFs: feeding it one throws
  // inside the worker thread ("Error attempting to read image") outside of
  // the recognize() promise, which crashes the whole process as an
  // unhandled worker error instead of rejecting cleanly. Skip OCR for any
  // file type it cannot read rather than letting the worker touch it.
  if (mimeType && !OCR_SUPPORTED_MIME_TYPES.has(mimeType)) {
    return { status: "FAILED", text: null, language };
  }
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
