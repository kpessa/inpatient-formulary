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
    // CDM Request xlsx download — reads data/cdm_request_template.xlsx at
    // runtime. The bracket-delimited dynamic-route key "/api/cdm-request/[ndc]"
    // is interpreted as a glob character class by Next.js's file tracer
    // (https://github.com/vercel/next.js/issues/51054), so use a ** wildcard.
    "/api/cdm-request/**": ["./data/**/*"],
  },
}

export default nextConfig
