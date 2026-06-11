import pg from "pg";
import { requireEnv } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: requireEnv("DATABASE_URL")
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

