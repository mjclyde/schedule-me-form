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
    'bg-red-100',
    'bg-red-200',
    'bg-red-300',
    'bg-red-400',
    'bg-red-500',
    'bg-red-600',
    'bg-red-700',
    'bg-red-800',
    'bg-red-900',
    'bg-sky-100',
    'bg-sky-200',
    'bg-sky-300',
    'bg-sky-400',
    'bg-sky-500',
    'bg-sky-600',
    'bg-sky-700',
    'bg-sky-800',
    'bg-sky-900',
    'border-red-100',
    'border-red-200',
    'border-red-300',
    'border-red-400',
    'border-red-500',
    'border-red-600',
    'border-red-700',
    'border-red-800',
    'border-red-900',
    'border-sky-100',
    'border-sky-200',
    'border-sky-300',
    'border-sky-400',
    'border-sky-500',
    'border-sky-600',
    'border-sky-700',
    'border-sky-800',
    'border-sky-900',
  ],
}

