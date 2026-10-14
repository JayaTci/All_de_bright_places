// Discourages indexing while leaving public goals accessible by link.
import type { MetadataRoute } from "next";

// Returns the link-shared site's crawler policy.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
