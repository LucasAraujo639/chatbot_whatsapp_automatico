import { Router } from "express";
import { allowlist as defaultAllowlist } from "../allowlist.js";

// onChange: se llama cuando cambia la lista (para refrescar el panel en vivo).
export function createVocabularyRouter({ allowlist = defaultAllowlist, onChange = () => {} } = {}) {
  const router = Router();

  router.get("/allowed", (_, res) => res.json({ words: allowlist.list() }));

  router.post("/allowed", (req, res) => {
    const words = allowlist.add(req.body?.word);
    if (!words) return res.status(400).json({ error: "Tiene que ser una sola palabra (hasta 40 letras)" });
    onChange();
    res.json({ words });
  });

  router.delete("/allowed/:word", (req, res) => {
    const words = allowlist.remove(req.params.word);
    onChange();
    res.json({ words });
  });

  return router;
}
