import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27018/manchu-labelling";

export async function connectDatabase(uri = process.env.MONGODB_URI ?? DEFAULT_URI): Promise<void> {
  await mongoose.connect(uri);
}
