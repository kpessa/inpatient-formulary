/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  outputFileTracingIncludes: {
    "/api/formulary/search": ["./data/**/*"],
    "/api/formulary/item": ["./data/**/*"],
  },
}

export default nextConfig
