import { Router } from "express";
import { simulateTurn, simulateFollowUp, InvalidSimulationInput } from "../simulator.js";

const router = Router();

const handler = (run) => async (req, res) => {
  try {
    res.json(await run(req.body ?? {}));
  } catch (e) {
    res.status(e instanceof InvalidSimulationInput ? 400 : 502).json({ error: e.message });
  }
};

router.post("/", handler(({ messages }) => simulateTurn(messages)));
router.post("/follow-up", handler(({ messages, attempt }) => simulateFollowUp(messages, attempt)));

export default router;
