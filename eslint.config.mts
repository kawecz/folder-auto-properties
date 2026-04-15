import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default tseslint.config(
    {
        languageOptions: {
            globals: {
                ...globals.browser,
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
    },
    // We cast to 'any' here to resolve the "LegacyConfigObject" conflict 
    // and use a fallback empty array if the plugin fails to load
    ...(obsidianmd?.configs?.recommended ? [obsidianmd.configs.recommended as any] : []),
    
    globalIgnores([
        "node_modules",
        "dist",
        "esbuild.config.mjs",
        "eslint.config.js",
        "version-bump.mjs",
        "versions.json",
        "main.js",
    ]),
);