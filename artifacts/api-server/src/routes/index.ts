import { Router, type IRouter } from "express";
import healthRouter from "./health";
import importedSiteRouter from "./imported-site";

const router: IRouter = Router();

router.use(healthRouter);
router.use(importedSiteRouter);

export default router;
