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
    // runtime to produce the autofilled form. Without this entry, Vercel's
    // file tracer drops the template from the deploy bundle and ?format=xlsx
    // fails with "Cannot access file …".
    "/api/cdm-request/[ndc]": ["./data/cdm_request_template.xlsx"],
  },
}

export default nextConfig
