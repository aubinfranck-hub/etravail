import { createDocument, listDocuments } from "../repositories/documentRepository.js";

export function getDocuments(caseId: string) {
  return listDocuments(caseId);
}

function matchesSignature(buffer: Buffer, mimeType?: string) {
  if (!mimeType || buffer.length < 4) return true;
  if (mimeType === "application/pdf") return buffer.subarray(0,5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mimeType === "image/jpeg") return buffer.subarray(0,3).equals(Buffer.from([255,216,255]));
  return false;
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
  if (input.fileData && !matchesSignature(input.fileData,input.mimeType)) throw new Error("FILE_SIGNATURE_INVALID");
  return createDocument(input);
}
