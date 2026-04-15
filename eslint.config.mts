import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/*.mjs",
            "**/*.js",
            "**/versions.json",
            "**/manifest.json",
            "**/version-bump.mjs",
            "**/main.js"
        ]
    },
    {
        files: ["src/**/*.ts", "eslint.config.mts"],
        plugins: {
            obsidianmd: obsidianmd as any // Type cast for legacy plugin compatibility
        },
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node
            },
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        'eslint.config.mts',
                        'manifest.json'
                    ]
                },
                tsconfigRootDir: __dirname,
                extraFileExtensions: ['.json']
            },
        },
        rules: {
            // We cast to 'any' to bypass the complex LegacyConfigObject union types
            ...((obsidianmd?.configs?.recommended as any)?.rules ?? {}),
            "no-unused-vars": "warn"
        }
    }
);