/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme')

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,vue}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter var', ...defaultTheme.fontFamily.sans],
      },
      gap: {
        '0.1': '0.05rem',
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
  safelist: [
    'col-span-1',
    'col-span-2',
    'col-span-3',
    'col-span-4',
    'col-span-5',
    'col-span-6',
    'col-span-7',
    'col-span-8',
    'col-span-9',
    'col-span-10',
    'col-span-11',
    'col-span-12',
  ],
}

