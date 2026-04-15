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
        files: ["**/*.ts", "**/*.mts"],
        languageOptions: {
            // This is the crucial part: telling ESLint how to read TS
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: __dirname,
            },
            globals: {
                ...globals.browser,
                ...globals.node
            },
        },
        plugins: {
            "@typescript-eslint": tseslint.plugin,
            obsidianmd: obsidianmd as any
        },
        rules: {
            ...((obsidianmd?.configs?.recommended as any)?.rules ?? {}),
            "no-unused-vars": "off", // Usually handled by TS
            "@typescript-eslint/no-unused-vars": "warn"
        }
    }
);