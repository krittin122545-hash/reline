const express = require("express");

function createRouter({ dashboardPath, getRelineLogsFromMongo, buildMonthlySummary }) {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.sendFile(dashboardPath);
  });

  router.get("/logs", async (req, res) => {
    try {
      const rows = await getRelineLogsFromMongo();
      res.json(rows);
    } catch (error) {
      console.error("Failed to load logs:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get("/summary", async (req, res) => {
    try {
      const chatId = req.query.chat_id ? String(req.query.chat_id) : null;
      const rows = await buildMonthlySummary(chatId);
      res.json(rows);
    } catch (error) {
      console.error("Failed to build summary:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = createRouter;
