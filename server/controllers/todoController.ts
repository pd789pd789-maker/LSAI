import { Response } from "express";
import { Todo } from "../models/Todo.js";
import { AuthRequest } from "../middleware/auth.js";

export const getTodos = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const todos = await Todo.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(todos);
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误" });
  }
};

export const createTodo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, deadline, completed } = req.body;
    if (!title) {
       res.status(400).json({ message: "标题为必填项" });
       return;
    }
    const todo = new Todo({ 
       title, 
       description, 
       deadline, 
       completed, 
       userId: req.user.id 
    });
    const savedTodo = await todo.save();
    res.status(201).json(savedTodo);
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误" });
  }
};

export const updateTodo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, deadline, completed } = req.body;
    const todo = await Todo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: { title, description, deadline, completed } },
      { new: true }
    );
    if (!todo) {
       res.status(404).json({ message: "未找到待办事项" });
       return;
    }
    res.json(todo);
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误" });
  }
};

export const deleteTodo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const todo = await Todo.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!todo) {
      res.status(404).json({ message: "未找到待办事项" });
      return;
    }
    res.json({ message: "待办事项已删除" });
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误" });
  }
};
