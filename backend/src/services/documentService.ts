import { createDocument, listDocuments } from "../repositories/documentRepository.js";

export function getDocuments(caseId: string) {
  return listDocuments(caseId);
}

export function registerDocument(input: {
  caseId: string;
  uploadedBy: string;
  filename: string;
  storageKey: string;
  mimeType?: string;
  fileSize?: number;
  fileData?: Buffer;
}) {
  const allowed = ["application/pdf","image/jpeg","image/png"];
  if (input.mimeType && !allowed.includes(input.mimeType)) throw new Error("FILE_TYPE_NOT_ALLOWED");
  if (input.fileSize && input.fileSize > 20 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
  return createDocument(input);
}
