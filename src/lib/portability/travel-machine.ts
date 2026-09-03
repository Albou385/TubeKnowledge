import type { PortabilityConfig } from "./config";
import { ensureMachineIdentity, loadMachineIdentity } from "./machine-identity";
import type { MachineIdentity } from "./types";

export async function configureTravelMachine(
  config: PortabilityConfig,
  displayName: string,
): Promise<{ configured: true; created: boolean; identity: MachineIdentity }> {
  if (!config.enabled) throw new Error("Le state path Portable doit être configuré avant l’identité.");
  const prior = await loadMachineIdentity(config);
  if (prior && prior.rolePreference !== "reader") {
    throw new Error("L’identité locale existante n’est pas reader. Configurez un state path Portable distinct avant de continuer.");
  }
  const identity = await ensureMachineIdentity(config, { displayName, rolePreference: "reader" });
  return { configured: true, created: !prior, identity };
}
