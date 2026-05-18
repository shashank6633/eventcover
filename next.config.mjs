/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  async redirects() {
    return [
      { source: '/captain', destination: '/admin/redeem', permanent: false },
      { source: '/captain/redeem', destination: '/admin/redeem', permanent: false },
      { source: '/bouncer', destination: '/admin/issue', permanent: false },
      { source: '/cashier', destination: '/admin/cashier', permanent: false },
    ];
  },
};

export default nextConfig;
