import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { createApp } from "../src/app.ts";

test("reports health", async (context) => {
  const server = createApp().listen(0);
  context.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://localhost:${port}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});
