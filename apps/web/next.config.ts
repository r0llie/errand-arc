import { config } from "dotenv";
import type { NextConfig } from "next";

config({ path: "../../.env.local" });

const nextConfig: NextConfig = {/* config options here */};

export default nextConfig;
