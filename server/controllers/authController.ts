import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { AuthRequest } from "../middleware/auth.js";

const JWT_SECRET = process.env.JWT_SECRET || "ai-studio-secret-key";

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
       res.status(400).json({ message: "请提供邮箱和密码" });
       return;
    }
    
    let user = await User.findOne({ email });
    if (user) {
      res.status(400).json({ message: "该用户已存在" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user = new User({ email, password: hashedPassword });
    await user.save();

    const payload = { id: user.id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "10d" });

    res.status(201).json({ token, user: { email: user.email, points: user.points } });
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误", error: err.message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      res.status(400).json({ message: "邮箱或密码错误" });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
       res.status(400).json({ message: "邮箱或密码错误" });
       return;
    }

    const payload = { id: user.id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "10d" });

    res.json({ token, user: { email: user.email, points: user.points } });
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误", error: err.message });
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      res.status(404).json({ message: "未找到该用户" });
      return;
    }
    res.json({ email: user.email, points: user.points });
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误", error: err.message });
  }
};

export const getAllUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误", error: err.message });
  }
};

export const updateUserPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, points } = req.body;
    if (typeof points !== 'number') {
      res.status(400).json({ message: "无效的积分值" });
      return;
    }
    const user = await User.findByIdAndUpdate(userId, { points }, { new: true }).select("-password");
    if (!user) {
      res.status(404).json({ message: "未找到该用户" });
      return;
    }
    res.json(user);
  } catch (err: any) {
    res.status(500).json({ message: "服务器内部错误", error: err.message });
  }
};
