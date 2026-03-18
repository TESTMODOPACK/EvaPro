// .eslintrc.js (Raíz del monorepo)
module.exports = {
    root: true, // Evita que ESLint busque configuraciones en directorios superiores
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    plugins: ['@typescript-eslint', 'prettier', 'import'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:prettier/recommended', // Delega el formateo a Prettier para evitar conflictos
    ],
    // --------------------------------------------------------
    // REGLAS GLOBALES (Aplican tanto a Frontend como a Backend)
    // --------------------------------------------------------
    rules: {
        // Prohibido el uso de 'any'. Fuerza a los devs a tipar correctamente o usar 'unknown'
        '@typescript-eslint/no-explicit-any': 'error',

        // Variables declaradas pero no usadas lanzan error (limpieza de código)
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

        // Obliga a usar import type {...} cuando solo se importan interfaces/tipos (optimiza el bundle)
        '@typescript-eslint/consistent-type-imports': 'warn',

        // Evita usar @ts-ignore sin una descripción del por qué
        '@typescript-eslint/ban-ts-comment': [
            'error',
            {
                'ts-expect-error': 'allow-with-description',
                'ts-ignore': true,
                'ts-nocheck': true,
                'ts-check': false,
            },
        ],

        // Ordenamiento automático de imports para mantener legibilidad
        'import/order': [
            'warn',
            {
                groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                'newlines-between': 'always',
                alphabetize: { order: 'asc', caseInsensitive: true },
            },
        ],
    },
    // --------------------------------------------------------
    // OVERRIDES POR APLICACIÓN (Magia del Monorepo)
    // --------------------------------------------------------
    overrides: [
        {
            // REGLAS ESPECÍFICAS PARA EL FRONTEND (Next.js 14)
            files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
            extends: [
                'plugin:react/recommended',
                'plugin:react-hooks/recommended',
                'next/core-web-vitals', // Reglas oficiales de Next.js para performance y SEO
            ],
            env: {
                browser: true,
                es2021: true,
            },
            rules: {
                'react/react-in-jsx-scope': 'off', // No es necesario en Next.js
                'react/prop-types': 'off', // Usamos TypeScript para esto
                'react-hooks/exhaustive-deps': 'error', // Estricto con las dependencias de los hooks
            },
        },
        {
            // REGLAS ESPECÍFICAS PARA EL BACKEND (NestJS)
            files: ['apps/api/**/*.ts'],
            env: {
                node: true,
                jest: true,
            },
            rules: {
                // NestJS utiliza inferencia de tipos en constructores (Inyección de Dependencias)
                '@typescript-eslint/no-empty-function': 'off',

                // En NestJS a veces se usan interfaces vacías para extender DTOs
                '@typescript-eslint/no-empty-interface': 'warn',
            },
        },
    ],
};