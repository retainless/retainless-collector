import { createDefaultEsmPreset } from "ts-jest";

const presetConfig = createDefaultEsmPreset();

/** @type {import("jest").Config} **/
export default {
    ...presetConfig,
    moduleNameMapper: {
        '(.+)\\.js': '$1'
    }
};
