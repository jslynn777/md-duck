import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

const plugins = [commonjs(), terser()];

const OUTPUT_CONFIGS = [
  {
    file: "./dist/phonemizer.cjs",
    format: "cjs",
  },
  {
    file: "./dist/phonemizer.js",
    format: "esm",
  },
];

export default OUTPUT_CONFIGS.map((output) => ({
  input: "./src/phonemizer.js",
  output,
  plugins,
}));
