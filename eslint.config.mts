import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
    // 1. GLOBAL IGNORES 
    // This must be the first object and contain ONLY 'ignores'
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/*.mjs",
            "**/*.js",
            "**/versions.json",
            "**/manifest.json",
            "**/version-bump.mjs"
        ]
    },
    // 2. MAIN CONFIGURATION
    {
        files: ["src/**/*.ts", "eslint.config.mts"],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node // Added node globals for the config file itself
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
        // You can add custom rules here if needed
        rules: {
            "no-unused-vars": "warn"
        }
    },
    // 3. PLUGIN CONFIGS
    ...(obsidianmd?.configs?.recommended ? [obsidianmd.configs.recommended as any] : [])
);