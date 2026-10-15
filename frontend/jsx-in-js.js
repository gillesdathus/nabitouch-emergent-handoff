import { transformWithEsbuild } from "vite";

/** The app keeps JSX in .js files. Vite's parser only treats .jsx as JSX. */
export function jsxInJs() {
  return {
    name: "jsx-in-js",
    enforce: "pre",
    async transform(code, id) {
      if (!id.includes("/src/") || !id.endsWith(".js") || !code.includes("<")) return null;
      return transformWithEsbuild(code, id, { loader: "jsx", jsx: "automatic" });
    },
  };
}
