import { Router, type IRouter } from "express";
import adminRouter from "./admin";
import authRouter from "./auth";
import blastRouter from "./blast";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import resultsRouter from "./results";
import walletRouter from "./wallet";
import whatsappRouter from "./whatsapp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(whatsappRouter);
router.use(adminRouter);
router.use(blastRouter);
router.use(resultsRouter);
router.use(walletRouter);

export default router;
