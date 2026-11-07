import express from "express";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  return app;
}
