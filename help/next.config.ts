import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  pageExtensions: ["ts", "tsx", "mdx"],
};

// Plugin given by name, not import: Turbopack can only pass serializable
// loader options. remark-gfm is what makes Markdown tables render.
const withMDX = createMDX({ options: { remarkPlugins: ["remark-gfm"] } });

export default withMDX(nextConfig);
