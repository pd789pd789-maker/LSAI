import express from "express";
import { register, login, getMe, getAllUsers, updateUserPoints } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Auth routes
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", authMiddleware, getMe);
router.get("/admin/users", authMiddleware, getAllUsers);
router.put("/admin/users", authMiddleware, updateUserPoints);

export default router;
