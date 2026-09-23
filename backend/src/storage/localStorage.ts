import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = process.env.DOCUMENT_STORAGE_PATH ?? "./storage/documents";

export async function saveDocument(buffer: Buffer, originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  const key = `${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}${extension}`;
  const target = path.join(root, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, buffer, { flag: "wx" });
  return key;
}

export async function readDocument(storageKey: string) {
  return readFile(path.join(root, storageKey));
}
