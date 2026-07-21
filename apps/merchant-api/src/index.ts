import { config } from "dotenv";

config({ path: new URL("../../../.env.local", import.meta.url) });

const { createApp } = await import("./app.js");

const port = Number(process.env.MERCHANT_API_PORT ?? 4_000);
const app = createApp();

app.listen(port, () => {
  console.log(`Merchant API listening on http://localhost:${port}`);
});
