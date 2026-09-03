import { z } from "zod";

import { normalizeRelativeMarkdownPath } from "@/lib/library/path-security";

const vaultNameSchema = z.string().trim().min(1).max(200);

export function getObsidianVaultName(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const parsed = vaultNameSchema.safeParse(environment.OBSIDIAN_VAULT_NAME);
  return parsed.success ? parsed.data : null;
}

export function buildObsidianUrl(
  vaultName: string | null | undefined,
  requestedPath: string,
): string | null {
  const parsedVault = vaultNameSchema.safeParse(vaultName);
  if (!parsedVault.success) return null;
  const relativePath = normalizeRelativeMarkdownPath(requestedPath);
  return `obsidian://open?vault=${encodeURIComponent(parsedVault.data)}&file=${encodeURIComponent(relativePath)}`;
}
