export type Role = "CITOYEN" | "GREFFE" | "MAGISTRAT" | "ADMIN";

export const permissions: Record<Role, string[]> = {
  CITOYEN: ["case:create","case:read:own","case:document:own","notification:read:own"],
  GREFFE: ["case:read","case:transition","case:document","hearing:manage","notification:manage"],
  MAGISTRAT: ["case:read","case:transition","case:document","hearing:manage","decision:create","notification:manage"],
  ADMIN: ["case:read","case:transition","case:document","hearing:manage","decision:create","notification:manage","admin:manage"]
};

export function hasPermission(role: Role, permission: string) {
  return permissions[role]?.includes(permission) ?? false;
}
