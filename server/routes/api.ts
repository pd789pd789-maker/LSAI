import express from "express";
import { register, login, getMe, getAllUsers, updateUserPoints, createUser, getLibrary, syncLibrary } from "../controllers/authController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Auth routes
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", authMiddleware, getMe);
router.get("/admin/users", authMiddleware, getAllUsers);
router.put("/admin/users", authMiddleware, updateUserPoints);
router.post("/admin/users", authMiddleware, createUser);

// Library
router.get("/user/library", authMiddleware, getLibrary);
router.post("/user/library", authMiddleware, syncLibrary);

export default router;
