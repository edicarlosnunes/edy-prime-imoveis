import { Router, type IRouter } from "express";

const router: IRouter = Router();

// The imported storefront has complete built-in content and property imagery.
// These responses keep that static fallback active until its former Turso data
// is intentionally migrated to Replit PostgreSQL.
router.post("/rpc/siteContent/get", (_req, res) => {
  res.json({ json: null });
});

router.post("/rpc/properties/list", (_req, res) => {
  res.json({ json: [] });
});

export default router;