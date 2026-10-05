import fs from "fs";
import path from "path";
import express, { Express } from "express";

// Serves the built dashboard (Vite output) from this server.
//  - /assets/* are content-hashed by Vite, so they're cached for a year
//  - index.html is never cached, so a new deployment shows up on next load
//  - any other GET that isn't the API, the socket or the health check gets
//    index.html (client-side routes); unknown API paths still return JSON 404
export function serveDashboard(app: Express, buildPath: string): void {
  const indexFile = path.join(buildPath, "index.html");
  if (!fs.existsSync(indexFile)) {
    console.error(`[static] SERVE_CLIENT is on but ${indexFile} doesn't exist. Run "npm run build" in client/.`);
    return;
  }

  app.use(
    "/assets",
    express.static(path.join(buildPath, "assets"), { immutable: true, maxAge: "365d", fallthrough: false })
  );
  app.use(express.static(buildPath, { index: false, maxAge: 0 }));

  const sendIndex = (_req: express.Request, res: express.Response) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexFile);
  };
  // Not /api/..., /socket.io/... or /health
  app.get(/^\/(?!api(?:\/|$)|socket\.io(?:\/|$)|health$).*/, sendIndex);
  console.log(`[static] Serving the dashboard from ${buildPath}`);
}
