import { config } from "dotenv";
import type { NextConfig } from "next";

config({ path: "../../.env.local" });

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
