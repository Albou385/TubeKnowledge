export function safePackageError(error: unknown, fallback = "Opération Paquet ChatGPT impossible."): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  if (/([a-z]:\\|\\\\|\/Users\/|\/home\/)/i.test(message)) return fallback;
  return message.slice(0, 500);
}
