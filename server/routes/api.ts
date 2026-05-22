import express from "express";
import { register, login, getMe } from "../controllers/authController.js";
import { getTodos, createTodo, updateTodo, deleteTodo } from "../controllers/todoController.js";
import { authMiddleware } from "../middleware/auth.js";

const router = express.Router();

// Auth routes
router.post("/auth/register", register);
router.post("/auth/login", login);
router.get("/auth/me", authMiddleware, getMe);

// Todo routes
router.get("/todos", authMiddleware, getTodos);
router.post("/todos", authMiddleware, createTodo);
router.put("/todos/:id", authMiddleware, updateTodo);
router.delete("/todos/:id", authMiddleware, deleteTodo);

export default router;
