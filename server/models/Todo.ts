import mongoose, { Document, Schema } from "mongoose";

export interface ITodo extends Document {
  title: string;
  description?: string;
  deadline?: Date;
  completed: boolean;
  userId: mongoose.Types.ObjectId;
}

const todoSchema = new Schema({
  title: { type: String, required: true },
  description: { type: String },
  deadline: { type: Date },
  completed: { type: Boolean, default: false },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

export const Todo = (mongoose.models.Todo as mongoose.Model<ITodo>) || mongoose.model<ITodo>("Todo", todoSchema);
