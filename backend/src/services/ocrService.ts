export interface OCRResult {
  status: "PENDING" | "NOT_IMPLEMENTED";
  text: string | null;
}

export async function extractText(_buffer: Buffer, mimeType?: string): Promise<OCRResult> {
  // Point d'intégration réservé au moteur OCR. Aucun texte n'est inventé.
  if (mimeType === "application/pdf" || mimeType?.startsWith("image/")) {
    return { status: "NOT_IMPLEMENTED", text: null };
  }
  return { status: "NOT_IMPLEMENTED", text: null };
}
