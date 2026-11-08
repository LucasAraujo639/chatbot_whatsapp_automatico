import { Router } from "express";
import { verifyNumber, NotConnectedError } from "../bot.js";

const router = Router();

// POST /api/contacts/verify { number } → { valid, exists, jid, suggestion }
router.post("/verify", async (req, res) => {
  const number = String(req.body?.number ?? "").replace(/\D/g, "");
  try {
    res.json(await verifyNumber(number));
  } catch (e) {
    res.status(e instanceof NotConnectedError ? 409 : 502).json({ error: e.message });
  }
});

export default router;
