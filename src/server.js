const { createApp } = require("./app");

async function main() {
  const app = createApp();
  const address = await app.start();
  const host = address.address === "::" ? "127.0.0.1" : address.address;
  console.log(`model-api-bridge listening on http://${host}:${address.port}`);
  console.log(`Admin console: http://${host}:${address.port}/admin`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
