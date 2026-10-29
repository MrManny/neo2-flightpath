/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  webpack: (config) => {
    // The shared renderer follows the repo's NodeNext convention (relative
    // imports carry .js); Turbopack has no .js -> .ts specifier mapping, so
    // the UI builds with webpack's extensionAlias instead.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

export default nextConfig;
