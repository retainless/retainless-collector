import * as Esbuild from "esbuild";
import * as Path from "node:path";

await Esbuild.build({
    platform: "node",
    define: {
        'process.env.NODE_ENV': JSON.stringify("production"),
        'process.env.ESBUILD': JSON.stringify("true"),
    },
    bundle: true,
    format: 'esm',
    entryPoints: [Path.join(import.meta.dirname, 'lambda.ts')],
    inject: [Path.join(import.meta.dirname, '..', '..', '_cjs-shim.js')],
    outExtension: {
        '.js': '.mjs'
    },
    external: [
        '@aws-sdk/*'
    ],
    minify: false,
    splitting: true,
    treeShaking: true,
    outdir: Path.join(import.meta.dirname, '..', 'build', 'aws', 'bundled'),
    logLevel: 'info'
});
