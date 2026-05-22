import { randomUUID } from "crypto";
import fs from "fs";

export interface IUser {
  _id: string;
  id: string;
  email: string;
  password?: string;
  points: number;
  createdAt: Date;
}

const DB_FILE = "users.json";

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
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

let users: IUser[] = loadUsers();

export const User = {
  findOne: async (query: { email: string }) => {
    return users.find(u => u.email === query.email) || null;
  },
  findById: async (id: string) => {
    const user = users.find(u => u._id === id || u.id === id);
    if (!user) return null;
    return {
       ...user,
       select: () => {
          const u = {...user};
          delete u.password;
          return u;
       }
    };
  },
  create: async (data: any) => {
    const newUser: IUser = {
      _id: randomUUID(),
      id: randomUUID(),
      ...data,
      createdAt: new Date(),
      points: data.points ?? 100
    };
    users.push(newUser);
    saveUsers(users);
    return newUser;
  },
  updateOne: async (query: { email: string }, data: any) => {
    const user = users.find(u => u.email === query.email);
    if (user) {
      if (data.password) user.password = data.password;
      saveUsers(users);
    }
    return user;
  },
  findByIdAndUpdate: async (id: string, update: any, options?: any) => {
    const user = users.find(u => u._id === id || u.id === id);
    if (user) {
      if (update.$inc && update.$inc.points !== undefined) {
        user.points += update.$inc.points;
      }
      if (update.points !== undefined) {
         user.points = update.points;
      }
      saveUsers(users);
    }
    const result = user ? { ...user } : null;
    if (!result) return null;
    return {
       ...result,
       select: () => {
         const u = {...result};
         delete u.password;
         return u;
       }
    };
  },
  find: () => {
    return {
      select: () => ({
        sort: () => {
          const clones = users.map(u => {
            const copy = {...u};
            delete copy.password;
            return copy;
          });
          return clones.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
      })
    };
  }
};

