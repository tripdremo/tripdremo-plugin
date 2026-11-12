import { createRemoteHttpServer } from "./remote/http.js";
import { loadRemoteConfig } from "./remote/config.js";

const config = loadRemoteConfig();
const server = createRemoteHttpServer(config);
server.listen(config.port, config.host, () => {
  console.error(`[tripdremo-connect] listening on ${config.host}:${config.port}`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
