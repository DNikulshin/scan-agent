// Next.js 16 instrumentation hook: вызывается один раз при старте серверного
// рантайма (включая standalone production-сборку).
//
// Запускаем notifications dispatcher здесь, чтобы worker крутился рядом с API
// без отдельного процесса. Edge-рантайм отсекаем по NEXT_RUNTIME.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NOTIFICATIONS_DISPATCHER_DISABLED === "true") {
    console.log("[instrumentation] notifications dispatcher disabled by env");
    return;
  }

  const { startDispatcher } = await import("./lib/notifications/dispatcher");
  startDispatcher();
}
