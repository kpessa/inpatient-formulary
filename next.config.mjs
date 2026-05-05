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
    // runtime to produce the autofilled form. Use the same broad glob the
    // other formulary routes use (./data/**/*) — narrower entries with the
    // single-file path didn't trace under Next.js 16 + Turbopack.
    "/api/cdm-request/[ndc]": ["./data/**/*"],
  },
}

export default nextConfig
