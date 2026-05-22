import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  if (!token) {
    res.status(401).json({ message: "无访问令牌，禁止访问" });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "ai-studio-secret-key");
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "凭证无效" });
  }
};
