import mongoose, { Schema } from "mongoose";
import { randomUUID } from "crypto";
import fs from "fs";

export interface IUser {
  _id: string;
  id: string;
  email: string;
  password?: string;
  points: number;
  library?: any[];
  createdAt: Date;
}

const DB_FILE = process.env.DATA_DIR ? `${process.env.DATA_DIR}/users.json` : (fs.existsSync("/data") ? "/data/users.json" : "users.json");

function loadUsers(): IUser[] {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {}
  return [];
}

function saveUsers(users: IUser[]) {
  try {
      fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
      console.error("Failed to save users:", err.message);
  }
}

let localUsers: IUser[] = loadUsers();

const LocalUserMock = {
  findOne: async (query: { email: string }) => {
    return localUsers.find(u => u.email === query.email) || null;
  },
  findById: (id: string) => {
    return {
       select: () => {
          return {
             then: (resolve: any) => {
                const user = localUsers.find(u => u._id === id || u.id === id);
                if (!user) return resolve(null);
                const u = {...user};
                delete u.password;
                resolve(u);
             }
          }
       },
       then: (resolve: any) => {
          const user = localUsers.find(u => u._id === id || u.id === id);
          if (!user) return resolve(null);
          resolve({...user});
       }
    };
  },
  create: async (data: any) => {
    const newUser: IUser = {
      ...data,
      _id: data._id || randomUUID(),
      id: data.id || randomUUID(),
      createdAt: data.createdAt || new Date(),
      points: data.points ?? 100
    };
    localUsers.push(newUser);
    saveUsers(localUsers);
    return newUser;
  },
  updateOne: async (query: { email: string }, data: any) => {
    const user = localUsers.find(u => u.email === query.email);
    if (user) {
      if (data.password) user.password = data.password;
      saveUsers(localUsers);
    }
    return user;
  },
  findByIdAndUpdate: (id: string, update: any, options?: any) => {
    return {
       select: () => {
          return {
             then: (resolve: any) => {
                const user = localUsers.find(u => u._id === id || u.id === id);
                if (user) {
                  if (update.$inc && update.$inc.points !== undefined) {
                    user.points += update.$inc.points;
                  }
                  if (update.points !== undefined) {
                     user.points = update.points;
                  }
                  if (update.$push && update.$push.library) {
                     if (!user.library) user.library = [];
                     
                     const toPush = update.$push.library;
                     if (toPush.$each) {
                        user.library.push(...toPush.$each);
                     } else {
                        user.library.push(toPush);
                     }
                  }
                  if (update.library !== undefined) {
                     user.library = update.library;
                  }
                  saveUsers(localUsers);
                }
                const result = user ? { ...user } : null;
                if (!result) return resolve(null);
                delete result.password;
                resolve(result);
             }
          }
       },
       then: (resolve: any) => {
          const user = localUsers.find(u => u._id === id || u.id === id);
          if (user) {
            if (update.$inc && update.$inc.points !== undefined) {
              user.points += update.$inc.points;
            }
            if (update.points !== undefined) {
               user.points = update.points;
            }
            if (update.$push && update.$push.library) {
               if (!user.library) user.library = [];
               
               const toPush = update.$push.library;
               if (toPush.$each) {
                  user.library.push(...toPush.$each);
               } else {
                  user.library.push(toPush);
               }
            }
            if (update.library !== undefined) {
               user.library = update.library;
            }
            saveUsers(localUsers);
          }
          const result = user ? { ...user } : null;
          if (!result) return resolve(null);
          resolve(result);
       }
    };
  },
  find: () => {
    return {
      select: () => ({
        sort: () => {
          const clones = localUsers.map(u => {
            const copy = {...u};
            delete copy.password;
            return copy;
          });
          return Promise.resolve(clones.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }
      })
    };
  }
};

const userSchema = new Schema<IUser>({
  _id: { type: String, default: () => randomUUID() },
  id: { type: String, default: () => randomUUID() },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  points: { type: Number, default: 100 },
  library: { type: Schema.Types.Mixed, default: [] },
  createdAt: { type: Date, default: Date.now }
});

const MongooseUser = (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>("User", userSchema);

export const User = process.env.MONGODB_URI ? MongooseUser : LocalUserMock as any;

