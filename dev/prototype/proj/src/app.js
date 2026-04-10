const express = require("express");
const { apiKeyAuth } = require("./middleware/apiKeyAuth");
const analysisRoutes = require("./routes/analysisRoutes");
const campaignRoutes = require("./routes/campaignRoutes");

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User-Id");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", apiKeyAuth, analysisRoutes);
app.use("/api", apiKeyAuth, campaignRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const isInternal = status >= 500;
  res.status(status).json({
    error: isInternal && process.env.NODE_ENV === "production"
      ? "Internal Server Error"
      : err.message || "Internal Server Error",
    code: err.code || "INTERNAL_ERROR"
  });
});

module.exports = app;
