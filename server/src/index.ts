import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3001);

createApp().listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
