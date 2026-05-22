import express from "express";
import { register, login, getMe, getAllUsers, updateUserPoints } from "../controllers/authController.js";
import { getTodos, createTodo, updateTodo, deleteTodo } from "../controllers/todoController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Auth routes
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", authMiddleware, getMe);
router.get("/admin/users", authMiddleware, getAllUsers);
router.put("/admin/users", authMiddleware, updateUserPoints);

// Todo routes
router.get("/todos", authMiddleware, getTodos);
router.post("/todos", authMiddleware, createTodo);
router.put("/todos/:id", authMiddleware, updateTodo);
router.delete("/todos/:id", authMiddleware, deleteTodo);

export default router;
