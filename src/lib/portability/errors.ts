export const PUBLIC_PORTABILITY_ERRORS = {
  PORTABILITY_NOT_CONFIGURED: "La portabilité n’est pas configurée sur cette machine.",
  VAULT_NOT_ONEDRIVE: "Le vault configuré ne se trouve pas sous une racine OneDrive reconnue.",
  VAULT_UNAVAILABLE: "Le vault n’est pas disponible localement.",
  VAULT_UNSTABLE: "Le vault a changé pendant la fenêtre de stabilité locale.",
  PLACEHOLDER_DETECTED: "Un fichier requis n’est pas disponible localement. Utilisez « Toujours conserver sur cet appareil ».",
  WRITER_AUTHORITY_REQUIRED: "Cette machine ne possède pas l’autorité d’écriture active.",
  WRITER_ACTIVE_ELSEWHERE: "Une autre machine possède actuellement l’autorité d’écriture.",
  HANDOFF_REQUIRED: "Un transfert explicite du rôle d’écriture est requis.",
  TRAVEL_HANDOFF_EXPIRED: "Le transfert d’absence prolongée a expiré.",
  TRAVEL_HANDOFF_CONSUMED: "Le transfert d’absence prolongée a déjà été consommé.",
  TRAVEL_HANDOFF_INVALID: "Le transfert d’absence prolongée est invalide ou incohérent.",
  TRAVEL_DURATION_INVALID: "La durée d’absence prolongée doit être comprise entre 2 et 60 jours.",
  TRAVEL_CONFIRMATION_REQUIRED: "La confirmation renforcée ACCEPTER ABSENCE est requise.",
  CHECKPOINT_MISMATCH: "Le vault local ne correspond pas au checkpoint attendu.",
  CONTROLLED_WRITE_SCOPE_CHANGED: "Le vault contient une modification qui ne fait pas partie de l’écriture contrôlée.",
  CONTROLLED_STATE_UPDATE_FAILED: "L’état local contrôlé n’a pas pu être mis à jour; l’opération doit être restaurée.",
  CONFLICT_ACTION_NOT_ALLOWED: "Cette action n’est pas autorisée pour ce conflit.",
  CONFLICTS_BLOCKING: "Des conflits bloquants doivent être résolus avant cette opération.",
  BACKUP_REQUIRED: "Un backup vérifié est requis avant cette opération.",
  BACKUP_INVALID: "Le backup est invalide ou non vérifié.",
  BACKUP_SNAPSHOT_MISMATCH: "Le backup vérifié ne correspond pas à l’état stable actuel du vault.",
  WRITER_ALREADY_ACTIVE_LOCAL: "L’autorité writer est déjà active sur cette machine.",
  WRITER_ALREADY_INITIALIZED: "Le bootstrap writer initial a déjà été effectué. Utilisez le renouvellement, la réacquisition ou le handoff.",
  WRITER_UNINITIALIZED: "Le writer n’a pas encore été initialisé.",
  WRITER_ACTIVE_LOCAL: "L’autorité writer locale est déjà active.",
  WRITER_ACTIVE_REMOTE: "Une autre machine possède une autorité writer active.",
  WRITER_EXPIRED_LOCAL: "L’autorité writer locale est expirée.",
  WRITER_EXPIRED_REMOTE: "L’autorité writer expirée appartient à une autre machine.",
  WRITER_RENEWAL_NOT_ALLOWED: "Le renouvellement writer n’est pas autorisé dans l’état actuel.",
  WRITER_REACQUIRE_BACKUP_REQUIRED: "Un backup vérifié sélectionné est requis pour réacquérir writer.",
  WRITER_REACQUIRE_CONFIRMATION_REQUIRED: "La confirmation renforcée REACQUERIR est requise.",
  WRITER_REACQUIRE_BLOCKED_BY_CONFLICT: "La réacquisition est bloquée par un conflit de connaissance.",
  WRITER_REACQUIRE_BLOCKED_BY_HANDOFF: "La réacquisition est bloquée par un handoff en attente.",
  EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED: "La conservation et la réacquisition ne sont pas autorisées dans l’état local actuel.",
  EXPIRED_LOCAL_CONFLICT_CONFIRMATION_REQUIRED: "La confirmation exacte CONSERVER ET REACQUERIR est requise.",
  WRITER_DISASTER_RECOVERY_NOT_ALLOWED: "La récupération d’urgence exige un writer distant expiré et une identité locale distincte.",
  WRITER_DISASTER_RECOVERY_DELAY_ACTIVE: "Le délai de sécurité après expiration du writer distant n’est pas terminé.",
  WRITER_DISASTER_RECOVERY_HANDOFF_ACTIVE: "Un handoff normal ou d’absence prolongée est encore actif.",
  WRITER_DISASTER_RECOVERY_CONFLICTS_PRESENT: "Tous les conflits ouverts doivent être examinés avant une récupération d’urgence.",
  WRITER_DISASTER_RECOVERY_BACKUP_REQUIRED: "Un backup knowledge vérifié correspondant exactement au vault stable est requis.",
  WRITER_DISASTER_RECOVERY_PREVIEW_REQUIRED: "Une Preview de récupération valide et non expirée est requise.",
  WRITER_DISASTER_RECOVERY_CONFIRMATION_REQUIRED: "La confirmation exacte REPRENDRE LE WRITER SUR CE PORTABLE est requise.",
  WRITER_DISASTER_RECOVERY_STATE_CHANGED: "L’état writer, le checkpoint ou le vault a changé depuis la Preview.",
  WRITER_TRANSITION_IN_PROGRESS: "Une autre transition writer est en cours sur ce vault local.",
  PORTABILITY_CONFLICT_BLOCKING: "Un conflit de connaissance bloquant doit être examiné.",
  PORTABILITY_STATE_INCONSISTENT: "L’état de portabilité local est incohérent et requiert un diagnostic.",
  PORTABILITY_DIAGNOSTIC_FAILED: "Le diagnostic de portabilité a échoué.",
  SINGLE_MACHINE_MODE_HANDOFF_BLOCKED: "Désactivez le mode mono-machine temporaire avant de préparer un handoff.",
  BOOTSTRAP_IN_PROGRESS: "Une initialisation writer est déjà en cours.",
  IDEMPOTENCY_KEY_INVALID: "La clé d’idempotence est invalide ou expirée.",
  IDEMPOTENCY_CONFLICT: "La clé d’idempotence a déjà été utilisée pour une autre opération.",
  CHECKPOINT_CREATION_FAILED: "La création du checkpoint a échoué.",
  WRITER_ACQUISITION_FAILED: "L’acquisition de l’autorité writer a échoué.",
  BOOTSTRAP_ROUTE_REQUIRED: "Utilisez l’opération atomique de bootstrap writer.",
  RESTORE_PREVIEW_REQUIRED: "Une prévisualisation de restauration valide est requise.",
  RESTORE_CONFIRMATION_REQUIRED: "La confirmation renforcée RESTAURER est requise.",
  RESTORE_FAILED: "La restauration a échoué.",
  ROLLBACK_FAILED: "La restauration a échoué et le rollback est incomplet.",
} as const;

export type PortabilityErrorCode = keyof typeof PUBLIC_PORTABILITY_ERRORS;

export class PortabilityError extends Error {
  constructor(public readonly code: PortabilityErrorCode, options?: { cause?: unknown }) {
    super(PUBLIC_PORTABILITY_ERRORS[code], options);
    this.name = "PortabilityError";
  }
}

export function publicPortabilityError(error: unknown): { code: PortabilityErrorCode; message: string } {
  const code = error instanceof PortabilityError ? error.code : "VAULT_UNAVAILABLE";
  return { code, message: PUBLIC_PORTABILITY_ERRORS[code] };
}

