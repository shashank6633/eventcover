import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Akan light theme.
         * `ink-*` is kept as legacy alias so existing utility classes (bg-ink-800,
         * border-ink-600 etc.) re-skin automatically instead of needing a global
         * sweep. Numbers go DARKER → LIGHTER (inverse of dark theme).
         */
        ink: {
          50:  '#FFFFFF',
          100: '#FAFAF7',
          200: '#F3F2EE',
          600: '#E5E7EB',  // border
          700: '#F3F4F6',  // subtle elevation / hover
          800: '#FFFFFF',  // card bg
          900: '#F8F7F4',  // app bg (warm cream)
        },
        /**
         * Akan brand — warm rust orange (#c1551a anchor at 500).
         * Built as HSL(24, 76%, L%) ladder so tints/shades stay on-hue.
         */
        brand: {
          50:  '#FCEFE5',
          100: '#F8DCC4',
          200: '#F2BD93',
          300: '#EA9760',
          400: '#DC7236',
          500: '#C1551A',
          600: '#A14516',
          700: '#863913',
          800: '#6B2E0F',
          900: '#50220B',
        },
        accent: {
          emerald: '#059669',
          amber: '#D97706',
          rose: '#DC2626',
          sky: '#0284C7',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.03), 0 1px 3px 0 rgb(0 0 0 / 0.04)',
        elevated: '0 4px 12px -2px rgb(0 0 0 / 0.06), 0 2px 6px -1px rgb(0 0 0 / 0.04)',
      },
      fontFamily: {
        mono: ['Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
