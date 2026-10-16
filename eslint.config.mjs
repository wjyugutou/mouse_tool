import antfu from '@antfu/eslint-config'

export default antfu(
  {
    react: true,
    ignores: [
      'src-tauri/**',
      'dist/**',
      'src/routeTree.gen.ts',
      // Third-party Morph Bot runtime; keep it byte-for-byte with upstream.
      'src/vendor/**',
    ],
  },
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
