import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./server/models/User.js";
import "dotenv/config";

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not found");
    process.exit(1);
  }
  
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB");

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash("password123", salt);
  const adminPassword = await bcrypt.hash("admin123", salt);

  const users = [
    { email: "admin@admin.com", password: adminPassword, points: 99999999 },
    { email: "user1@test.com", password: hashedPassword, points: 200 },
    { email: "user2@test.com", password: hashedPassword, points: 200 },
    { email: "user3@test.com", password: hashedPassword, points: 200 },
    { email: "user4@test.com", password: hashedPassword, points: 200 },
    { email: "user5@test.com", password: hashedPassword, points: 200 },
  ];

  for (const u of users) {
    const exists = await User.findOne({ email: u.email });
    if (!exists) {
      await User.create(u);
      console.log(`Created ${u.email}`);
    } else {
       console.log(`User ${u.email} already exists`);
       await User.updateOne({ email: u.email }, { points: u.points, password: u.password });
       console.log(`Updated ${u.email}`);
    }
  }

  await mongoose.disconnect();
  console.log("Done");
}

seed().catch(console.error);
