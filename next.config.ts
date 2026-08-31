import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // puppeteer ships a large postinstall Chromium download and native bits it
  // loads at runtime; keep Next's bundler from trying to trace/inline it.
  serverExternalPackages: ["puppeteer", "puppeteer-core"],
};

export default nextConfig;
