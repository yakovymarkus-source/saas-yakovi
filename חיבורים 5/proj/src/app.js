const express = require("express");
const analysisRoutes = require("./routes/analysisRoutes");
const campaignRoutes = require("./routes/campaignRoutes");

const app = express();

app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", analysisRoutes);
app.use("/api", campaignRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({
    error: err.message || "Internal Server Error",
    code: err.code || "INTERNAL_ERROR"
  });
});

module.exports = app;
