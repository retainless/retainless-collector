import * as Esbuild from "esbuild";
import * as Path from "node:path";
import * as ChildProcess from "node:child_process";
import * as Fs from "node:fs/promises";

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
    outdir: Path.join(import.meta.dirname, '..', 'build', 'bundles', 'aws'),
    logLevel: 'info'
});

await Fs.copyFile(
    Path.join(import.meta.dirname, '..', 'LICENSE'),
    Path.join(import.meta.dirname, '..', 'build', 'bundles', 'aws', 'LICENSE')
)

ChildProcess.execSync("zip -FS ../aws.zip *", {
    cwd: Path.join(import.meta.dirname, '..', 'build', 'bundles', 'aws'),
    stdio: "inherit",
})
