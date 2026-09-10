export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.npm_lifecycle_event === "build") return;
  const { startAutomaticWriterRenewal } = await import("@/lib/portability/automatic-writer-renewal");
  const { getVideoQueueEngine } = await import("@/lib/video-queue/engine");
  startAutomaticWriterRenewal();
  getVideoQueueEngine().startBackgroundRunner();
}
