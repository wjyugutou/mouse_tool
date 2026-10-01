import antfu from '@antfu/eslint-config'

export default antfu(
  {
    react: true,
    ignores: [
      'src-tauri/**',
      'dist/**',
      'src/routeTree.gen.ts',
    ],
  },
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
