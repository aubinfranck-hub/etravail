import { searchDocuments } from "../repositories/searchRepository.js";

export async function searchInDocuments(query: string) {
  const clean = query.trim();
  if (clean.length < 2) throw new Error("QUERY_TOO_SHORT");
  return searchDocuments(clean);
}
