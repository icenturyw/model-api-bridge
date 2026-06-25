const { createApp } = require("./app");

async function main() {
  const app = createApp();
  const address = await app.start();
  const host = address.address === "::" ? "127.0.0.1" : address.address;
  console.log(`model-api-bridge listening on http://${host}:${address.port}`);
  console.log(`Admin console: http://${host}:${address.port}/admin`);

  const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.stop();
      console.log("Server stopped cleanly");
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
