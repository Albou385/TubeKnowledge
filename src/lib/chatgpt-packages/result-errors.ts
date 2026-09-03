export const RESULT_UPLOAD_ERRORS = {
  SOURCE_PACKAGE_SELECTED: {
    message: "Ce fichier est le paquet à envoyer à ChatGPT, pas le résultat de l’analyse. Après l’analyse, téléchargez le ZIP de résultat, puis sélectionnez-le ici.",
    technical: "Le ZIP sélectionné contient package-manifest.json, mais aucun manifest.json Phase 3.",
  },
  NO_MANIFEST: {
    message: "Ce ZIP ne contient pas de résultat d’analyse reconnaissable. Sélectionnez le ZIP retourné après l’analyse.",
    technical: "Aucun manifest.json Phase 3 ni package-manifest.json de demande n’a été trouvé.",
  },
  CORRUPT_ARCHIVE: {
    message: "Ce fichier ZIP est endommagé ou illisible. Téléchargez de nouveau le résultat puis réessayez.",
    technical: "L’archive n’a pas pu être parcourue de manière sûre.",
  },
  ARCHIVE_TOO_LARGE: {
    message: "Ce ZIP dépasse la taille ou les limites de sécurité autorisées.",
    technical: "Une limite de taille compressée, décompressée, de fichier ou d’entrées a été dépassée.",
  },
  AMBIGUOUS_ARCHIVE: {
    message: "Ce ZIP mélange une demande et un résultat. Utilisez uniquement le ZIP de résultat retourné après l’analyse.",
    technical: "package-manifest.json et manifest.json Phase 3 sont présents dans la même archive.",
  },
  PACKAGE_ID_MISMATCH: {
    message: "Ce résultat appartient à un autre paquet d’analyse. Sélectionnez le résultat correspondant à cette vidéo.",
    technical: "Le packageId du résultat ne correspond pas au paquet source attendu.",
  },
  SOURCE_URL_MISMATCH: {
    message: "Ce résultat concerne une autre vidéo. Sélectionnez le ZIP retourné pour la source affichée sur cette page.",
    technical: "L’URL source du résultat diffère de celle du paquet d’analyse.",
  },
  UNSUPPORTED_PHASE3: {
    message: "Le format de ce résultat n’est pas compatible avec TubeKnowledge. Demandez un nouveau ZIP conforme aux instructions fournies.",
    technical: "Le manifeste ou le contenu ne respecte pas le contrat d’import Phase 3 V1.",
  },
  STALE_RESULT: {
    message: "La bibliothèque a changé depuis la création du paquet. Recréez le paquet d’analyse avant de continuer.",
    technical: "Au moins un document de contexte ne correspond plus à son empreinte initiale.",
  },
  ALREADY_IMPORTED: {
    message: "Ce résultat a déjà été ajouté à la bibliothèque.",
    technical: "Le paquet d’analyse est déjà associé à un import réussi.",
  },
} as const;

export type ResultUploadErrorCode = keyof typeof RESULT_UPLOAD_ERRORS;

export class ResultUploadError extends Error {
  readonly publicMessage: string;
  readonly technicalDetail: string;
  constructor(readonly code: ResultUploadErrorCode, options: { cause?: unknown; technicalDetail?: string } = {}) {
    const definition = RESULT_UPLOAD_ERRORS[code];
    super(definition.message, { cause: options.cause });
    this.name = "ResultUploadError";
    this.publicMessage = definition.message;
    this.technicalDetail = options.technicalDetail ?? definition.technical;
  }
}

export function publicResultUploadError(error: unknown) {
  const safe = error instanceof ResultUploadError ? error : new ResultUploadError("UNSUPPORTED_PHASE3", { cause: error });
  return { code: safe.code, message: safe.publicMessage, technicalDetail: safe.technicalDetail };
}
