/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Lint is run separately; don't block deploys on prettier style errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors are caught in CI; don't block Netlify builds
    ignoreBuildErrors: false,
  },
};

export default nextConfig;

