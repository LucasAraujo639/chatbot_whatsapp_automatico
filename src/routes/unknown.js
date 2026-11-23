import { Router } from "express";
import { InboxError } from "../unknown-service.js";
import { NotConnectedError } from "../adapters/whatsapp.js";

// Bandeja de desconocidos + entrenamiento del asistente de bienvenida.
// service: ver src/unknown-service.js · greeter: { load, save } · test: async (text) => string
export function createUnknownRouter({ service, greeter, test, onChange = () => {} }) {
  const router = Router();
  const handle = (fn) => async (req, res) => {
    try { res.json(await fn(req)); } catch (e) {
      const status = e instanceof InboxError ? e.status : e instanceof NotConnectedError ? 409 : 502;
      res.status(status).json({ error: e.message });
    }
  };

  router.get("/greeter", handle(() => greeter.load()));
  router.put("/greeter", handle((req) => { const data = greeter.save(req.body); onChange(); return data; }));
  router.post("/greeter/test", handle(async (req) => {
    const text = String(req.body?.text ?? "").trim();
    if (!text) throw new InboxError("Escribí un mensaje de prueba");
    return { reply: await test(text) };
  }));

  router.get("/", handle(() => ({ items: service.list() })));
  router.get("/:id/profile", handle((req) => service.profile(req.params.id)));
  router.post("/:id/preview", handle(async (req) => ({ text: await service.preview(req.params.id) })));
  router.post("/:id/accept", handle((req) => service.accept(req.params.id, req.body?.text)));
  router.post("/:id/reject", handle((req) => service.reject(req.params.id)));
  router.post("/:id/done", handle((req) => service.setDone(req.params.id, req.body?.done !== false)));
  router.post("/:id/save-contact", handle((req) => service.saveContact(req.params.id, req.body?.name)));
  router.delete("/:id", handle((req) => { service.remove(req.params.id); return { ok: true }; }));

  return router;
}
